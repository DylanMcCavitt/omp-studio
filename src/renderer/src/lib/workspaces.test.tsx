// AGE-626 — the pure workspace helpers backing the switcher / Manage panel.
// Covers label derivation, upsert dedupe + recency, pin toggling, and the
// pinned-first / recency display ordering. No DOM; logic only.

import type { Workspace } from "@shared/ipc";
import {
  pinWorkspace,
  projectLabel,
  sortWorkspaces,
  upsertWorkspace,
  WORKSPACE_COLORS,
  workspaceColor,
  workspaceColorForCwd,
  workspaceColorValue,
} from "@/lib/workspaces";

function ws(
  over: Partial<Workspace> & Pick<Workspace, "id" | "cwd">,
): Workspace {
  return {
    label: projectLabel(over.cwd),
    pinned: false,
    lastUsedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

it("projectLabel derives the basename and tolerates trailing separators", () => {
  expect(projectLabel("/home/dev/omp-studio")).toBe("omp-studio");
  expect(projectLabel("/home/dev/omp-studio/")).toBe("omp-studio");
  expect(projectLabel("C:\\Users\\dev\\proj")).toBe("proj");
  // A root-ish path with nothing after the separator falls back to the input.
  expect(projectLabel("/")).toBe("/");
});

it("upsertWorkspace inserts a fresh, pinned-false workspace at the front", () => {
  const out = upsertWorkspace([], "/a/b/proj", {
    now: "2026-01-01T00:00:00.000Z",
    id: "id1",
  });
  expect(out).toEqual([
    {
      id: "id1",
      cwd: "/a/b/proj",
      label: "proj",
      pinned: false,
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
});

it("upsertWorkspace mints a uuid id when none is supplied", () => {
  const out = upsertWorkspace([], "/a/b/proj", { now: "t" });
  expect(typeof out[0]?.id).toBe("string");
  expect(out[0]?.id.length ?? 0).toBeGreaterThan(0);
});

it("upsertWorkspace applies a trimmed label override on insert", () => {
  const out = upsertWorkspace([], "/a/b/proj", {
    label: "  My Proj  ",
    now: "t",
    id: "id1",
  });
  expect(out[0]?.label).toBe("My Proj");
});

it("upsertWorkspace refreshes recency by cwd, keeping id + pinned + prior label", () => {
  const existing = ws({
    id: "w1",
    cwd: "/p/one",
    label: "Custom",
    pinned: true,
    lastUsedAt: "2026-01-01T00:00:00.000Z",
  });
  const out = upsertWorkspace([existing], "/p/one", {
    now: "2026-02-01T00:00:00.000Z",
  });
  expect(out).toEqual([
    {
      id: "w1",
      cwd: "/p/one",
      label: "Custom",
      pinned: true,
      lastUsedAt: "2026-02-01T00:00:00.000Z",
    },
  ]);
});

it("upsertWorkspace leaves sibling workspaces untouched on refresh", () => {
  const a = ws({
    id: "a",
    cwd: "/p/a",
    lastUsedAt: "2026-01-01T00:00:00.000Z",
  });
  const b = ws({
    id: "b",
    cwd: "/p/b",
    lastUsedAt: "2026-01-02T00:00:00.000Z",
  });
  const out = upsertWorkspace([a, b], "/p/a", {
    now: "2026-03-01T00:00:00.000Z",
  });
  expect(out.map((w) => w.id).sort()).toEqual(["a", "b"]);
  expect(out.find((w) => w.id === "b")).toEqual(b);
});

it("upsertWorkspace heals duplicates: refreshing a cwd drops other entries sharing it", () => {
  const a = ws({
    id: "a",
    cwd: "/dup",
    label: "A",
    lastUsedAt: "2026-01-01T00:00:00.000Z",
  });
  const b = ws({
    id: "b",
    cwd: "/dup",
    label: "B",
    lastUsedAt: "2026-01-02T00:00:00.000Z",
  });
  const c = ws({
    id: "c",
    cwd: "/other",
    lastUsedAt: "2026-01-03T00:00:00.000Z",
  });
  const out = upsertWorkspace([a, b, c], "/dup", {
    now: "2026-05-01T00:00:00.000Z",
  });
  // The first /dup match is refreshed in place; the second is dropped; /other untouched.
  expect(out.map((w) => w.id)).toEqual(["a", "c"]);
  expect(out.find((w) => w.id === "a")?.lastUsedAt).toBe(
    "2026-05-01T00:00:00.000Z",
  );
  expect(out.find((w) => w.id === "c")).toEqual(c);
});

it("pinWorkspace flips only the targeted id", () => {
  const a = ws({ id: "a", cwd: "/p/a", pinned: false });
  const b = ws({ id: "b", cwd: "/p/b", pinned: false });
  const out = pinWorkspace([a, b], "b", true);
  expect(out.find((w) => w.id === "b")?.pinned).toBe(true);
  expect(out.find((w) => w.id === "a")?.pinned).toBe(false);
});

it("sortWorkspaces orders pinned first, then most-recent first", () => {
  const list = [
    ws({
      id: "old-recent",
      cwd: "/r1",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    }),
    ws({
      id: "new-recent",
      cwd: "/r2",
      lastUsedAt: "2026-03-01T00:00:00.000Z",
    }),
    ws({
      id: "old-pin",
      cwd: "/p1",
      pinned: true,
      lastUsedAt: "2026-01-15T00:00:00.000Z",
    }),
    ws({
      id: "new-pin",
      cwd: "/p2",
      pinned: true,
      lastUsedAt: "2026-02-15T00:00:00.000Z",
    }),
  ];
  expect(sortWorkspaces(list).map((w) => w.id)).toEqual([
    "new-pin",
    "old-pin",
    "new-recent",
    "old-recent",
  ]);
});

it("sortWorkspaces does not mutate its input", () => {
  const list = [
    ws({ id: "a", cwd: "/a", lastUsedAt: "2026-01-01T00:00:00.000Z" }),
    ws({ id: "b", cwd: "/b", lastUsedAt: "2026-02-01T00:00:00.000Z" }),
  ];
  const snapshot = [...list];
  sortWorkspaces(list);
  expect(list).toEqual(snapshot);
});

it("upsertWorkspace stores a color on a fresh insert", () => {
  const out = upsertWorkspace([], "/a/b/proj", {
    id: "id1",
    now: "t",
    color: "blue",
  });
  expect(out[0]?.color).toBe("blue");
});

it("upsertWorkspace preserves an existing color when recency is bumped without one", () => {
  const existing = ws({ id: "w1", cwd: "/p/a", color: "green" });
  const out = upsertWorkspace([existing], "/p/a", {
    now: "2026-09-09T00:00:00.000Z",
  });
  expect(out[0]?.color).toBe("green");
});

it("upsertWorkspace overrides an existing color when a new one is given", () => {
  const existing = ws({ id: "w1", cwd: "/p/a", color: "green" });
  const out = upsertWorkspace([existing], "/p/a", { now: "t", color: "red" });
  expect(out[0]?.color).toBe("red");
});

it("workspaceColorValue resolves a known key to a swatch and unset to undefined", () => {
  expect(WORKSPACE_COLORS.length).toBeGreaterThan(0);
  expect(workspaceColorValue("blue")).toMatch(/^#[0-9a-f]{6}$/i);
  expect(workspaceColorValue(undefined)).toBeUndefined();
});

it("workspaceColorForCwd resolves the matching workspace's color by exact cwd", () => {
  const list = [
    ws({ id: "a", cwd: "/p/a", color: "blue" }),
    ws({ id: "b", cwd: "/p/b" }),
  ];
  expect(workspaceColorForCwd(list, "/p/a")).toBe("blue");
  // Matching workspace has no color set.
  expect(workspaceColorForCwd(list, "/p/b")).toBeUndefined();
  // No workspace at that cwd.
  expect(workspaceColorForCwd(list, "/p/missing")).toBeUndefined();
  // No cwd / no list.
  expect(workspaceColorForCwd(list, undefined)).toBeUndefined();
  expect(workspaceColorForCwd(undefined, "/p/a")).toBeUndefined();
});

it("WORKSPACE_COLORS derives an rgba glow (~.55) and border (~.28) per key", () => {
  for (const c of WORKSPACE_COLORS) {
    expect(c.value).toMatch(/^#[0-9a-f]{6}$/i);
    expect(c.glow).toMatch(/^rgba\(\d+, \d+, \d+, 0\.55\)$/);
    expect(c.border).toMatch(/^rgba\(\d+, \d+, \d+, 0\.28\)$/);
  }
  // glow/border share the swatch's channels — e.g. blue #3b82f6 → 59,130,246.
  const blue = WORKSPACE_COLORS.find((c) => c.key === "blue");
  expect(blue?.glow).toBe("rgba(59, 130, 246, 0.55)");
  expect(blue?.border).toBe("rgba(59, 130, 246, 0.28)");
});

it("workspaceColor resolves a key to its full token record, unset to undefined", () => {
  expect(workspaceColor("green")).toMatchObject({
    key: "green",
    label: "Green",
  });
  expect(workspaceColor("green")?.glow).toMatch(/^rgba\(/);
  expect(workspaceColor(undefined)).toBeUndefined();
});

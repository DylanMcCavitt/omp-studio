// AGE-626 — the settings-store workspace actions (add / select / pin / remove)
// that funnel through the existing pessimistic `update`. Each test stubs
// `update` with a spy and asserts the exact patch the action computes, the way
// Collapsible.test.tsx exercises the debounced collapse write.

import type { StudioSettings, Workspace } from "@shared/ipc";
import { useSettingsStore } from "@/store/settings";

const BASE: StudioSettings = {
  version: 2,
  theme: "system",
  defaultProject: null,
  defaultModel: null,
  defaultThinkingLevel: "medium",
  defaultApprovalMode: "always-ask",
  defaultAutoApprove: false,
  liveSessionLimit: 4,
  recentProjects: [],
  openSessions: [],
  workspaces: [],
};

function ws(
  over: Partial<Workspace> & Pick<Workspace, "id" | "cwd">,
): Workspace {
  return {
    label: over.cwd.split("/").pop() ?? over.cwd,
    pinned: false,
    lastUsedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function seed(settings: StudioSettings) {
  const update = vi.fn().mockResolvedValue(undefined);
  useSettingsStore.setState({
    settings,
    update,
    loading: false,
    error: undefined,
  });
  return update;
}

beforeEach(() => {
  useSettingsStore.setState({
    settings: null,
    loading: false,
    error: undefined,
  });
});

it("addWorkspace appends a new workspace with the override label", async () => {
  const update = seed({ ...BASE, workspaces: [] });
  await useSettingsStore.getState().addWorkspace("/p/alpha", "Alpha");

  expect(update).toHaveBeenCalledTimes(1);
  const patch = update.mock.calls.at(-1)?.[0] as Partial<StudioSettings>;
  expect(patch.workspaces).toHaveLength(1);
  expect(patch.workspaces?.[0]).toMatchObject({
    cwd: "/p/alpha",
    label: "Alpha",
    pinned: false,
  });
  expect(typeof patch.workspaces?.[0]?.id).toBe("string");
});

it("recordWorkspace (select) bumps recency, preserving id / label / pin", async () => {
  const existing = ws({
    id: "w1",
    cwd: "/p/alpha",
    label: "Alpha",
    pinned: true,
    lastUsedAt: "2026-01-01T00:00:00.000Z",
  });
  const update = seed({ ...BASE, workspaces: [existing] });
  await useSettingsStore.getState().recordWorkspace("/p/alpha");

  const patch = update.mock.calls.at(-1)?.[0] as Partial<StudioSettings>;
  const got = patch.workspaces?.[0];
  expect(patch.workspaces).toHaveLength(1);
  expect(got?.id).toBe("w1");
  expect(got?.label).toBe("Alpha");
  expect(got?.pinned).toBe(true);
  // "now" (2026-06) sorts after the seeded 2026-01 timestamp.
  expect((got?.lastUsedAt ?? "") > existing.lastUsedAt).toBe(true);
});

it("updateWorkspace pins one workspace, leaving siblings unpinned", async () => {
  const a = ws({ id: "a", cwd: "/p/a", pinned: false });
  const b = ws({ id: "b", cwd: "/p/b", pinned: false });
  const update = seed({ ...BASE, workspaces: [a, b] });
  await useSettingsStore.getState().updateWorkspace("b", { pinned: true });

  const patch = update.mock.calls.at(-1)?.[0] as Partial<StudioSettings>;
  expect(patch.workspaces?.find((w) => w.id === "b")?.pinned).toBe(true);
  expect(patch.workspaces?.find((w) => w.id === "a")?.pinned).toBe(false);
});

it("updateWorkspace merges editable fields (label + cwd) by id", async () => {
  const a = ws({ id: "a", cwd: "/p/a", label: "A", pinned: true });
  const update = seed({ ...BASE, workspaces: [a] });
  await useSettingsStore
    .getState()
    .updateWorkspace("a", { label: "Renamed", cwd: "/p/moved" });

  const patch = update.mock.calls.at(-1)?.[0] as Partial<StudioSettings>;
  expect(patch.workspaces?.[0]).toMatchObject({
    id: "a",
    label: "Renamed",
    cwd: "/p/moved",
    pinned: true,
  });
});

it("updateWorkspace re-points the default workspace's cwd and carries defaultProject with it", async () => {
  const a = ws({ id: "a", cwd: "/p/a" });
  const update = seed({ ...BASE, workspaces: [a], defaultProject: "/p/a" });
  await useSettingsStore.getState().updateWorkspace("a", { cwd: "/p/moved" });

  const patch = update.mock.calls.at(-1)?.[0] as Partial<StudioSettings>;
  expect(patch.workspaces?.[0]).toMatchObject({ id: "a", cwd: "/p/moved" });
  expect(patch.defaultProject).toBe("/p/moved");
});

it("updateWorkspace leaves defaultProject untouched when re-pointing a non-default workspace", async () => {
  const a = ws({ id: "a", cwd: "/p/a" });
  const b = ws({ id: "b", cwd: "/p/b" });
  const update = seed({ ...BASE, workspaces: [a, b], defaultProject: "/p/b" });
  await useSettingsStore.getState().updateWorkspace("a", { cwd: "/p/moved" });

  const patch = update.mock.calls.at(-1)?.[0] as Partial<StudioSettings>;
  expect("defaultProject" in patch).toBe(false);
});

it("updateWorkspace re-pointing onto another workspace's cwd drops the collision", async () => {
  const a = ws({ id: "a", cwd: "/p/a" });
  const b = ws({ id: "b", cwd: "/p/b" });
  const update = seed({ ...BASE, workspaces: [a, b] });
  await useSettingsStore.getState().updateWorkspace("a", { cwd: "/p/b" });

  const patch = update.mock.calls.at(-1)?.[0] as Partial<StudioSettings>;
  // The edited workspace keeps its identity at the new cwd; "b" is dropped.
  expect(patch.workspaces?.map((w) => w.id)).toEqual(["a"]);
  expect(patch.workspaces?.[0]).toMatchObject({ id: "a", cwd: "/p/b" });
});

it("removeWorkspace drops by id and clears a default pointing at its cwd", async () => {
  const a = ws({ id: "a", cwd: "/p/a" });
  const b = ws({ id: "b", cwd: "/p/b" });
  const update = seed({ ...BASE, workspaces: [a, b], defaultProject: "/p/a" });
  await useSettingsStore.getState().removeWorkspace("a");

  const patch = update.mock.calls.at(-1)?.[0] as Partial<StudioSettings>;
  expect(patch.workspaces?.map((w) => w.id)).toEqual(["b"]);
  expect(patch.defaultProject).toBeNull();
});

it("removeWorkspace keeps a default that points at a surviving workspace", async () => {
  const a = ws({ id: "a", cwd: "/p/a" });
  const b = ws({ id: "b", cwd: "/p/b" });
  const update = seed({ ...BASE, workspaces: [a, b], defaultProject: "/p/b" });
  await useSettingsStore.getState().removeWorkspace("a");

  const patch = update.mock.calls.at(-1)?.[0] as Partial<StudioSettings>;
  expect(patch.workspaces?.map((w) => w.id)).toEqual(["b"]);
  expect("defaultProject" in patch).toBe(false);
});

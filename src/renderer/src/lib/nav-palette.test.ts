// AGE-700 — the pure grouping/derivation behind the ⌘K palette: status is
// derived (running/idle/done) from the live+streaming flags, recents are ordered
// most-recent-first across live and hibernated, and the substring filter narrows
// each group case-insensitively over name/path/title/workspace.

import type { OpenSessionDescriptor } from "@shared/ipc";
import { createSession } from "@/store/session-reducer";
import {
  filterSessionItems,
  filterWorkspaceItems,
  sessionNavItems,
  workspaceNavItems,
} from "./nav-palette";

const WORKSPACES = [
  {
    id: "w1",
    cwd: "/p/alpha",
    label: "Alpha",
    pinned: true,
    lastUsedAt: "t2",
    color: "blue" as const,
  },
  {
    id: "w2",
    cwd: "/p/beta",
    label: "Beta",
    pinned: false,
    lastUsedAt: "t1",
  },
];

function descriptor(
  over: Partial<OpenSessionDescriptor>,
): OpenSessionDescriptor {
  return {
    studioSessionId: "h1",
    cwd: "/p/alpha",
    createdAt: "2026-01-01T00:00:00Z",
    lastActiveAt: "2026-01-01T00:00:00Z",
    title: null,
    approvalPolicy: { mode: "write", autoApprove: true },
    status: "hibernated",
    ...over,
  };
}

it("orders workspaces pinned-first and marks the current one", () => {
  const items = workspaceNavItems(WORKSPACES, "/p/beta");
  expect(items.map((w) => w.label)).toEqual(["Alpha", "Beta"]);
  expect(items.find((w) => w.label === "Beta")?.current).toBe(true);
  expect(items.find((w) => w.label === "Alpha")?.current).toBe(false);
});

it("derives session status and orders recents newest-first", () => {
  const items = sessionNavItems(
    {
      live1: createSession("live1", {
        cwd: "/p/beta",
        status: "streaming",
        lastActivityAt: Date.parse("2026-06-20T00:00:00Z"),
      }),
      live2: createSession("live2", {
        cwd: "/p/alpha",
        status: "idle",
        lastActivityAt: Date.parse("2026-06-24T00:00:00Z"),
      }),
    },
    {
      hib1: {
        descriptor: descriptor({
          studioSessionId: "hib1",
          lastActiveAt: "2026-06-01T00:00:00Z",
        }),
      },
    },
    WORKSPACES,
  );
  // Newest live activity first; the hibernated row (epoch from lastActiveAt) last.
  expect(items.map((s) => s.id)).toEqual(["live2", "live1", "hib1"]);
  expect(items.find((s) => s.id === "live1")?.status).toBe("running");
  expect(items.find((s) => s.id === "live2")?.status).toBe("idle");
  expect(items.find((s) => s.id === "hib1")?.status).toBe("done");
  // Workspace label resolves to the saved workspace's label, not just basename.
  expect(items.find((s) => s.id === "live1")?.workspaceLabel).toBe("Beta");
});

it("filters each group by case-insensitive substring", () => {
  const ws = workspaceNavItems(WORKSPACES, null);
  expect(filterWorkspaceItems(ws, "ALPH").map((w) => w.label)).toEqual([
    "Alpha",
  ]);
  // Path match also counts.
  expect(filterWorkspaceItems(ws, "/p/beta").map((w) => w.label)).toEqual([
    "Beta",
  ]);

  const sessions = sessionNavItems(
    {
      s1: createSession("s1", {
        sessionName: "Refactor parser",
        cwd: "/p/beta",
        lastActivityAt: 1,
      }),
    },
    {},
    WORKSPACES,
  );
  expect(filterSessionItems(sessions, "parser")).toHaveLength(1);
  // Match by workspace name too.
  expect(filterSessionItems(sessions, "beta")).toHaveLength(1);
  expect(filterSessionItems(sessions, "zzz")).toHaveLength(0);
  // Empty query matches all.
  expect(filterSessionItems(sessions, "  ")).toHaveLength(1);
});

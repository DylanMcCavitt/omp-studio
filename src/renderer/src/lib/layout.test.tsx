// AGE-627 — the pure layout maths behind the draggable shell: list reorder, the
// sidebar nav visible/hidden split + reorder basis, and the chat rail panel
// normalization + visibility toggle. Framework-free, so these assert the
// behaviour the Sidebar / RightRail persist through `setLayout`.

import type { LucideIcon } from "lucide-react";
import {
  RAIL_PANEL_IDS,
  reorder,
  resolveNav,
  resolveRailPanels,
  setRailPanelVisible,
} from "@/lib/layout";
import type { NavEntry } from "@/lib/nav-registry";
import type { Route } from "@/store/app";

// Minimal fake nav entries — the reorder/hide logic is independent of the real
// registry's route set, so we control it here.
function entry(route: string, label: string): NavEntry {
  return {
    route: route as Route,
    label,
    icon: (() => null) as unknown as LucideIcon,
    view: () => null,
  };
}

const ENTRIES: NavEntry[] = [
  entry("dashboard", "Dashboard"),
  entry("chat", "Chat"),
  entry("sessions", "Sessions"),
  entry("skills", "Skills"),
];

const routes = (list: NavEntry[]) => list.map((e) => e.route);

describe("reorder", () => {
  it("moves an item from one index to another", () => {
    expect(reorder(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(reorder(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("returns a copy unchanged for equal or out-of-range indices", () => {
    const list = ["a", "b", "c"];
    expect(reorder(list, 1, 1)).toEqual(list);
    expect(reorder(list, -1, 2)).toEqual(list);
    expect(reorder(list, 0, 9)).toEqual(list);
    expect(reorder(list, 1, 1)).not.toBe(list); // never mutates in place
  });
});

describe("resolveNav", () => {
  it("defaults to registry order, everything visible", () => {
    const { visible, hidden, orderedRoutes } = resolveNav(ENTRIES);
    expect(routes(visible)).toEqual([
      "dashboard",
      "chat",
      "sessions",
      "skills",
    ]);
    expect(hidden).toEqual([]);
    expect(orderedRoutes).toEqual(["dashboard", "chat", "sessions", "skills"]);
  });

  it("honours navOrder and appends entries it omits in registry order", () => {
    const { visible } = resolveNav(ENTRIES, ["skills", "chat"]);
    // listed first (in order), then the unmentioned ones (dashboard, sessions)
    expect(routes(visible)).toEqual([
      "skills",
      "chat",
      "dashboard",
      "sessions",
    ]);
  });

  it("moves hidden routes into the overflow, preserving order in both", () => {
    const { visible, hidden } = resolveNav(ENTRIES, undefined, [
      "chat",
      "skills",
    ]);
    expect(routes(visible)).toEqual(["dashboard", "sessions"]);
    expect(routes(hidden)).toEqual(["chat", "skills"]);
  });

  it("reordering the full route list (the Sidebar's basis) re-sequences visible", () => {
    const { orderedRoutes } = resolveNav(ENTRIES);
    // Drag "skills" (idx 3) before "chat" (idx 1).
    const next = reorder(orderedRoutes, 3, 1);
    expect(next).toEqual(["dashboard", "skills", "chat", "sessions"]);
    const after = resolveNav(ENTRIES, next);
    expect(routes(after.visible)).toEqual([
      "dashboard",
      "skills",
      "chat",
      "sessions",
    ]);
  });
});

describe("resolveRailPanels", () => {
  it("returns every rail panel visible in default order when nothing persisted", () => {
    expect(resolveRailPanels()).toEqual(
      RAIL_PANEL_IDS.map((id) => ({ id, visible: true })),
    );
  });

  it("respects persisted order/visibility and appends missing panels as visible", () => {
    const got = resolveRailPanels([
      { id: "subagents", visible: false },
      { id: "model", visible: true },
    ]);
    expect(got).toEqual([
      { id: "subagents", visible: false },
      { id: "model", visible: true },
      { id: "thinking", visible: true },
      { id: "stats", visible: true },
      { id: "todos", visible: true },
    ]);
  });

  it("drops unknown ids and de-duplicates persisted entries", () => {
    const got = resolveRailPanels([
      { id: "ghost", visible: true },
      { id: "model", visible: false },
      { id: "model", visible: true },
    ]);
    expect(got.filter((p) => p.id === "model")).toEqual([
      { id: "model", visible: false },
    ]);
    expect(got.map((p) => String(p.id))).not.toContain("ghost");
    expect(got).toHaveLength(RAIL_PANEL_IDS.length);
  });
});

describe("setRailPanelVisible", () => {
  it("toggles one panel's visibility, leaving order and siblings intact", () => {
    const panels = resolveRailPanels();
    const next = setRailPanelVisible(panels, "stats", false);
    expect(next.find((p) => p.id === "stats")?.visible).toBe(false);
    expect(next.map((p) => p.id)).toEqual(panels.map((p) => p.id));
    expect(next.filter((p) => p.id !== "stats")).toEqual(
      panels.filter((p) => p.id !== "stats"),
    );
  });
});

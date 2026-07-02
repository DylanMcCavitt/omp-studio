// AGE-627 — the pure layout maths behind the draggable shell: list reorder and
// the sidebar nav visible/hidden split + reorder basis. Framework-free, so these
// assert the behaviour the Sidebar persists through `setLayout`.

import type { LucideIcon } from "lucide-react";
import {
  clampRightPanelWidthPx,
  defaultRightPanelWidthPx,
  reorder,
  resolveNav,
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

describe("right panel overlay widths", () => {
  it("uses content-type defaults by route", () => {
    expect(defaultRightPanelWidthPx("skills")).toBe(460);
    expect(defaultRightPanelWidthPx("mcp")).toBe(460);
    expect(defaultRightPanelWidthPx("agents")).toBe(460);
    expect(defaultRightPanelWidthPx("github")).toBe(460);
    expect(defaultRightPanelWidthPx("changes")).toBe(460);
    expect(defaultRightPanelWidthPx("linear")).toBe(600);
    expect(defaultRightPanelWidthPx("settings")).toBe(600);
    expect(defaultRightPanelWidthPx("dashboard")).toBe(600);
    expect(defaultRightPanelWidthPx("browser")).toBe(720);
    expect(defaultRightPanelWidthPx("terminal")).toBe(720);
    expect(defaultRightPanelWidthPx("sessions")).toBe(720);
  });

  it("clamps to the minimum sheet width and leaves the center guard when possible", () => {
    expect(clampRightPanelWidthPx(200, 1400)).toBe(320);
    expect(clampRightPanelWidthPx(900, 1200)).toBe(792);
    expect(clampRightPanelWidthPx(640.4, 1400)).toBe(640);
  });
});

// AGE-610 — the nav registry is the single source of truth the shell (Sidebar,
// App's VIEWS, the Route union) reads from. The contract that matters: it covers
// EVERY Route exactly once, so no destination silently vanishes from the sidebar
// or fails to mount a view. The type guard on EXPECTED_ROUTES keeps this runtime
// check honest — widen/shrink the Route union without updating it and this file
// stops compiling under `npm run typecheck`.

import { describe, expect, it } from "vitest";
import { NAV_ENTRIES, NAV_GROUP_ORDER } from "@/lib/nav-registry";
import type { Route } from "@/store/app";

const ALL_ROUTES = [
  "dashboard",
  "chat",
  "sessions",
  "skills",
  "mcp",
  "agents",
  "terminal",
  "browser",
  "changes",
  "github",
  "linear",
  "settings",
] as const;

// `never` (and so an un-compilable assignment below) unless ALL_ROUTES lists the
// Route union exactly — no missing routes, no stray ones.
type ExhaustiveRoutes =
  Exclude<Route, (typeof ALL_ROUTES)[number]> extends never
    ? Exclude<(typeof ALL_ROUTES)[number], Route> extends never
      ? typeof ALL_ROUTES
      : never
    : never;
const EXPECTED_ROUTES: ExhaustiveRoutes = ALL_ROUTES;

describe("nav-registry", () => {
  it("covers every Route exactly once", () => {
    // Sorted compare catches a missing route, a stray route, AND a duplicate —
    // a dupe lengthens the array, so the equality fails.
    const routes = NAV_ENTRIES.map((e) => e.route).sort();
    expect(routes).toEqual([...EXPECTED_ROUTES].sort());
  });

  it("gives every entry a label, icon, and view to render", () => {
    for (const entry of NAV_ENTRIES) {
      expect(entry.label).toBeTruthy();
      expect(entry.icon).toBeDefined();
      expect(entry.view).toBeDefined();
    }
  });

  it("groups every entry under a known, rendered group", () => {
    for (const entry of NAV_ENTRIES) {
      expect(NAV_GROUP_ORDER).toContain(entry.group ?? "core");
    }
  });
});

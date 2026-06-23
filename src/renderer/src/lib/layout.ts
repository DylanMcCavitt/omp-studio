// Pure helpers for the feature-5 draggable/rearrangeable shell layout. Kept
// framework-free (no React, no store) so the reorder/visibility maths is unit
// testable in isolation and reused by both the sidebar nav and the chat
// right-rail. Persistence shapes live in `settings.layout` (`LayoutSettings`);
// these functions only compute the next array a caller hands to `setLayout`.

import type { NavEntry } from "@/lib/nav-registry";
import type { Route } from "@/store/app";

/** Default sidebar width (% of the shell) — mirrors the old fixed `w-60`. */
export const DEFAULT_SIDEBAR_WIDTH_PCT = 18;
/** Min/max sidebar width (%) the resize handle is clamped to. */
export const SIDEBAR_MIN_PCT = 12;
export const SIDEBAR_MAX_PCT = 32;

/** Default right icon-rail expandable panel width (% of the shell). */
export const DEFAULT_RIGHT_PANEL_WIDTH_PCT = 30;
/** Min/max right-rail panel width (%) the resize handle is clamped to. */
export const RIGHT_PANEL_MIN_PCT = 18;
export const RIGHT_PANEL_MAX_PCT = 50;
/** Minimum center main width (%) so it never collapses behind the rail panel. */
export const MAIN_MIN_PCT = 30;

/** Default chat right-rail width (% of the chat pane) — mirrors `w-80`. */
export const DEFAULT_CHAT_RAIL_WIDTH_PCT = 26;
/** Min/max chat right-rail width (%). */
export const CHAT_RAIL_MIN_PCT = 16;
export const CHAT_RAIL_MAX_PCT = 48;
/** Minimum chat transcript width (%) so it never collapses behind the rail. */
export const CHAT_TRANSCRIPT_MIN_PCT = 40;

/** The chat right-rail panels, in their default display order. */
export const RAIL_PANEL_IDS = [
  "model",
  "thinking",
  "stats",
  "todos",
  "subagents",
] as const;
export type RailPanelId = (typeof RAIL_PANEL_IDS)[number];

/** A rail panel's persisted state: its id, in order, plus whether it shows. */
export interface RailPanelState {
  id: RailPanelId;
  visible: boolean;
}

function isRailPanelId(id: string): id is RailPanelId {
  return (RAIL_PANEL_IDS as readonly string[]).includes(id);
}

/**
 * Clamp a raw percentage from a resize drag to `[0, 100]` and round to a single
 * decimal so persisted layouts stay tidy (and don't thrash settings with the
 * sub-pixel float noise `onLayout` emits during a drag).
 */
export function roundPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

/**
 * Move the item at `from` to `to`, returning a NEW array. No-op (shallow copy)
 * when either index is out of range or they are equal, so callers can blindly
 * persist the result.
 */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= next.length ||
    to >= next.length
  ) {
    return next;
  }
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(to, 0, moved);
  return next;
}

/**
 * The full nav entries in their effective order: persisted `navOrder` first
 * (only ids that still exist, de-duplicated), then any registry entries the
 * stored order didn't mention (a newly added destination) in registry order.
 * This makes the order forward-compatible — adding a `Route` never drops it.
 */
export function orderedNavEntries(
  entries: readonly NavEntry[],
  navOrder?: readonly string[],
): NavEntry[] {
  const byRoute = new Map(entries.map((e) => [e.route as string, e]));
  const seen = new Set<string>();
  const out: NavEntry[] = [];
  for (const route of navOrder ?? []) {
    const entry = byRoute.get(route);
    if (entry && !seen.has(route)) {
      out.push(entry);
      seen.add(route);
    }
  }
  for (const entry of entries) {
    if (!seen.has(entry.route)) {
      out.push(entry);
      seen.add(entry.route);
    }
  }
  return out;
}

/** Visible (ordered, un-hidden) + hidden nav entries, plus the full route order. */
export interface ResolvedNav {
  visible: NavEntry[];
  hidden: NavEntry[];
  /** Every route in effective order (visible and hidden), the reorder basis. */
  orderedRoutes: Route[];
}

/**
 * Split the nav into the visible list (shown in the sidebar, in `navOrder`) and
 * the hidden overflow (`navHidden`), preserving the effective order in both.
 */
export function resolveNav(
  entries: readonly NavEntry[],
  navOrder?: readonly string[],
  navHidden?: readonly string[],
): ResolvedNav {
  const ordered = orderedNavEntries(entries, navOrder);
  const hiddenSet = new Set(navHidden ?? []);
  return {
    visible: ordered.filter((e) => !hiddenSet.has(e.route)),
    hidden: ordered.filter((e) => hiddenSet.has(e.route)),
    orderedRoutes: ordered.map((e) => e.route),
  };
}

/**
 * Normalize the persisted chat-rail panels into the full set: persisted entries
 * first (in order, valid ids only, de-duplicated), then any rail panel the
 * stored list omitted appended as visible. Guarantees every {@link RAIL_PANEL_IDS}
 * appears exactly once, so a schema addition surfaces instead of vanishing.
 */
export function resolveRailPanels(
  persisted?: readonly { id: string; visible: boolean }[],
): RailPanelState[] {
  const seen = new Set<string>();
  const out: RailPanelState[] = [];
  for (const panel of persisted ?? []) {
    if (isRailPanelId(panel.id) && !seen.has(panel.id)) {
      out.push({ id: panel.id, visible: panel.visible });
      seen.add(panel.id);
    }
  }
  for (const id of RAIL_PANEL_IDS) {
    if (!seen.has(id)) {
      out.push({ id, visible: true });
      seen.add(id);
    }
  }
  return out;
}

/** Set a rail panel's visibility, preserving order. Pure. */
export function setRailPanelVisible(
  panels: readonly RailPanelState[],
  id: RailPanelId,
  visible: boolean,
): RailPanelState[] {
  return panels.map((p) => (p.id === id ? { ...p, visible } : p));
}

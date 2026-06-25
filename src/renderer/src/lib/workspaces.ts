import type { Workspace, WorkspaceColorKey } from "@shared/ipc";

/**
 * How many non-pinned (recent) workspaces the switcher surfaces before the
 * "Manage workspaces…" escape hatch. The stored list itself is uncapped — a
 * workspace is a deliberate, user-managed entity, not a transient recent.
 */
export const WORKSPACE_RECENTS_LIMIT = 6;

/** A resolved workspace swatch: identity hue plus its derived Live-Dot tokens. */
export interface WorkspaceColor {
  key: WorkspaceColorKey;
  label: string;
  /** Solid swatch value (renderer-only CSS color). */
  value: string;
  /** Same hue at ~.55 alpha — the pulse ring color for a running Live Dot. */
  glow: string;
  /** Same hue at ~.28 alpha — a faint border/keyline tint. */
  border: string;
}

/** Expand a 6-digit `#rrggbb` to an `rgba()` string at `alpha` (0–1). Pure. */
function hexToRgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Curated workspace swatch palette (AGE-671): each key maps to a display label
 * and a fixed CSS color value chosen to read on both light and dark surfaces.
 * The key is what persists on the Workspace; the value is renderer-only. AGE-699
 * derives a `glow` (~.55α) and `border` (~.28α) per key from the swatch so the
 * Live Dot's pulse ring and keylines stay in sync with the identity hue.
 */
export const WORKSPACE_COLORS: readonly WorkspaceColor[] = (
  [
    { key: "slate", label: "Slate", value: "#64748b" },
    { key: "red", label: "Red", value: "#ef4444" },
    { key: "amber", label: "Amber", value: "#f59e0b" },
    { key: "green", label: "Green", value: "#22c55e" },
    { key: "teal", label: "Teal", value: "#14b8a6" },
    { key: "blue", label: "Blue", value: "#3b82f6" },
    { key: "violet", label: "Violet", value: "#8b5cf6" },
    { key: "pink", label: "Pink", value: "#ec4899" },
  ] satisfies { key: WorkspaceColorKey; label: string; value: string }[]
).map((c) => ({
  ...c,
  glow: hexToRgba(c.value, 0.55),
  border: hexToRgba(c.value, 0.28),
}));

/** Resolve a workspace color key to its full token record, or undefined. */
export function workspaceColor(
  color: WorkspaceColorKey | undefined,
): WorkspaceColor | undefined {
  return color ? WORKSPACE_COLORS.find((c) => c.key === color) : undefined;
}

/** Resolve a workspace color key to its swatch value, or undefined when unset. */
export function workspaceColorValue(
  color: WorkspaceColorKey | undefined,
): string | undefined {
  return workspaceColor(color)?.value;
}

/**
 * Resolve the color key of the saved workspace whose cwd matches `cwd` (exact
 * match — the same convention the switcher and file tree use). Undefined when
 * there is no cwd, no matching workspace, or that workspace has no color.
 */
export function workspaceColorForCwd(
  workspaces: readonly Workspace[] | undefined,
  cwd: string | undefined,
): WorkspaceColorKey | undefined {
  if (!cwd) return undefined;
  return workspaces?.find((w) => w.cwd === cwd)?.color;
}

/** Derive a stable, human display label from a directory path (its basename). */
export function projectLabel(cwd: string): string {
  const trimmed = cwd.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed || cwd;
}

export interface UpsertWorkspaceOptions {
  /** Explicit display label; falls back to {@link projectLabel}. */
  label?: string;
  /** Recency timestamp to stamp; defaults to now (ISO). */
  now?: string;
  /** Id to assign when creating a fresh workspace; defaults to a new uuid. */
  id?: string;
  /** Curated color key to assign; omit to leave the workspace's color unchanged. */
  color?: WorkspaceColorKey;
}

/**
 * Insert or refresh a workspace keyed by `cwd`. An existing entry keeps its
 * stable `id` + `pinned` flag, refreshes `lastUsedAt`, and adopts an explicit
 * `label` override when one is given; a new `cwd` gets a fresh uuid, the derived
 * (or overridden) label, and `pinned:false`, prepended to the list. Pure —
 * callers persist the returned array via `settings.update`.
 */
export function upsertWorkspace(
  list: readonly Workspace[],
  cwd: string,
  opts: UpsertWorkspaceOptions = {},
): Workspace[] {
  const now = opts.now ?? new Date().toISOString();
  const label = opts.label?.trim();
  const existing = list.find((w) => w.cwd === cwd);
  if (existing) {
    const refreshed: Workspace = {
      ...existing,
      lastUsedAt: now,
      label: label || existing.label,
      color: opts.color ?? existing.color,
    };
    // Keep exactly one entry per cwd: replace the matched workspace in place
    // and drop any other entry that already shares this cwd (collision-healing).
    return list
      .filter((w) => w === existing || w.cwd !== cwd)
      .map((w) => (w === existing ? refreshed : w));
  }
  const entry: Workspace = {
    id: opts.id ?? crypto.randomUUID(),
    cwd,
    label: label || projectLabel(cwd),
    pinned: false,
    lastUsedAt: now,
    color: opts.color,
  };
  return [entry, ...list];
}

/** Set the pinned flag on the workspace with `id` (no-op if absent). Pure. */
export function pinWorkspace(
  list: readonly Workspace[],
  id: string,
  pinned: boolean,
): Workspace[] {
  return list.map((w) => (w.id === id ? { ...w, pinned } : w));
}

/**
 * Order workspaces for display: pinned first, then most-recently-used first
 * (ISO `lastUsedAt` sorts lexicographically). Stable and non-mutating.
 */
export function sortWorkspaces(list: readonly Workspace[]): Workspace[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.lastUsedAt.localeCompare(a.lastUsedAt);
  });
}

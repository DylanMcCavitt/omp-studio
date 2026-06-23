import type { Workspace } from "@shared/ipc";

/**
 * How many non-pinned (recent) workspaces the switcher surfaces before the
 * "Manage workspaces…" escape hatch. The stored list itself is uncapped — a
 * workspace is a deliberate, user-managed entity, not a transient recent.
 */
export const WORKSPACE_RECENTS_LIMIT = 6;

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

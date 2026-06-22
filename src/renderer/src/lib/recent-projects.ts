import type { RecentProject } from "@shared/ipc";

/** Max recent projects retained; older entries fall off the end. */
export const RECENT_PROJECTS_LIMIT = 12;

/** Derive a stable, human display label from a directory path (its basename). */
export function projectLabel(cwd: string): string {
  const trimmed = cwd.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed || cwd;
}

/**
 * Insert or refresh a project in the recents list: dedupe by `cwd`, refresh its
 * `lastUsedAt`, move it to the front (most-recent-first), and cap the length.
 * Pure — callers persist the returned array via `settings.update`.
 */
export function upsertRecentProject(
  list: readonly RecentProject[],
  cwd: string,
  now: string = new Date().toISOString(),
  limit: number = RECENT_PROJECTS_LIMIT,
): RecentProject[] {
  const entry: RecentProject = {
    cwd,
    label: projectLabel(cwd),
    lastUsedAt: now,
  };
  const rest = list.filter((p) => p.cwd !== cwd);
  return [entry, ...rest].slice(0, limit);
}

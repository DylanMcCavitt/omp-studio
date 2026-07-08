import type { SessionStatus } from "@/store/session-reducer";

/**
 * Map the workspace's terminal state onto the Live Dot fill triad, aggregated
 * across every tab in the workspace: any live pty reads as `running`, all
 * shells exited as `done`, and the gap before the first spawn as `idle`.
 * Aggregating (rather than reading only the active tab) keeps the dot honest
 * when the active tab exited while another shell is still live, and makes a
 * stale active-tab id irrelevant.
 */
export function terminalDotStatus(opts: {
  creating: boolean;
  entries: readonly { exited?: boolean }[];
}): SessionStatus {
  if (opts.creating) return "running";
  if (opts.entries.length === 0) return "idle";
  return opts.entries.some((entry) => !entry.exited) ? "running" : "done";
}

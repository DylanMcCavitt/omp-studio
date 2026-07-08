import type { SessionStatus } from "@/store/session-reducer";

/**
 * Map the active workspace's terminal state onto the Live Dot fill triad.
 * A live pty reads as `running`, an exited shell as `done`, and the gap before
 * the first spawn (or while a tab is being created) as `idle`.
 */
export function terminalDotStatus(opts: {
  creating: boolean;
  hasEntries: boolean;
  activeExited?: boolean;
}): SessionStatus {
  if (opts.creating) return "running";
  if (!opts.hasEntries) return "idle";
  return opts.activeExited ? "done" : "running";
}

// AGE-674 — the chat panel dock: the Usage / Plan / Subagents widgets relocated
// out of the old middle rail into the bottom of the left sidebar. AGE-807
// collapses the dock to a one-line counter strip by default (Usage % · Plan
// done/total · live agent count); clicking the strip expands the full widgets.
// The expanded/collapsed state persists under `settings.ui.collapsed["chat.dock"]`.
// Renders nothing without an active session; the Subagents widget's Eye pops
// that subagent's transcript into the center view (via the shared chat store's
// `inspectedSubagentId`) and focuses the Chat tab so the inspector is visible
// even when a file tab owns the center; its split action opens the inspector
// in a new pane beside the chat (AGE-777).

import type { SubagentSnapshot } from "@shared/rpc";
import { ChevronDown, ChevronUp } from "lucide-react";
import { SessionStatsPanel } from "@/components/chat/SessionStatsPanel";
import { SubagentTree } from "@/components/chat/SubagentTree";
import { TodoPanel } from "@/components/chat/TodoPanel";
import { openPaneWithFeedback } from "@/components/shell/pane-actions";
import { useCollapsePref } from "@/components/ui/useCollapsePref";
import { useChatStore, useSession } from "@/store/chat";
import { CHAT_TAB, useFilesStore } from "@/store/files";

export function ChatPanelDock() {
  const sessionId = useChatStore((s) => s.activeSessionId);
  const setInspected = useChatStore((s) => s.setInspectedSubagent);
  // Collapsed (counter strip) by default; expanding restores the full widgets.
  const [collapsed, setCollapsed] = useCollapsePref("chat.dock", true);

  // Session-scoped widgets — nothing to show until a chat is open.
  if (!sessionId) return null;

  return (
    <div className="shrink-0 border-t border-border-subtle">
      <DockCounterStrip
        sessionId={sessionId}
        expanded={!collapsed}
        onToggle={() => setCollapsed(!collapsed)}
      />
      {!collapsed && (
        <div className="scrollbar max-h-[45vh] divide-y divide-border-subtle overflow-y-auto border-t border-border-subtle">
          <SessionStatsPanel sessionId={sessionId} dense />
          <TodoPanel dense />
          <SubagentTree
            dense
            onInspect={(id) => {
              setInspected({ sessionId, subagentId: id });
              // The inspector renders in the chat center pane; focus it so the
              // drill-in is visible even when a file tab currently owns the center.
              useFilesStore.getState().setActiveTab(CHAT_TAB);
            }}
            // AGE-777 — the split affordance: open the subagent's inspector in a
            // new pane beside the current chat instead of replacing the transcript.
            onOpenInPane={(id) =>
              openPaneWithFeedback({
                kind: "subagent",
                sessionId,
                subagentId: id,
              })
            }
          />
        </div>
      )}
    </div>
  );
}

/**
 * The one-line dock summary (AGE-807): live counters for the active session.
 * Segments render only when they have data, so an idle fresh session shows a
 * quiet strip instead of zeros.
 */
function DockCounterStrip({
  sessionId,
  expanded,
  onToggle,
}: {
  sessionId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const usagePercent = useSession(sessionId, (s) => {
    const percent = s?.contextUsage?.percent;
    return percent != null && Number.isFinite(percent)
      ? Math.round(Math.max(0, Math.min(100, percent)))
      : null;
  });
  const planDone = useSession(
    sessionId,
    (s) =>
      s?.todoPhases
        ?.flatMap((p) => p.tasks)
        .filter((t) => t.status === "completed").length ?? 0,
  );
  const planTotal = useSession(
    sessionId,
    (s) =>
      s?.todoPhases
        ?.flatMap((p) => p.tasks)
        .filter((t) => t.status !== "dropped").length ?? 0,
  );
  const liveAgents = useSession(sessionId, (s) => {
    const roster = (s?.subagents ?? []) as unknown as SubagentSnapshot[];
    return roster.filter(
      (sub) => sub.status === "running" || sub.status === "pending",
    ).length;
  });
  const agentCount = useSession(sessionId, (s) => s?.subagents?.length ?? 0);

  const Chevron = expanded ? ChevronDown : ChevronUp;
  return (
    <button
      type="button"
      aria-label="Session panels"
      aria-expanded={expanded}
      onClick={onToggle}
      className="flex w-full items-center gap-3 px-3 py-2 text-[11px] text-ink-faint transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {usagePercent != null && (
        <span>
          Usage <b className="font-semibold text-ink-muted">{usagePercent}%</b>
        </span>
      )}
      {planTotal > 0 && (
        <span>
          Plan{" "}
          <b className="font-semibold text-ink-muted">
            {planDone}/{planTotal}
          </b>
        </span>
      )}
      {agentCount > 0 && (
        <span>
          Agents{" "}
          <b className="font-semibold text-ink-muted">{liveAgents} live</b>
        </span>
      )}
      {usagePercent == null && planTotal === 0 && agentCount === 0 && (
        <span>Panels</span>
      )}
      <Chevron className="ml-auto h-3.5 w-3.5 shrink-0" />
    </button>
  );
}

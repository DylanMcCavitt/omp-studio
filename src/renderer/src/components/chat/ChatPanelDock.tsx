// AGE-674 — the chat panel dock: the Usage / Plan / Subagents widgets relocated
// out of the old middle rail into the bottom of the left sidebar. Each is a
// collapsible Panel that persists its own open/closed state
// (`settings.ui.collapsed[...]` via `useCollapsePref`), so the transcript owns
// the full center width by default and these stay glanceable bottom-left
// widgets. Renders nothing without an active session; the Subagents widget's Eye
// pops that subagent's transcript into the center view through the shared chat
// store (`inspectedSubagentId`), exactly as the rail used to.

import { SessionStatsPanel } from "@/components/chat/SessionStatsPanel";
import { SubagentTree } from "@/components/chat/SubagentTree";
import { TodoPanel } from "@/components/chat/TodoPanel";
import { useChatStore } from "@/store/chat";

export function ChatPanelDock() {
  const sessionId = useChatStore((s) => s.activeSessionId);
  const setInspected = useChatStore((s) => s.setInspectedSubagent);

  // Session-scoped widgets — nothing to show until a chat is open.
  if (!sessionId) return null;

  return (
    <div className="scrollbar max-h-[45%] shrink-0 space-y-2 overflow-y-auto border-t border-border-subtle p-2">
      <SessionStatsPanel sessionId={sessionId} />
      <TodoPanel />
      <SubagentTree onInspect={setInspected} />
    </div>
  );
}

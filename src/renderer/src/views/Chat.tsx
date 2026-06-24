// The live agent chat view. With no active session it shows a minimal empty
// state — new chats start from the left sidebar (or this view's New chat
// button). With an active session it shows the full-width transcript + composer;
// the Usage / Plan / Subagents panels live in the left sidebar dock
// (`ChatPanelDock`, AGE-674), not a middle rail. Clicking a subagent there pops
// its live transcript into this center view in place of the main chat.

import type { ChatUiRequestEvent } from "@shared/ipc";
import type { SubagentInfo, SubagentSnapshot } from "@shared/rpc";
import { MessageSquarePlus } from "lucide-react";
import { useEffect } from "react";
import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { ModelControl } from "@/components/chat/ModelControl";
import { SessionStatusBadge } from "@/components/chat/SessionList";
import { ContextMeterChip } from "@/components/chat/SessionStatsPanel";
import { SubagentInspector } from "@/components/chat/SubagentInspector";
import { ThinkingControl } from "@/components/chat/ThinkingControl";
import { UiRequestLayer } from "@/components/chat/UiRequestLayer";
import { Button, EmptyState } from "@/components/ui";
import { useActiveSession, useChatStore } from "@/store/chat";

/** Stable empty queue so the no-active-session selectors keep a steady ref. */
const NO_UI: ChatUiRequestEvent[] = [];

/** Stable empty roster so the no-subagent selector keeps a steady ref. */
const NO_SUBAGENTS: SubagentInfo[] = [];

export default function ChatWorkspace() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  // Cmd/Ctrl+W (close active session) is handled by the global shortcut manager
  // (lib/useShortcuts), wired once in App — no per-view listener here. The
  // session list + New chat action live in the left sidebar (AGE-632), not here.
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* Mounted at the workspace root so the active session's pending UI
          requests survive session switches and render as focused modals. */}
      <UiRequestLayer />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {activeSessionId ? (
          <ChatSession key={activeSessionId} sessionId={activeSessionId} />
        ) : (
          <NoActiveSession />
        )}
      </div>
    </div>
  );
}

// The no-active-session center: a minimal empty state. The old StartPanel card
// (project/model picker + prompt) is gone — new chats spawn from the sidebar (or
// the button here) in the active workspace with the default model.
function NoActiveSession() {
  const newChat = useChatStore((s) => s.newChat);
  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState
        icon={<MessageSquarePlus className="h-6 w-6" />}
        title="No chat open"
        hint="Pick one from the sidebar or start a new chat."
        action={
          <Button variant="ghost" onClick={newChat}>
            <MessageSquarePlus className="h-4 w-4" />
            New chat
          </Button>
        }
      />
    </div>
  );
}

function ChatSession({ sessionId }: { sessionId: string }) {
  const open = useChatStore((s) => Boolean(s.openSessions[sessionId]));
  const openSession = useChatStore((s) => s.openSession);
  const status = useActiveSession((s) => s?.status ?? "idle");
  const model = useActiveSession((s) => s?.model ?? null);
  const thinkingLevel = useActiveSession((s) => s?.thinkingLevel ?? "medium");
  const setModel = useChatStore((s) => s.setModel);
  const setThinking = useChatStore((s) => s.setThinking);
  const error = useActiveSession((s) => s?.error);
  const uiRequests = useActiveSession((s) => s?.uiRequests ?? NO_UI);
  const isCompacting = useActiveSession((s) => s?.isCompacting ?? false);
  const inspectedId = useChatStore((s) => s.inspectedSubagentId);
  const setInspected = useChatStore((s) => s.setInspectedSubagent);
  const subagents = useActiveSession(
    (s) => s?.subagents ?? NO_SUBAGENTS,
  ) as unknown as SubagentSnapshot[];
  const inspected = inspectedId
    ? subagents.find((s) => s.id === inspectedId)
    : undefined;

  // Safety net: if the active session isn't registered yet (e.g. selected from
  // another surface), open it now. start() registers before activating, so this
  // no-ops for freshly created chats and on session switches.
  useEffect(() => {
    if (open) return;
    let cancelled = false;
    void (async () => {
      try {
        const state = await window.omp.chat.getState(sessionId);
        if (!cancelled) await openSession(sessionId, state);
      } catch {
        // The bridge may not hold this session id; leave the store untouched.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, open, openSession]);

  const transcript = (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5">
        <ModelControl model={model} onChange={setModel} />
        <ThinkingControl level={thinkingLevel} onChange={setThinking} />
        <SessionStatusBadge
          status={status}
          uiRequests={uiRequests}
          isCompacting={isCompacting}
        />
        <ContextMeterChip />
      </header>
      {error && status === "error" && (
        <div className="border-b border-danger/30 bg-danger/10 px-4 py-1.5 text-xs text-danger">
          {error}
        </div>
      )}
      <MessageList />
      <Composer />
    </div>
  );

  // Pop into a subagent's live transcript in place of the main chat; the sidebar
  // Subagents widget's Eye sets the id, the inspector's Back clears it.
  const center =
    inspected != null ? (
      <SubagentInspector
        subagent={inspected}
        sessionId={sessionId}
        onBack={() => setInspected(null)}
      />
    ) : (
      transcript
    );

  // Transcript is full-width by default — the Usage / Plan / Subagents panels
  // moved to the left sidebar dock (AGE-674), so there is no middle rail to wedge
  // the center column.
  return (
    <div className="flex h-full min-h-0 min-w-0">
      <div className="min-w-0 flex-1">{center}</div>
    </div>
  );
}

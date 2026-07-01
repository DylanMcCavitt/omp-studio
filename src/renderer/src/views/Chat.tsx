// The live agent chat view. With no active session it shows a minimal empty
// state — new chats start from the left sidebar (or this view's New chat
// button). With an active session it shows the full-width transcript + composer;
// the Usage / Plan / Subagents panels live in the left sidebar dock
// (`ChatPanelDock`, AGE-674), not a middle rail. Clicking a subagent there pops
// its live transcript into this center view in place of the main chat.

import type { ChatUiRequestEvent } from "@shared/ipc";
import type { OmpMessage, SubagentInfo, SubagentSnapshot } from "@shared/rpc";
import { MessageSquarePlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { SessionStatusBadge } from "@/components/chat/SessionList";
import { ContextMeterChip } from "@/components/chat/SessionStatsPanel";
import { SubagentInspector } from "@/components/chat/SubagentInspector";
import { ThinkingControl } from "@/components/chat/ThinkingControl";
import { ApprovalModeControl } from "@/components/chat/ui-request/ApprovalModeControl";
import {
  ActivityRail,
  deriveActivitySteps,
  type TranscriptMode,
  TranscriptModeToggle,
} from "@/components/transcript/ActivityRail";
import { Button, EmptyState } from "@/components/ui";
import { workspaceColorForCwd } from "@/lib/workspaces";
import { useChatStore, useSession } from "@/store/chat";
import type { ActivityRunState } from "@/store/session-reducer";
import { useSettingsStore } from "@/store/settings";

/** Stable empty queue so the no-active-session selectors keep a steady ref. */
const NO_UI: ChatUiRequestEvent[] = [];

/** Stable empty roster so the no-subagent selector keeps a steady ref. */
const NO_SUBAGENTS: SubagentInfo[] = [];

/** Stable empty transcript so the Activity-rail selector keeps a steady ref. */
const NO_MESSAGES: OmpMessage[] = [];

/** Stable empty tool-run map so the Activity-rail selector keeps a steady ref. */
const NO_TOOL_RUNS: Record<string, ActivityRunState> = {};

// Pane-scoped chat surface (AGE-801). `sessionId` pins this workspace to one
// session; when omitted (the default pane) it follows the global active
// session — exactly the pre-pane behavior. The UiRequestLayer is NOT mounted
// here: modal UI requests are window-exclusive, so App mounts one layer for
// the active session.
export default function ChatWorkspace({ sessionId }: { sessionId?: string }) {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const shownSessionId = sessionId ?? activeSessionId;
  // Cmd/Ctrl+W (close active session) is handled by the global shortcut manager
  // (lib/useShortcuts), wired once in App — no per-view listener here. The
  // session list + New chat action live in the left sidebar (AGE-632), not here.
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {shownSessionId ? (
          <ChatSession key={shownSessionId} sessionId={shownSessionId} />
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
  const status = useSession(sessionId, (s) => s?.status ?? "idle");
  const thinkingLevel = useSession(
    sessionId,
    (s) => s?.thinkingLevel ?? "medium",
  );
  const setThinking = useChatStore((s) => s.setThinking);
  const error = useSession(sessionId, (s) => s?.error);
  const uiRequests = useSession(sessionId, (s) => s?.uiRequests ?? NO_UI);
  const isCompacting = useSession(sessionId, (s) => s?.isCompacting ?? false);
  // Session-scoped inspector (AGE-801): only the pane rendering the session
  // that requested the drill-in swaps its transcript for the inspector.
  const inspectedId = useChatStore((s) =>
    s.inspectedSubagent?.sessionId === sessionId
      ? s.inspectedSubagent.subagentId
      : null,
  );
  const setInspected = useChatStore((s) => s.setInspectedSubagent);
  const subagents = useSession(
    sessionId,
    (s) => s?.subagents ?? NO_SUBAGENTS,
  ) as unknown as SubagentSnapshot[];
  const inspected = inspectedId
    ? subagents.find((s) => s.id === inspectedId)
    : undefined;
  const messages = useSession(sessionId, (s) => s?.messages ?? NO_MESSAGES);
  const toolRuns = useSession(sessionId, (s) => s?.toolRuns ?? NO_TOOL_RUNS);
  const cwd = useSession(sessionId, (s) => s?.cwd);
  const workspaces = useSettingsStore((s) => s.settings?.workspaces);
  const color = workspaceColorForCwd(workspaces, cwd);
  const [mode, setMode] = useState<TranscriptMode>("focused");
  // The Activity rail is a derived, presentation-only view of the live tool
  // frames — status comes from the reconciled transcript or the live tool-run
  // record, so steps settle before turn end (AGE-708).
  const steps = useMemo(
    () => deriveActivitySteps(messages, toolRuns),
    [messages, toolRuns],
  );

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
        <ThinkingControl
          level={thinkingLevel}
          onChange={(level) => setThinking(level, sessionId)}
        />
        <SessionStatusBadge
          status={status}
          uiRequests={uiRequests}
          isCompacting={isCompacting}
        />
        <ApprovalModeControl sessionId={sessionId} />
        <ContextMeterChip sessionId={sessionId} />
        <div className="ml-auto">
          <TranscriptModeToggle value={mode} onChange={setMode} />
        </div>
      </header>
      {error && status === "error" && (
        <div className="border-b border-danger/30 bg-danger/10 px-4 py-1.5 text-xs text-danger">
          {error}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageList sessionId={sessionId} />
          <Composer sessionId={sessionId} />
        </div>
        {mode === "activity" && <ActivityRail steps={steps} color={color} />}
      </div>
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

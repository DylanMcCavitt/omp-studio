// Scrollable transcript column. Builds the toolCallId -> result lookup, renders
// a bubble per non-toolResult message, interleaves slash-command system cards at
// their captured transcript positions, and appends a live streaming bubble while
// the agent is responding. Auto-scrolls to the bottom unless the user scrolled up.

import type {
  AssistantMessage,
  ContentBlock,
  OmpMessage,
  ToolResultMessage,
} from "@shared/rpc";
import { Loader } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import { workspaceColorForCwd } from "@/lib/workspaces";
import { useActiveSession } from "@/store/chat";
import type { SystemCard } from "@/store/session-reducer";
import { useSettingsStore } from "@/store/settings";
import { MessageBubble } from "./MessageBubble";
import { SystemCardBubble } from "./SystemCardBubble";

const EMPTY_MESSAGES: OmpMessage[] = [];
const EMPTY_CARDS: SystemCard[] = [];

export function MessageList() {
  const messages = useActiveSession((s) => s?.messages ?? EMPTY_MESSAGES);
  const status = useActiveSession((s) => s?.status ?? "idle");
  const liveText = useActiveSession((s) => s?.liveText ?? "");
  const liveThinking = useActiveSession((s) => s?.liveThinking ?? "");
  const activeTool = useActiveSession((s) => s?.activeTool ?? null);
  const systemCards = useActiveSession((s) => s?.systemCards ?? EMPTY_CARDS);
  const cwd = useActiveSession((s) => s?.cwd);
  const workspaces = useSettingsStore((s) => s.settings?.workspaces);
  const workspaceColorKey = workspaceColorForCwd(workspaces, cwd);

  const containerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    const el = containerRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, systemCards, liveText, liveThinking, status]);

  const toolResults = new Map<string, ToolResultMessage>();
  for (const m of messages) {
    if (m.role === "toolResult") toolResults.set(m.toolCallId, m);
  }

  const last = messages[messages.length - 1];
  const lastIsAssistant = last?.role === "assistant";
  const streaming = status === "streaming";
  const showLive =
    streaming && !lastIsAssistant && (liveText !== "" || liveThinking !== "");

  let liveMessage: AssistantMessage | null = null;
  if (showLive) {
    const blocks: ContentBlock[] = [];
    if (liveThinking) blocks.push({ type: "thinking", thinking: liveThinking });
    if (liveText) blocks.push({ type: "text", text: liveText });
    liveMessage = { role: "assistant", content: blocks };
  }

  const visible = messages.filter((m) => m.role !== "toolResult");
  const empty =
    visible.length === 0 &&
    systemCards.length === 0 &&
    !liveMessage &&
    !streaming;

  return (
    <div
      ref={containerRef}
      onScroll={() => {
        const el = containerRef.current;
        if (el) {
          atBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }
      }}
      className="scrollbar flex-1 overflow-y-auto px-4 py-4"
    >
      {empty ? (
        <div className="flex h-full items-center justify-center text-sm text-ink-faint">
          No messages yet. Send a prompt to begin.
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-[min(100%,72rem)] flex-col gap-4">
          {visible.map((m, i) => (
            <Fragment key={i}>
              {/* Cards captured at this transcript position render before the
                  message that followed them (chronological interleave). */}
              {systemCards
                .filter((c) => c.afterCount === i)
                .map((c) => (
                  <SystemCardBubble key={c.id} card={c} />
                ))}
              <MessageBubble
                message={m}
                toolResults={toolResults}
                sessionRunning={streaming}
                workspaceColorKey={workspaceColorKey}
                streaming={
                  streaming &&
                  lastIsAssistant &&
                  m.role === "assistant" &&
                  i === visible.length - 1
                }
              />
            </Fragment>
          ))}
          {/* Cards anchored at (or past) the end of the transcript. */}
          {systemCards
            .filter((c) => c.afterCount >= visible.length)
            .map((c) => (
              <SystemCardBubble key={c.id} card={c} />
            ))}
          {liveMessage && (
            <MessageBubble
              message={liveMessage}
              toolResults={toolResults}
              sessionRunning={streaming}
              workspaceColorKey={workspaceColorKey}
              streaming
            />
          )}
          {streaming && (
            <div className="flex items-center gap-2 text-xs text-ink-faint">
              <Loader className="h-3.5 w-3.5 animate-spin" />
              <span>{activeTool ? `Running ${activeTool}` : "Working"}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Scrollable transcript column. Builds the toolCallId -> result lookup, renders
// a bubble per non-toolResult message, and appends a live streaming bubble while
// the agent is responding. Auto-scrolls to the bottom unless the user scrolled up.

import type {
  AssistantMessage,
  ContentBlock,
  OmpMessage,
  ToolResultMessage,
} from "@shared/rpc";
import { Loader } from "lucide-react";
import { useEffect, useRef } from "react";
import { useActiveSession } from "@/store/chat";
import { MessageBubble } from "./MessageBubble";

const EMPTY_MESSAGES: OmpMessage[] = [];

export function MessageList() {
  const messages = useActiveSession((s) => s?.messages ?? EMPTY_MESSAGES);
  const status = useActiveSession((s) => s?.status ?? "idle");
  const liveText = useActiveSession((s) => s?.liveText ?? "");
  const liveThinking = useActiveSession((s) => s?.liveThinking ?? "");
  const activeTool = useActiveSession((s) => s?.activeTool ?? null);

  const containerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    const el = containerRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, liveText, liveThinking, status]);

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
  const empty = visible.length === 0 && !liveMessage && !streaming;

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
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {visible.map((m, i) => (
            <MessageBubble
              key={i}
              message={m}
              toolResults={toolResults}
              streaming={
                streaming &&
                lastIsAssistant &&
                m.role === "assistant" &&
                i === visible.length - 1
              }
            />
          ))}
          {liveMessage && (
            <MessageBubble
              message={liveMessage}
              toolResults={toolResults}
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

// Scrollable transcript column. Builds the toolCallId -> result lookup, renders
// a bubble per non-toolResult message, interleaves slash-command system cards at
// their captured transcript positions, and appends a live streaming bubble while
// the agent is responding. Auto-scrolls to the bottom unless the user scrolled up.

import type {
  AssistantMessage,
  ContentBlock,
  OmpMessage,
  ToolCallBlock,
  ToolResultMessage,
} from "@shared/rpc";
import { Loader } from "lucide-react";
import { memo, useCallback, useMemo, useRef } from "react";
import { Virtuoso } from "react-virtuoso";
import { workspaceColorForCwd } from "@/lib/workspaces";
import { useSession } from "@/store/chat";
import { type SystemCard, toContentBlocks } from "@/store/session-reducer";
import { useSettingsStore } from "@/store/settings";
import { MessageBubble } from "./MessageBubble";
import { MessageScroller } from "./MessageScroller";
import { SystemCardBubble } from "./SystemCardBubble";
import {
  MESSAGE_ANCHOR_ATTR,
  messageAnchorSelector,
  useMessageVisibility,
} from "./useMessageVisibility";

const EMPTY_MESSAGES: OmpMessage[] = [];
const EMPTY_CARDS: SystemCard[] = [];

type TranscriptRow =
  | {
      kind: "message";
      key: string;
      message: OmpMessage;
      streaming: boolean;
      toolResultsVersion: string;
    }
  | { kind: "system"; key: string; card: SystemCard }
  | { kind: "loader"; key: "loader"; activeTool: string | null };

const toolResultIds = new WeakMap<ToolResultMessage, number>();
let nextToolResultId = 1;

function toolResultRefId(result: ToolResultMessage): number {
  let id = toolResultIds.get(result);
  if (!id) {
    id = nextToolResultId++;
    toolResultIds.set(result, id);
  }
  return id;
}

function messageKey(message: OmpMessage, index: number): string {
  const optimisticId = (message as { optimisticId?: string }).optimisticId;
  if (optimisticId) return optimisticId;
  return `${message.role}:${message.timestamp ?? "na"}:${index}`;
}

function toolCallIds(message: OmpMessage): string[] {
  if (message.role !== "assistant") return [];
  return toContentBlocks(message.content)
    .filter((b): b is ToolCallBlock => b.type === "toolCall")
    .map((b) => b.id)
    .filter(Boolean);
}

function toolResultsVersion(
  message: OmpMessage,
  toolResults: Map<string, ToolResultMessage>,
): string {
  const ids = toolCallIds(message);
  if (ids.length === 0) return "";
  return ids
    .map((id) => {
      const result = toolResults.get(id);
      return result ? `${id}:${toolResultRefId(result)}` : `${id}:-`;
    })
    .join("|");
}

const Row = memo(function Row({
  row,
  toolResults,
  sessionRunning,
  workspaceColorKey,
}: {
  row: TranscriptRow;
  toolResults: Map<string, ToolResultMessage>;
  sessionRunning: boolean;
  workspaceColorKey: ReturnType<typeof workspaceColorForCwd>;
}) {
  return (
    <div
      className="px-4 py-2"
      {...(row.kind !== "loader" ? { [MESSAGE_ANCHOR_ATTR]: row.key } : {})}
    >
      <div className="mx-auto w-full max-w-[min(100%,72rem)]">
        {row.kind === "system" ? (
          <SystemCardBubble card={row.card} />
        ) : row.kind === "loader" ? (
          <div className="flex items-center gap-2 text-xs text-ink-faint">
            <Loader className="h-3.5 w-3.5 animate-spin" />
            <span>
              {row.activeTool ? `Running ${row.activeTool}` : "Working"}
            </span>
          </div>
        ) : (
          <MessageBubble
            message={row.message}
            toolResults={toolResults}
            toolResultsVersion={row.toolResultsVersion}
            sessionRunning={sessionRunning}
            workspaceColorKey={workspaceColorKey}
            streaming={row.streaming}
          />
        )}
      </div>
    </div>
  );
});

function buildRows(
  messages: OmpMessage[],
  systemCards: SystemCard[],
  liveMessage: AssistantMessage | null,
  streaming: boolean,
  activeTool: string | null,
  toolResults: Map<string, ToolResultMessage>,
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const visible = messages.filter((m) => m.role !== "toolResult");
  const last = messages[messages.length - 1];
  const lastIsAssistant = last?.role === "assistant";
  let cardIndex = 0;
  for (let i = 0; i < visible.length; i++) {
    while (
      cardIndex < systemCards.length &&
      systemCards[cardIndex]?.afterCount === i
    ) {
      const card = systemCards[cardIndex++];
      if (!card) continue;
      rows.push({ kind: "system", key: `card:${card.id}`, card });
    }
    const message = visible[i];
    if (!message) continue;
    rows.push({
      kind: "message",
      key: `msg:${messageKey(message, i)}`,
      message,
      streaming:
        streaming &&
        lastIsAssistant &&
        message.role === "assistant" &&
        i === visible.length - 1,
      toolResultsVersion: toolResultsVersion(message, toolResults),
    });
  }
  while (cardIndex < systemCards.length) {
    const card = systemCards[cardIndex++];
    if (!card) continue;
    if (card.afterCount >= visible.length) {
      rows.push({ kind: "system", key: `card:${card.id}`, card });
    }
  }
  if (liveMessage) {
    rows.push({
      kind: "message",
      key: "live:assistant",
      message: liveMessage,
      streaming: true,
      toolResultsVersion: "",
    });
  }
  if (streaming) rows.push({ kind: "loader", key: "loader", activeTool });
  return rows;
}
export function MessageList({ sessionId }: { sessionId: string }) {
  const messages = useSession(sessionId, (s) => s?.messages ?? EMPTY_MESSAGES);
  const status = useSession(sessionId, (s) => s?.status ?? "idle");
  const liveText = useSession(sessionId, (s) => s?.liveText ?? "");
  const liveThinking = useSession(sessionId, (s) => s?.liveThinking ?? "");
  const activeTool = useSession(sessionId, (s) => s?.activeTool ?? null);
  const systemCards = useSession(
    sessionId,
    (s) => s?.systemCards ?? EMPTY_CARDS,
  );
  const cwd = useSession(sessionId, (s) => s?.cwd);
  const workspaces = useSettingsStore((s) => s.settings?.workspaces);
  const workspaceColorKey = workspaceColorForCwd(workspaces, cwd);

  const streaming = status === "streaming";
  const last = messages[messages.length - 1];
  const lastIsAssistant = last?.role === "assistant";
  const showLive =
    streaming && !lastIsAssistant && (liveText !== "" || liveThinking !== "");

  const liveMessage = useMemo<AssistantMessage | null>(() => {
    if (!showLive) return null;
    const blocks: ContentBlock[] = [];
    if (liveThinking) blocks.push({ type: "thinking", thinking: liveThinking });
    if (liveText) blocks.push({ type: "text", text: liveText });
    return { role: "assistant", content: blocks };
  }, [liveText, liveThinking, showLive]);

  const toolResults = useMemo(() => {
    const results = new Map<string, ToolResultMessage>();
    for (const message of messages) {
      if (message.role === "toolResult") {
        results.set(message.toolCallId, message);
      }
    }
    return results;
  }, [messages]);

  const rows = useMemo(
    () =>
      buildRows(
        messages,
        systemCards,
        liveMessage,
        streaming,
        activeTool,
        toolResults,
      ),
    [messages, systemCards, liveMessage, streaming, activeTool, toolResults],
  );

  const scrollRootRef = useRef<HTMLElement | null>(null);
  const navigableIds = useMemo(
    () => rows.filter((row) => row.kind !== "loader").map((row) => row.key),
    [rows],
  );
  const { currentAnchorId, visibleMessageIds } = useMessageVisibility(
    scrollRootRef,
    navigableIds,
  );

  // react-virtuoso's scrollerRef is callback-only — a RefObject is silently
  // ignored and the trail would never attach.
  const attachScroller = useCallback((el: HTMLElement | Window | null) => {
    scrollRootRef.current = el instanceof HTMLElement ? el : null;
  }, []);

  const handleNavigate = useCallback((anchorId: string) => {
    const root = scrollRootRef.current;
    if (!root) return;
    const target = root.querySelector(messageAnchorSelector(anchorId));
    target?.scrollIntoView({ block: "start" });
  }, []);

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-ink-faint">
        No messages yet. Send a prompt to begin.
      </div>
    );
  }

  return (
    <div
      className="relative flex min-h-0 flex-1"
      data-visible-message-count={visibleMessageIds.length}
      data-current-anchor={currentAnchorId ?? ""}
    >
      <Virtuoso
        className="scrollbar flex-1"
        data={rows}
        computeItemKey={(_, row) => row.key}
        followOutput={(atBottom) => (atBottom ? "auto" : false)}
        atBottomThreshold={80}
        increaseViewportBy={{ top: 400, bottom: 800 }}
        initialItemCount={Math.min(rows.length, 30)}
        scrollerRef={attachScroller}
        itemContent={(_, row) => (
          <Row
            row={row}
            toolResults={toolResults}
            sessionRunning={streaming}
            workspaceColorKey={workspaceColorKey}
          />
        )}
      />
      <MessageScroller
        scrollRootRef={scrollRootRef}
        messageIds={navigableIds}
        currentAnchorId={currentAnchorId}
        onNavigate={handleNavigate}
      />
    </div>
  );
}

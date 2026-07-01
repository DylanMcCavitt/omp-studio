// Shared transcript renderer for an `OmpMessage[]` log. Extracted verbatim from
// the inline renderer that used to live in `views/Sessions.tsx` so the Sessions
// history view and the subagent inspector (feature 4) render transcripts
// identically — one renderer, one set of block components.
//
// `focusIndex` scrolls a message into view and flashes it (the Sessions search
// jump); the subagent inspector omits it. The component owns its scroll
// container so callers only pass data.

import type {
  ContentBlock,
  OmpMessage,
  TextBlock,
  ThinkingBlock,
  ToolCallBlock,
} from "@shared/rpc";
import { MessagesSquare } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Badge, EmptyState } from "@/components/ui";
import { cn } from "@/lib/cn";
import { toContentBlocks } from "@/store/session-reducer";

/** Flatten message content to plain text, keeping only `text` blocks. */
export function blocksText(
  content: string | ContentBlock[] | undefined,
): string {
  if (typeof content === "string") return content;
  if (!content) return "";
  return content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
}

export function argsPreview(args: unknown): string {
  let raw: string;
  try {
    raw = typeof args === "string" ? args : JSON.stringify(args);
  } catch {
    raw = String(args);
  }
  const flat = (raw ?? "").replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
}

function AssistantBlock({ block }: { block: ContentBlock }) {
  if (block.type === "text") {
    return (
      <div className="whitespace-pre-wrap break-words font-mono text-xs text-ink">
        {(block as TextBlock).text}
      </div>
    );
  }
  if (block.type === "thinking") {
    return (
      <details className="rounded-md bg-bg-panel px-2 py-1">
        <summary className="cursor-pointer select-none text-xs text-ink-faint">
          thinking
        </summary>
        <div className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-ink-muted">
          {(block as ThinkingBlock).thinking}
        </div>
      </details>
    );
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallBlock;
    return (
      <div className="flex items-start gap-2">
        <Badge variant="warn">tool</Badge>
        <code className="break-words font-mono text-xs text-ink-muted">
          {tc.name}(
          <span className="text-ink-faint">{argsPreview(tc.arguments)}</span>)
        </code>
      </div>
    );
  }
  return <div className="font-mono text-xs text-ink-faint">[{block.type}]</div>;
}

/** Render a single transcript message (user / assistant / tool result). */
export const MessageBlock = memo(function MessageBlock({
  message,
}: {
  message: OmpMessage;
}) {
  if (message.role === "user") {
    const text = blocksText(message.content);
    return (
      <div className="space-y-1">
        <Badge variant="accent">user</Badge>
        <div className="whitespace-pre-wrap break-words font-mono text-xs text-ink">
          {text || <span className="text-ink-faint">(empty)</span>}
        </div>
      </div>
    );
  }
  if (message.role === "toolResult") {
    const body = blocksText(message.content);
    const shown =
      body.length > 2000 ? `${body.slice(0, 2000)}\n… (truncated)` : body;
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Badge variant={message.isError ? "danger" : "muted"}>
            tool result
          </Badge>
          <span className="font-mono text-xs text-ink-muted">
            {message.toolName}
          </span>
        </div>
        <pre className="scrollbar overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-bg-panel p-2 font-mono text-xs text-ink-muted">
          {shown || "(no output)"}
        </pre>
      </div>
    );
  }
  const blocks = toContentBlocks(message.content);
  return (
    <div className="space-y-2">
      <Badge>assistant</Badge>
      {blocks.map((block, i) => (
        <AssistantBlock key={i} block={block} />
      ))}
    </div>
  );
});

export interface TranscriptViewProps {
  messages: OmpMessage[];
  /** Scroll this message index into view and flash it; <0 / null disables. */
  focusIndex?: number | null;
  /** Empty-state copy when there are no messages. */
  emptyTitle?: string;
  className?: string;
}

export function TranscriptView({
  messages,
  focusIndex = null,
  emptyTitle = "No messages in this session",
  className,
}: TranscriptViewProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [flashIndex, setFlashIndex] = useState<number | null>(null);

  // Scroll the focused message into view and flash it briefly so a search jump
  // lands the reader on the exact match even when the row is virtualized.
  useEffect(() => {
    if (focusIndex == null || focusIndex < 0) return;
    virtuosoRef.current?.scrollToIndex({
      index: focusIndex,
      align: "center",
      behavior: "auto",
    });
    setFlashIndex(focusIndex);
    const t = setTimeout(() => setFlashIndex(null), 1600);
    return () => clearTimeout(t);
  }, [focusIndex]);

  if (messages.length === 0) {
    return (
      <EmptyState
        icon={<MessagesSquare className="h-6 w-6" />}
        title={emptyTitle}
      />
    );
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      className={cn("scrollbar h-[70vh]", className)}
      data={messages}
      computeItemKey={(i, message) =>
        `${message.role}:${message.timestamp ?? "na"}:${i}`
      }
      initialItemCount={Math.min(messages.length, 30)}
      increaseViewportBy={{ top: 400, bottom: 800 }}
      itemContent={(i, message) => (
        <div
          data-msg-index={i}
          className={cn(
            "scroll-mt-6 rounded-md px-1 py-2 transition-colors",
            flashIndex === i && "bg-accent-soft/60 p-2 ring-1 ring-accent",
          )}
        >
          <MessageBlock message={message} />
        </div>
      )}
    />
  );
}

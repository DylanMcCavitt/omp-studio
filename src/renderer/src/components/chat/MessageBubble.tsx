// Renders one OmpMessage (AGE-704 turn restyle). User turns lead with an
// uppercase "YOU" label over their body; assistant turns lead with an ω accent
// avatar beside their content blocks (thinking / text / tool calls). toolResult
// messages are folded into their ToolCallCard and render nothing here.

import type { WorkspaceColorKey } from "@shared/ipc";
import type {
  ContentBlock,
  ImageBlock,
  OmpMessage,
  TextBlock,
  ThinkingBlock as ThinkingBlockData,
  ToolCallBlock,
  ToolResultMessage,
} from "@shared/rpc";
import { imageBlockSrc } from "@/lib/images";
import { toContentBlocks } from "@/store/session-reducer";
import { Markdown } from "./Markdown";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallCard } from "./ToolCallCard";

interface Props {
  message: OmpMessage;
  toolResults: Map<string, ToolResultMessage>;
  streaming?: boolean;
  /** The active session is live and streaming a turn (running tool cards). */
  sessionRunning?: boolean;
  /** Workspace hue threaded to running tool cards. */
  workspaceColorKey?: WorkspaceColorKey;
}

export function MessageBubble({
  message,
  toolResults,
  streaming,
  sessionRunning,
  workspaceColorKey,
}: Props) {
  if (message.role === "toolResult") return null;

  if (message.role === "user") {
    const content = message.content;
    let images: ImageBlock[] = [];
    let text: string;
    if (typeof content === "string") {
      text = content;
    } else {
      text = content
        .filter((b): b is TextBlock => b.type === "text")
        .map((b) => String(b.text ?? ""))
        .join("");
      images = content.filter((b): b is ImageBlock => b.type === "image");
    }
    return (
      <div className="space-y-1">
        <div className="text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-ink-faint">
          YOU
        </div>
        {images.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {images.map((img, i) => {
              const src = imageBlockSrc(img);
              return src ? (
                <img
                  key={i}
                  src={src}
                  alt="Attachment"
                  className="max-h-48 rounded-lg border border-border-subtle object-cover"
                />
              ) : null;
            })}
          </div>
        )}
        {text && <Markdown className="text-ink">{text}</Markdown>}
      </div>
    );
  }

  const blocks = toContentBlocks(message.content);

  return (
    <div className="flex gap-3">
      <div
        aria-hidden
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-bold leading-none text-bg"
      >
        ω
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        {blocks.map((block: ContentBlock, i: number) => {
          if (block.type === "thinking") {
            return (
              <ThinkingBlock
                key={`t${i}`}
                thinking={(block as ThinkingBlockData).thinking}
              />
            );
          }
          if (block.type === "text") {
            return (
              <Markdown key={`x${i}`}>{(block as TextBlock).text}</Markdown>
            );
          }
          if (block.type === "toolCall") {
            const call = block as ToolCallBlock;
            return (
              <ToolCallCard
                key={call.id || `c${i}`}
                call={call}
                result={toolResults.get(call.id)}
                sessionRunning={sessionRunning}
                workspaceColorKey={workspaceColorKey}
              />
            );
          }
          return null;
        })}
        {streaming && (
          <span className="inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent align-middle" />
        )}
      </div>
    </div>
  );
}

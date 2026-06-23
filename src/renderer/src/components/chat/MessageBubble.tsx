// Renders one OmpMessage. User messages are right-aligned bubbles; assistant
// messages render their content blocks in order (thinking / text / tool calls).
// toolResult messages are folded into their ToolCallCard and render nothing here.

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
import { Markdown } from "./Markdown";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallCard } from "./ToolCallCard";

interface Props {
  message: OmpMessage;
  toolResults: Map<string, ToolResultMessage>;
  streaming?: boolean;
}

export function MessageBubble({ message, toolResults, streaming }: Props) {
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
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-sm text-ink">
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
          {text && <Markdown>{text}</Markdown>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="min-w-0 space-y-1">
        {message.content.map((block: ContentBlock, i: number) => {
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

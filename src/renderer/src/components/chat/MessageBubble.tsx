// Renders one OmpMessage. User messages are right-aligned bubbles; assistant
// messages render their content blocks in order (thinking / text / tool calls).
// toolResult messages are folded into their ToolCallCard and render nothing here.

import type {
  ContentBlock,
  OmpMessage,
  TextBlock,
  ThinkingBlock as ThinkingBlockData,
  ToolCallBlock,
  ToolResultMessage,
} from "@shared/rpc";
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
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .map((b) =>
              b.type === "text" ? String((b as TextBlock).text ?? "") : "",
            )
            .join("");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-sm text-ink">
          <Markdown>{text}</Markdown>
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

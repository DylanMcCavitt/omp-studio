// A single tool invocation: collapsed header (name, one-line args preview,
// status dot) expanding to full arguments and the matched result content.

import type { TextBlock, ToolCallBlock, ToolResultMessage } from "@shared/rpc";
import { ChevronRight, Wrench } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

export function ToolCallCard({
  call,
  result,
}: {
  call: ToolCallBlock;
  result?: ToolResultMessage;
}) {
  const [open, setOpen] = useState(false);

  const status = !result ? "running" : result.isError ? "error" : "success";
  const dotClass =
    status === "running"
      ? "bg-warn animate-pulse"
      : status === "error"
        ? "bg-danger"
        : "bg-success";

  let preview = "";
  try {
    const serialized = JSON.stringify(call.arguments);
    if (serialized && serialized !== "{}") {
      preview =
        serialized.length > 80 ? `${serialized.slice(0, 80)}…` : serialized;
    }
  } catch {
    preview = "";
  }

  let fullArgs = "";
  try {
    fullArgs = JSON.stringify(call.arguments, null, 2);
  } catch {
    fullArgs = String(call.arguments);
  }

  const resultText = (result?.content ?? [])
    .map((b) => (b.type === "text" ? String((b as TextBlock).text ?? "") : ""))
    .filter(Boolean)
    .join("\n");

  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-border-subtle bg-bg-panel/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-hover/40"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform",
            open && "rotate-90",
          )}
        />
        <Wrench className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
        <span className="shrink-0 font-mono text-xs font-medium text-ink">
          {call.name}
        </span>
        {preview && (
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-faint">
            {preview}
          </span>
        )}
        <span
          className={cn("ml-auto h-2 w-2 shrink-0 rounded-full", dotClass)}
          aria-hidden
        />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border-subtle px-3 py-2">
          <div>
            <div className="mb-1 text-[0.7rem] font-medium uppercase tracking-wide text-ink-faint">
              Arguments
            </div>
            <pre className="scrollbar max-h-56 overflow-auto whitespace-pre-wrap rounded bg-bg-raised p-2 font-mono text-xs text-ink-muted">
              {fullArgs}
            </pre>
          </div>
          {result && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[0.7rem] font-medium uppercase tracking-wide text-ink-faint">
                Result
                {result.isError && <span className="text-danger">error</span>}
              </div>
              <pre
                className={cn(
                  "scrollbar max-h-72 overflow-auto whitespace-pre-wrap rounded bg-bg-raised p-2 font-mono text-xs",
                  result.isError ? "text-danger" : "text-ink-muted",
                )}
              >
                {resultText || "(no output)"}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

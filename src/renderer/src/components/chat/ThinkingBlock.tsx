// Collapsible reasoning block. Default collapsed; shows a Brain glyph, the
// "Thinking" label and an approximate token count derived from text length.

import { Brain, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";

export function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false);
  const approxTokens = Math.max(1, Math.round(thinking.length / 4));

  return (
    <div className="my-1 border-l-2 border-thinking/50 pl-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-thinking hover:opacity-80"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            open && "rotate-90",
          )}
        />
        <Brain className="h-3.5 w-3.5" />
        <span className="font-medium">Thinking</span>
        <span className="text-ink-faint">
          {formatNumber(approxTokens)} tokens
        </span>
      </button>
      {open && (
        <pre className="scrollbar mt-1 max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-muted">
          {thinking}
        </pre>
      )}
    </div>
  );
}

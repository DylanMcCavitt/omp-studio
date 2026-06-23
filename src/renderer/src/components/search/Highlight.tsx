import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { TextRange } from "@/lib/searchText";

export interface HighlightProps {
  text: string;
  /** Match ranges (offsets into `text`); rendered wrapped in <mark>. */
  ranges: TextRange[];
  /** Optional class for the <mark> spans. */
  markClassName?: string;
}

/**
 * Render `text` with the given match `ranges` wrapped in <mark>. Ranges are
 * sorted and clamped, and overlaps are merged via a monotonic cursor so the
 * output never double-wraps or drops characters. Empty ranges render as plain
 * text.
 */
export function Highlight({ text, ranges, markClassName }: HighlightProps) {
  if (ranges.length === 0) return <>{text}</>;
  const sorted = ranges
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (!r) continue;
    const start = Math.max(cursor, r.start);
    const end = Math.min(text.length, r.end);
    if (end <= start) continue;
    if (start > cursor) {
      parts.push(
        <Fragment key={`t${i}`}>{text.slice(cursor, start)}</Fragment>,
      );
    }
    parts.push(
      <mark
        key={`m${i}`}
        className={cn("rounded-[2px] bg-warn/30 text-ink", markClassName)}
      >
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) {
    parts.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);
  }
  return <>{parts}</>;
}

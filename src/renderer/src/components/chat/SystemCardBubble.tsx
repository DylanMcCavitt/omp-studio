// Renders one transcript SystemCard — the visible feedback for local slash
// commands, which produce no agent_end. `command_output` shows preformatted text
// (e.g. /help); `session_info` and `config` show a one-line status note. Styled
// as a centered, muted notice so it reads as system chrome, not a chat turn.

import {
  Info,
  type LucideIcon,
  SlidersHorizontal,
  Terminal,
} from "lucide-react";
import type { SystemCard } from "@/store/session-reducer";

const ICONS: Record<SystemCard["kind"], LucideIcon> = {
  command_output: Terminal,
  session_info: Info,
  config: SlidersHorizontal,
};

export function SystemCardBubble({ card }: { card: SystemCard }) {
  const Icon = ICONS[card.kind];
  return (
    <div className="mx-auto w-full max-w-2xl rounded-lg border border-border-subtle bg-bg-raised/60 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
        <Icon className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
        {card.title}
      </div>
      {card.kind === "command_output" ? (
        <pre className="scrollbar mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-ink">
          {card.body}
        </pre>
      ) : (
        <div className="mt-0.5 text-sm text-ink">{card.body}</div>
      )}
    </div>
  );
}

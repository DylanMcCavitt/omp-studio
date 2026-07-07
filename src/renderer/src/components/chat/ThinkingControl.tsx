// AGE-666 — the inline thinking-level picker for the chat header. Replaces the
// old full-height rail `Thinking` panel with a compact toolbar trigger (~h-7)
// showing the active level, which opens a menu of the six reasoning levels.
// Picking one reports it and closes, with the active level marked. Built on the
// shared `Menu`/`MenuItem` primitives so keyboard, focus, and aria come for free.

import type { ThinkingLevel } from "@shared/rpc";
import { Brain, Check, ChevronDown } from "lucide-react";
import { Menu, MenuItem } from "@/components/ui";
import { cn } from "@/lib/cn";

export interface ThinkingControlProps {
  level: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
}

// Ordered low → high; mirrors the levels the session understands.
const LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ThinkingControl({ level, onChange }: ThinkingControlProps) {
  const label = titleCase(level);
  const controlLabel = `Reasoning: ${label}`;
  return (
    <Menu
      align="start"
      aria-label="Reasoning level"
      trigger={({ open, toggle, triggerRef }) => (
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={controlLabel}
          onClick={toggle}
          title={controlLabel}
          className={cn(
            "flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-border-subtle bg-bg-raised px-2 text-xs text-ink",
            "transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          )}
        >
          <Brain className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
          <span className="min-w-0 truncate">
            <span className="text-ink-muted">Reasoning:</span> {label}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
        </button>
      )}
    >
      {LEVELS.map((l) => (
        <MenuItem
          key={l}
          icon={
            <Check
              className={cn(
                "h-4 w-4",
                l === level ? "text-accent" : "text-transparent",
              )}
            />
          }
          onClick={() => onChange(l)}
        >
          {titleCase(l)}
        </MenuItem>
      ))}
    </Menu>
  );
}

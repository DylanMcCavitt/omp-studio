// Composer-anchored slash-command palette. Opens from `/` at an empty composer
// or Cmd/Ctrl+Shift+P (both wired in PromptComposer), lists the active session's
// `availableCommands` (never hardcoded), filters as you type, and on Enter/click
// inserts `/<name> ` into the composer. Keyboard: ↑/↓ navigate, Enter select,
// Esc close. Owns its own search input so the composer's text/image state is
// untouched until a command is chosen.

import type { AvailableCommand } from "@shared/rpc";
import { CornerDownLeft, Slash } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  clampIndex,
  commandInsertText,
  commandName,
  filterCommands,
  moveIndex,
} from "@/lib/slash-commands";

export interface SlashCommandPaletteProps {
  open: boolean;
  commands: AvailableCommand[];
  /** Replace the composer text — used to insert `/<name> ` and refocus it. */
  setText: (text: string) => void;
  /** Close the palette and refocus the composer. */
  close: () => void;
}

export function SlashCommandPalette({
  open,
  commands,
  setText,
  close,
}: SlashCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Fresh query + focus on each open (the component stays mounted, returning
  // null while closed, so state would otherwise persist between invocations).
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    inputRef.current?.focus();
  }, [open]);

  const filtered = filterCommands(commands, query);
  const active = clampIndex(activeIndex, filtered.length);

  // Reset the cursor to the top whenever the result set changes — typing a new
  // query or a live availableCommands update — so arrow nav never starts from a
  // stale index into a now-shorter list.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, filtered.length]);

  // Keep the active row visible.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const select = (command: AvailableCommand) => {
    setText(commandInsertText(command));
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      // Move relative to the visible (clamped) index, never the stale stored
      // one; moveIndex no-ops to 0 for an empty list.
      setActiveIndex(moveIndex(active, "down", filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(moveIndex(active, "up", filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const command = filtered[active];
      if (command) select(command);
    }
  };

  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-border-strong bg-bg-panel shadow-panel">
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Slash className="h-4 w-4 shrink-0 text-ink-faint" />
        <input
          ref={inputRef}
          value={query}
          role="combobox"
          aria-expanded
          aria-controls="slash-command-list"
          aria-label="Filter slash commands"
          placeholder="Search commands…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={close}
          className="w-full bg-transparent py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>

      <div
        ref={listRef}
        id="slash-command-list"
        role="listbox"
        aria-label="Slash commands"
        className="scrollbar max-h-64 overflow-auto p-1.5"
      >
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-ink-faint">
            {commands.length === 0
              ? "No commands available"
              : "No matching commands"}
          </div>
        ) : (
          filtered.map((command, i) => (
            <button
              key={commandName(command)}
              type="button"
              data-index={i}
              role="option"
              aria-selected={i === active}
              // Keep the input focused through the click so onBlur doesn't close
              // the palette before the selection registers.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(command)}
              onMouseMove={() => setActiveIndex(i)}
              className={cn(
                "flex w-full items-baseline gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
                i === active ? "bg-bg-hover" : "hover:bg-bg-hover/60",
              )}
            >
              <span className="shrink-0 font-mono text-sm text-ink">
                /{commandName(command)}
              </span>
              {typeof command.description === "string" &&
                command.description !== "" && (
                  <span className="truncate text-xs text-ink-muted">
                    {command.description}
                  </span>
                )}
            </button>
          ))
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-xs text-ink-faint">
        <span className="flex items-center gap-1">
          <CornerDownLeft className="h-3 w-3" /> insert
        </span>
        <span>↑↓ navigate</span>
        <span>esc close</span>
      </div>
    </div>
  );
}

// Filterable single-select built on Popover + a search input + listbox.
// Generalizes the proven SlashCommandPalette search-list (it reuses the same
// clamp/move cursor helpers) into the sanctioned replacement for long `<select>`
// menus. The trigger shows the selected label; typing filters; Enter/click
// selects and closes (returning focus to the trigger).

import { Check, ChevronsUpDown, Search } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";
import { clampIndex, moveIndex } from "@/lib/slash-commands";
import { Popover } from "./Popover";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional secondary line shown under the label. */
  description?: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  /** Currently selected value (controlled). */
  value: string;
  onChange: (value: string) => void;
  /** Trigger text when nothing is selected. */
  placeholder?: ReactNode;
  searchPlaceholder?: string;
  /** Shown when the filter matches nothing. */
  emptyText?: string;
  disabled?: boolean;
  /** Class for the trigger button. */
  className?: string;
  align?: "start" | "end";
  id?: string;
  "aria-label"?: string;
}

/** Case-insensitive substring match over label, description, then value. */
export function filterOptions(
  options: ComboboxOption[],
  query: string,
): ComboboxOption[] {
  const q = query.trim().toLowerCase();
  if (q === "") return options;
  return options.filter(
    (o) =>
      o.label.toLowerCase().includes(q) ||
      (o.description?.toLowerCase().includes(q) ?? false) ||
      o.value.toLowerCase().includes(q),
  );
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  disabled,
  className,
  align,
  id,
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const selected = options.find((o) => o.value === value);
  const listboxId = useId();

  return (
    <Popover
      align={align}
      className="w-full"
      contentClassName="w-full"
      trigger={({ open, toggle, triggerRef }) => (
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={toggle}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-lg border border-border-subtle bg-bg-raised px-3 py-2 text-left text-sm text-ink",
            "transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate", !selected && "text-ink-faint")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-ink-faint" />
        </button>
      )}
    >
      {({ close }) => (
        <ComboboxList
          options={options}
          value={value}
          listId={listboxId}
          searchPlaceholder={searchPlaceholder}
          emptyText={emptyText}
          onSelect={(v) => {
            onChange(v);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function ComboboxList({
  options,
  value,
  listId,
  searchPlaceholder,
  emptyText,
  onSelect,
}: {
  options: ComboboxOption[];
  value: string;
  listId: string;
  searchPlaceholder: string;
  emptyText: string;
  onSelect: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus the filter input as soon as the panel mounts (i.e. on open).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(
    () => filterOptions(options, query),
    [options, query],
  );
  const active = clampIndex(activeIndex, filtered.length);

  // Reset the cursor to the top whenever the result set changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep the active row visible.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(moveIndex(active, "down", filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(moveIndex(active, "up", filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = filtered[active];
      if (option) onSelect(option.value);
    }
    // Escape is handled by Popover's useDismiss (closes + returns focus).
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="h-4 w-4 shrink-0 text-ink-faint" />
        <input
          ref={inputRef}
          value={query}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full bg-transparent py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        className="scrollbar max-h-64 overflow-auto p-1.5"
      >
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-ink-faint">
            {emptyText}
          </div>
        ) : (
          filtered.map((option, i) => (
            <button
              key={option.value}
              type="button"
              data-index={i}
              role="option"
              aria-selected={option.value === value}
              // Keep the input focused through the click so the selection
              // registers before any blur-driven close.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(option.value)}
              onMouseMove={() => setActiveIndex(i)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
                i === active ? "bg-bg-hover" : "hover:bg-bg-hover/60",
              )}
            >
              <Check
                className={cn(
                  "h-4 w-4 shrink-0",
                  option.value === value ? "text-accent" : "text-transparent",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">
                  {option.label}
                </span>
                {option.description && (
                  <span className="block truncate text-xs text-ink-muted">
                    {option.description}
                  </span>
                )}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

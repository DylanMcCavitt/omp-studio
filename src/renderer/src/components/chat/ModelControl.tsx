// AGE-666 / AGE-705 — the compact model picker chip. A toolbar trigger that
// always shows the active model's name and opens a searchable list of the
// available models, loaded once via `listModels`. Picking one reports its
// `(provider, id)` and closes. AGE-705 leads the chip with a workspace Live Dot
// (hue = identity, fill = session status) and lives in the chat composer's
// controls row. Built on the sanctioned `Popover` primitive; the in-popover
// search reuses the shared `filterModels`/`clampIndex`/`moveIndex` helpers so
// its filtering and keyboard model stay in step with `Combobox` (whose
// fixed-height trigger is why this rolls its own compact one).

import type { ModelInfo } from "@shared/domain";
import type { WorkspaceColorKey } from "@shared/ipc";
import type { RpcModel } from "@shared/rpc";
import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Popover } from "@/components/ui";
import { WorkspaceColorDot } from "@/components/workspace/WorkspaceColor";
import { cn } from "@/lib/cn";
import { filterModels, groupModelsByProvider } from "@/lib/model-options";
import { clampIndex, moveIndex } from "@/lib/slash-commands";
import { useAsync } from "@/lib/useAsync";
import type { SessionStatus } from "@/store/session-reducer";

export interface ModelControlProps {
  /** Active model as reported by the session, or null before it resolves. */
  model: RpcModel | null;
  onChange: (provider: string, id: string) => void;
  /** Active workspace color — paints the leading Live Dot (AGE-705). */
  color?: WorkspaceColorKey;
  /** Active session status — drives the leading Live Dot fill. */
  status?: SessionStatus;
}

export function ModelControl({
  model,
  onChange,
  color,
  status,
}: ModelControlProps) {
  const { data: models, loading } = useAsync(() => window.omp.listModels(), []);
  // The active model carries no `selector`; match it back to the loaded list to
  // know which row is current. Until the list resolves there is no match, but
  // the trigger label comes straight off `model` so it is never blank.
  const current = models?.find(
    (m) => m.provider === model?.provider && m.id === model?.id,
  );
  const label = model
    ? (model.name ?? `${model.provider}/${model.id}`)
    : "Select model";
  const empty = !loading && (models?.length ?? 0) === 0;
  const listboxId = useId();

  return (
    <Popover
      align="start"
      contentClassName="w-72"
      placement="auto"
      portal
      trigger={({ open, toggle, triggerRef }) => (
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          disabled={empty}
          onClick={toggle}
          title={label}
          className={cn(
            "flex h-7 min-w-0 max-w-[13rem] items-center gap-1.5 rounded-md border border-border-subtle bg-bg-raised px-2 font-mono text-xs text-ink",
            "transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <WorkspaceColorDot color={color} status={status} />
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
        </button>
      )}
    >
      {({ close }) => (
        <ModelList
          models={models ?? []}
          currentSelector={current?.selector ?? ""}
          listboxId={listboxId}
          emptyText={loading ? "Loading models…" : "No models available"}
          onSelect={(provider, id) => {
            onChange(provider, id);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function ModelList({
  models,
  currentSelector,
  listboxId,
  emptyText,
  onSelect,
}: {
  models: ModelInfo[];
  currentSelector: string;
  listboxId: string;
  emptyText: string;
  onSelect: (provider: string, id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterModels(models, query), [models, query]);
  const grouped = useMemo(
    () => groupModelsByProvider(filtered),
    [filtered],
  );
  const flatFiltered = useMemo(
    () => grouped.flatMap((group) => group.models),
    [grouped],
  );
  const active = clampIndex(activeIndex, flatFiltered.length);

  // Focus the filter input on open and reset the cursor whenever the query
  // changes — mirrors the Combobox listbox so behaviour reads identically.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const select = (model: ModelInfo) => {
    onSelect(model.provider, model.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(moveIndex(active, "down", flatFiltered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(moveIndex(active, "up", flatFiltered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const model = flatFiltered[active];
      if (model) select(model);
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
          aria-controls={listboxId}
          aria-label="Search models"
          placeholder="Search models…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>

      <div
        ref={listRef}
        id={listboxId}
        role="listbox"
        className="scrollbar max-h-64 overflow-auto p-1.5"
      >
        {flatFiltered.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-ink-faint">
            {emptyText}
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.provider} role="group" aria-label={group.provider}>
              <div className="px-2.5 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-muted first:pt-1">
                {group.provider}
              </div>
              {group.models.map((model) => {
                const index = flatFiltered.findIndex(
                  (item) => item.selector === model.selector,
                );
                return (
                  <button
                    key={model.selector}
                    type="button"
                    data-index={index}
                    role="option"
                    aria-selected={model.selector === currentSelector}
                    // Keep the input focused through the click so the selection
                    // registers before any blur-driven close.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => select(model)}
                    onMouseMove={() => setActiveIndex(index)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
                      index === active ? "bg-bg-hover" : "hover:bg-bg-hover/60",
                    )}
                  >
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        model.selector === currentSelector
                          ? "text-accent"
                          : "text-transparent",
                      )}
                    />
                    <span className="block min-w-0 flex-1 truncate font-mono text-sm text-ink">
                      {model.name}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

import type { SessionSearchHit } from "@shared/domain";
import {
  CornerDownLeft,
  History,
  type LucideIcon,
  MessagesSquare,
  Search,
  TriangleAlert,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NAV } from "@/components/Sidebar";
import { Highlight } from "@/components/search/Highlight";
import { Badge, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import {
  type LiveSessionHit,
  messageText,
  searchLiveSessions,
  type TextRange,
} from "@/lib/searchText";
import { useAsync } from "@/lib/useAsync";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { type Route, useAppStore } from "@/store/app";
import { type LiveSessionState, useChatStore } from "@/store/chat";
import { useUiStore } from "@/store/ui";

type FlatResult =
  | {
      kind: "route";
      key: string;
      route: Route;
      label: string;
      icon: LucideIcon;
    }
  | { kind: "live"; key: string; hit: LiveSessionHit }
  | { kind: "history"; key: string; hit: SessionSearchHit };

const SECTION_LABEL: Record<FlatResult["kind"], string> = {
  route: "Go to",
  live: "Live sessions",
  history: "Transcript matches",
};

const ROLE_LABEL: Record<SessionSearchHit["role"], string> = {
  user: "user",
  assistant: "assistant",
  toolResult: "tool",
};

/** Derive a display title for a live session from its first user message. */
function liveTitle(s: LiveSessionState): string {
  for (const m of s.messages) {
    if (m.role === "user") {
      const t = messageText(m).trim().replace(/\s+/g, " ");
      if (t) return t.length > 60 ? `${t.slice(0, 60)}…` : t;
    }
  }
  return `Session ${s.sessionId.slice(0, 8)}`;
}

/**
 * The Cmd+K overlay body. Mounted only while open so its search state resets on
 * each invocation and no IPC fires when closed. Searches three sources —
 * quick-jump routes, open live sessions (in-memory), and historical transcripts
 * (`searchSessions`, debounced) — into one keyboard-navigable list.
 */
function GlobalSearchOverlay({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const debouncedQuery = useDebouncedValue(query, 150);
  const dialogRef = useFocusTrap<HTMLDivElement>();
  const listRef = useRef<HTMLDivElement>(null);

  const openSessions = useChatStore((s) => s.openSessions);
  const openChat = useChatStore((s) => s.openChat);
  const setRoute = useAppStore((s) => s.setRoute);
  const focusSession = useAppStore((s) => s.focusSession);

  const trimmed = query.trim();
  const trimmedDebounced = debouncedQuery.trim();

  // Historical transcript hits (debounced IPC). Empty query → no scan. The
  // result is tagged with the query that produced it so stale data (useAsync
  // keeps previous data while a new query loads) is never shown or activated.
  const history = useAsync<{
    query: string;
    hits: SessionSearchHit[];
  }>(async () => {
    const q = debouncedQuery;
    const hits = q.trim() ? await window.omp.searchSessions(q) : [];
    return { query: q, hits };
  }, [debouncedQuery]);
  // "Searching" spans the debounce gap and the in-flight scan so a query never
  // flashes "No matches" or stale history before the new hits land.
  const searching =
    trimmed.length > 0 && (trimmed !== trimmedDebounced || history.loading);
  // A failed transcript scan must never read as "no matches": surface it as an
  // explicit error notice once the in-flight/debounce window has settled.
  const historyError =
    trimmed.length > 0 && !searching && Boolean(history.error);

  const routeResults = useMemo<FlatResult[]>(() => {
    const q = trimmed.toLowerCase();
    return NAV.filter((n) => !q || n.label.toLowerCase().includes(q)).map(
      (n) => ({
        kind: "route",
        key: `route:${n.route}`,
        route: n.route,
        label: n.label,
        icon: n.icon,
      }),
    );
  }, [trimmed]);

  const liveResults = useMemo<FlatResult[]>(() => {
    const sessions = Object.values(openSessions);
    if (!trimmed) {
      // No query: surface every open session as a quick switcher entry.
      return sessions.map((s) => ({
        kind: "live",
        key: `live:${s.sessionId}`,
        hit: {
          sessionId: s.sessionId,
          title: liveTitle(s),
          messageIndex: -1,
          snippet: "",
          ranges: [],
        },
      }));
    }
    const inputs = sessions.map((s) => ({
      sessionId: s.sessionId,
      title: liveTitle(s),
      messages: s.messages,
    }));
    return searchLiveSessions(inputs, query).map((hit) => ({
      kind: "live",
      key: `live:${hit.sessionId}`,
      hit,
    }));
  }, [openSessions, query, trimmed]);

  const historyResults = useMemo<FlatResult[]>(() => {
    // Suppress stale/loading history so a click never jumps to a non-matching
    // message; routes + live stay live since they derive from the query directly.
    if (searching || history.data?.query !== debouncedQuery) return [];
    return history.data.hits.map((hit, i) => ({
      kind: "history",
      key: `hist:${hit.session.path}:${hit.messageIndex}:${i}`,
      hit,
    }));
  }, [searching, history.data, debouncedQuery]);

  const results = useMemo<FlatResult[]>(
    () => [...routeResults, ...liveResults, ...historyResults],
    [routeResults, liveResults, historyResults],
  );

  // Reset selection to the top whenever the result set changes shape.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setActiveIndex(0), [trimmed, debouncedQuery, results.length]);

  const active = results.length ? Math.min(activeIndex, results.length - 1) : 0;

  // Keep the active row visible.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${active}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const activate = useCallback(
    (r: FlatResult) => {
      if (r.kind === "route") setRoute(r.route);
      else if (r.kind === "live") openChat(r.hit.sessionId);
      else
        focusSession({
          path: r.hit.session.path,
          messageIndex: r.hit.messageIndex,
        });
      onClose();
    },
    [setRoute, openChat, focusSession, onClose],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[active];
      if (r) activate(r);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close search"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        data-search-overlay
        tabIndex={-1}
        className="relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border-strong bg-bg-panel shadow-panel focus:outline-none"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-ink-faint" />
          <input
            data-autofocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search sessions, transcripts, and pages…"
            aria-label="Search query"
            className="w-full bg-transparent py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
          {searching && <Spinner className="h-4 w-4 shrink-0" />}
        </div>

        <div
          ref={listRef}
          role="listbox"
          aria-label="Search results"
          className="scrollbar min-h-0 flex-1 overflow-auto p-1.5"
        >
          {historyError && (
            <div
              role="alert"
              className="mx-1 mb-1 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs text-danger"
            >
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Transcript search failed. {history.error}</span>
            </div>
          )}
          {results.length === 0 ? (
            historyError ? null : (
              <div className="px-3 py-8 text-center text-sm text-ink-faint">
                {searching
                  ? "Searching…"
                  : trimmed
                    ? `No results for “${trimmed}”`
                    : "Type to search"}
              </div>
            )
          ) : (
            results.map((r, i) => {
              const showHeader = i === 0 || results[i - 1]?.kind !== r.kind;
              return (
                <Fragment key={r.key}>
                  {showHeader && (
                    <div className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                      {SECTION_LABEL[r.kind]}
                    </div>
                  )}
                  <ResultRow
                    result={r}
                    index={i}
                    active={i === active}
                    onActivate={() => activate(r)}
                    onHover={() => setActiveIndex(i)}
                  />
                </Fragment>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-xs text-ink-faint">
          <span className="flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" /> open
          </span>
          <span>↑↓ navigate</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

function SnippetLine({
  snippet,
  ranges,
}: {
  snippet: string;
  ranges: TextRange[];
}) {
  return (
    <div className="truncate text-xs text-ink-muted">
      <Highlight text={snippet} ranges={ranges} />
    </div>
  );
}

function ResultRow({
  result,
  index,
  active,
  onActivate,
  onHover,
}: {
  result: FlatResult;
  index: number;
  active: boolean;
  onActivate: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      data-index={index}
      role="option"
      aria-selected={active}
      onClick={onActivate}
      onMouseMove={onHover}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors",
        active ? "bg-bg-hover" : "hover:bg-bg-hover/60",
      )}
    >
      {result.kind === "route" ? (
        <>
          <result.icon className="h-4 w-4 shrink-0 text-ink-faint" />
          <span className="truncate text-sm text-ink">{result.label}</span>
        </>
      ) : result.kind === "live" ? (
        <>
          <MessagesSquare className="h-4 w-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm text-ink">
                {result.hit.title}
              </span>
              <Badge variant="accent">live</Badge>
            </div>
            {result.hit.snippet && (
              <SnippetLine
                snippet={result.hit.snippet}
                ranges={result.hit.ranges}
              />
            )}
          </div>
        </>
      ) : (
        <>
          <History className="h-4 w-4 shrink-0 text-ink-faint" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm text-ink">
                {result.hit.session.title || "(untitled)"}
              </span>
              <Badge variant={result.hit.role === "user" ? "accent" : "muted"}>
                {ROLE_LABEL[result.hit.role]}
              </Badge>
              <span className="shrink-0 text-xs text-ink-faint">
                {formatRelativeTime(result.hit.updatedAt)}
              </span>
            </div>
            <SnippetLine
              snippet={result.hit.snippet}
              ranges={result.hit.ranges}
            />
          </div>
        </>
      )}
    </button>
  );
}

/**
 * Global Cmd+K search. Always mounted; reads its open flag from the ui store so
 * the single global shortcut manager (lib/useShortcuts) owns the Cmd+K chord —
 * no per-component keydown listener here. All search state lives in a
 * freshly-mounted overlay so each open starts clean and closed state costs nothing.
 */
export function GlobalSearch() {
  const open = useUiStore((s) => s.searchOpen);
  const closeSearch = useUiStore((s) => s.closeSearch);
  if (!open) return null;
  return <GlobalSearchOverlay onClose={closeSearch} />;
}

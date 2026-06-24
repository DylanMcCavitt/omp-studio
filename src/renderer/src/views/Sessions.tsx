import type { SessionSearchHit, SessionSummary } from "@shared/domain";
import {
  Archive,
  FolderGit2,
  Inbox,
  MessagesSquare,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Highlight } from "@/components/search/Highlight";
import {
  type SessionActionResult,
  SessionActionsMenu,
} from "@/components/session/SessionActionsMenu";
import { TranscriptView } from "@/components/transcript/TranscriptView";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Spinner,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  formatBytes,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
} from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useAppStore } from "@/store/app";
import { useChatStore } from "@/store/chat";

interface SessionGroup {
  project: string;
  items: SessionSummary[];
  lastActive: string;
}

function SessionDetail({
  path,
  focusIndex,
  onChanged,
}: {
  path: string;
  focusIndex: number | null;
  onChanged?: (result: SessionActionResult) => void;
}) {
  const { data, loading, error, reload } = useAsync(
    () => window.omp.readSession(path),
    [path],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={<TriangleAlert className="h-6 w-6" />}
          title="Failed to load session"
          hint={error}
          action={
            <Button variant="subtle" size="sm" onClick={reload}>
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </Button>
          }
        />
      </div>
    );
  }
  if (!data) return null;

  const { summary, messages } = data;
  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">
            {summary.title || "(untitled)"}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            {summary.archived && <Badge variant="muted">Archived</Badge>}
            <span>{summary.project}</span>
            <span>·</span>
            <span>{formatDateTime(summary.updatedAt)}</span>
            <span>·</span>
            <span>{formatNumber(summary.messageCount)} messages</span>
            {summary.model && (
              <>
                <span>·</span>
                <Badge variant="muted">{summary.model}</Badge>
              </>
            )}
          </div>
        </div>
        <SessionActionsMenu
          target={{
            path: summary.path,
            title: summary.title,
            archived: Boolean(summary.archived),
          }}
          onChanged={onChanged}
          className="h-8 w-8 shrink-0"
        />
      </div>
      <TranscriptView messages={messages} focusIndex={focusIndex} />
    </div>
  );
}

export default function Sessions() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [detailRefresh, setDetailRefresh] = useState(0);
  const { data, loading, error, reload } = useAsync(
    () => window.omp.listSessions({ includeArchived }),
    [includeArchived],
  );
  const [query, setQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const debouncedQuery = useDebouncedValue(query, 200);

  const sessionFocus = useAppStore((s) => s.sessionFocus);
  const clearSessionFocus = useAppStore((s) => s.clearSessionFocus);
  const newChat = useChatStore((s) => s.newChat);

  // Consume a cross-route focus request (from the Cmd+K overlay): open the
  // requested transcript scrolled to the matched message.
  useEffect(() => {
    if (!sessionFocus) return;
    setSelectedPath(sessionFocus.path);
    setFocusIndex(
      sessionFocus.messageIndex >= 0 ? sessionFocus.messageIndex : null,
    );
    clearSessionFocus();
  }, [sessionFocus, clearSessionFocus]);

  // A non-empty query switches the left panel from the summary list to grouped
  // transcript hits from searchSessions (debounced, server-capped by F2).
  const searchMode = query.trim().length > 0;
  const hitsState = useAsync<{
    query: string;
    hits: SessionSearchHit[];
  }>(async () => {
    const q = debouncedQuery;
    const hits = q.trim()
      ? await window.omp.searchSessions(q, { includeArchived })
      : [];
    return { query: q, hits };
  }, [debouncedQuery, includeArchived]);
  // useAsync keeps the previous data while a new query loads; bind hits to the
  // query that produced them so a stale result set is never shown or clicked.
  const hitGroups = useMemo(() => {
    const hits =
      hitsState.data?.query === debouncedQuery ? hitsState.data.hits : [];
    const byPath = new Map<
      string,
      { session: SessionSummary; hits: SessionSearchHit[] }
    >();
    for (const h of hits) {
      const g = byPath.get(h.session.path);
      if (g) g.hits.push(h);
      else byPath.set(h.session.path, { session: h.session, hits: [h] });
    }
    return [...byPath.values()];
  }, [hitsState.data, debouncedQuery]);
  // "Searching" spans the debounce gap (query ahead of the fired request) and
  // the in-flight scan, so an interim "no matches" never flickers mid-type.
  const searching = query.trim() !== debouncedQuery.trim() || hitsState.loading;

  const openHit = (hit: SessionSearchHit) => {
    setSelectedPath(hit.session.path);
    setFocusIndex(hit.messageIndex);
  };
  const openSummary = (path: string) => {
    setSelectedPath(path);
    setFocusIndex(null);
  };

  const handleSessionChanged = (result: SessionActionResult) => {
    void reload();
    // In search mode the left pane is driven by hitsState, not the summary
    // list, so re-run the search too: deleted/archived hits disappear and a
    // rename reflects the new alias (searchSessions applies aliases).
    if (searchMode) hitsState.reload();
    if (result.kind === "renamed") {
      setDetailRefresh((n) => n + 1);
    } else {
      // deleted / archived / unarchived: the file moved or is gone.
      setSelectedPath(null);
      setFocusIndex(null);
    }
  };

  const groups = useMemo<SessionGroup[]>(() => {
    const byProject = new Map<string, SessionSummary[]>();
    for (const s of data ?? []) {
      const arr = byProject.get(s.project);
      if (arr) arr.push(s);
      else byProject.set(s.project, [s]);
    }
    const result: SessionGroup[] = [];
    for (const [project, items] of byProject) {
      items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      result.push({ project, items, lastActive: items[0]?.updatedAt ?? "" });
    }
    result.sort((a, b) => b.lastActive.localeCompare(a.lastActive));
    return result;
  }, [data]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Sessions</h1>
          <p className="text-sm text-ink-muted">
            Past agent sessions on this machine
          </p>
        </div>
        <IconButton label="Reload sessions" onClick={reload}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[22rem] shrink-0 flex-col border-r border-border">
          <div className="shrink-0 space-y-2 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search transcripts"
                className="w-full rounded-md border border-border bg-bg-raised py-1.5 pl-8 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
            </div>
            <button
              type="button"
              aria-pressed={includeArchived}
              onClick={() => setIncludeArchived((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                includeArchived
                  ? "border-accent/50 bg-accent-soft text-accent"
                  : "border-border text-ink-muted hover:bg-bg-hover hover:text-ink",
              )}
            >
              <Archive className="h-3.5 w-3.5" />
              Show archived
            </button>
          </div>
          <div className="scrollbar min-h-0 flex-1 overflow-auto px-2 pb-3">
            {searchMode ? (
              searching ? (
                <div className="flex justify-center p-8">
                  <Spinner />
                </div>
              ) : hitsState.error ? (
                <EmptyState
                  icon={<TriangleAlert className="h-6 w-6" />}
                  title="Search failed"
                  hint={hitsState.error}
                  action={
                    <Button
                      variant="subtle"
                      size="sm"
                      onClick={() => hitsState.reload()}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Try again
                    </Button>
                  }
                />
              ) : hitGroups.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="h-6 w-6" />}
                  title="No transcript matches"
                  hint={`Nothing matched “${query.trim()}”`}
                  action={
                    <Button
                      variant="subtle"
                      size="sm"
                      onClick={() => setQuery("")}
                    >
                      Clear search
                    </Button>
                  }
                />
              ) : (
                hitGroups.map((group) => (
                  <div key={group.session.path}>
                    <div className="flex items-center gap-2 px-3 pb-0.5 pt-3">
                      <MessagesSquare className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                      <span className="line-clamp-2 min-w-0 break-words text-xs font-semibold text-ink">
                        {group.session.title || "(untitled)"}
                      </span>
                      <Badge variant="muted">{group.hits.length}</Badge>
                      {group.session.archived && (
                        <Badge variant="muted">Archived</Badge>
                      )}
                    </div>
                    <div className="break-words px-3 pb-1 text-xs text-ink-muted">
                      {group.session.project} ·{" "}
                      {formatRelativeTime(group.session.updatedAt)}
                    </div>
                    {group.hits.map((hit, i) => (
                      <button
                        key={`${hit.messageIndex}-${i}`}
                        onClick={() => openHit(hit)}
                        className={cn(
                          "flex w-full flex-col items-start gap-1 rounded-md border border-transparent px-3 py-2 text-left transition hover:bg-bg-hover",
                          selectedPath === hit.session.path &&
                            focusIndex === hit.messageIndex &&
                            "border-border-strong bg-bg-hover",
                        )}
                      >
                        <Badge
                          variant={hit.role === "user" ? "accent" : "muted"}
                        >
                          {hit.role === "toolResult" ? "tool" : hit.role}
                        </Badge>
                        <span className="line-clamp-2 break-words text-xs text-ink-muted">
                          <Highlight text={hit.snippet} ranges={hit.ranges} />
                        </span>
                      </button>
                    ))}
                  </div>
                ))
              )
            ) : loading ? (
              <div className="flex justify-center p-8">
                <Spinner />
              </div>
            ) : error ? (
              <EmptyState
                icon={<TriangleAlert className="h-6 w-6" />}
                title="Failed to load sessions"
                hint={error}
                action={
                  <Button variant="subtle" size="sm" onClick={reload}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Try again
                  </Button>
                }
              />
            ) : groups.length === 0 ? (
              <EmptyState
                icon={<Inbox className="h-6 w-6" />}
                title="No sessions yet"
                hint="Past agent sessions on this machine appear here. Start a chat to create your first one."
                action={
                  <Button variant="ghost" size="sm" onClick={newChat}>
                    <Plus className="h-3.5 w-3.5" />
                    Start a chat
                  </Button>
                }
              />
            ) : (
              groups.map((group) => (
                <div key={group.project}>
                  <div className="flex items-center gap-2 px-3 pb-1 pt-3">
                    <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                    <span className="min-w-0 break-words text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      {group.project}
                    </span>
                    <Badge variant="muted">{group.items.length}</Badge>
                  </div>
                  {group.items.map((s) => (
                    <button
                      key={s.path}
                      onClick={() => openSummary(s.path)}
                      className={cn(
                        "flex w-full flex-col gap-1 rounded-md border border-transparent px-3 py-2 text-left transition hover:bg-bg-hover",
                        selectedPath === s.path &&
                          "border-border-strong bg-bg-hover",
                      )}
                    >
                      <span className="line-clamp-2 break-words text-sm text-ink">
                        {s.title || "(untitled)"}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                        {s.archived && <Badge variant="muted">Archived</Badge>}
                        <span>{formatRelativeTime(s.updatedAt)}</span>
                        <span>·</span>
                        <span>{formatNumber(s.messageCount)} msgs</span>
                        {s.model && (
                          <>
                            <span>·</span>
                            <Badge variant="muted">{s.model}</Badge>
                          </>
                        )}
                        <span>·</span>
                        <span>{formatBytes(s.sizeBytes)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="scrollbar min-h-0 flex-1 overflow-auto">
          {selectedPath ? (
            <SessionDetail
              key={`${selectedPath}:${detailRefresh}`}
              path={selectedPath}
              focusIndex={focusIndex}
              onChanged={handleSessionChanged}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <EmptyState
                icon={<MessagesSquare className="h-6 w-6" />}
                title="Select a session"
                hint="Pick a session on the left to read its transcript."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import type { SessionSummary } from "@shared/domain";
import type {
  ContentBlock,
  OmpMessage,
  TextBlock,
  ThinkingBlock,
  ToolCallBlock,
} from "@shared/rpc";
import {
  FolderGit2,
  Inbox,
  MessagesSquare,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, EmptyState, IconButton, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  formatBytes,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
} from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

interface SessionGroup {
  project: string;
  items: SessionSummary[];
  lastActive: string;
}

function blocksText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
}

function argsPreview(args: unknown): string {
  let raw: string;
  try {
    raw = typeof args === "string" ? args : JSON.stringify(args);
  } catch {
    raw = String(args);
  }
  const flat = (raw ?? "").replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
}

function AssistantBlock({ block }: { block: ContentBlock }) {
  if (block.type === "text") {
    return (
      <div className="whitespace-pre-wrap break-words font-mono text-xs text-ink">
        {(block as TextBlock).text}
      </div>
    );
  }
  if (block.type === "thinking") {
    return (
      <details className="rounded-md bg-bg-panel px-2 py-1">
        <summary className="cursor-pointer select-none text-xs text-ink-faint">
          thinking
        </summary>
        <div className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-ink-muted">
          {(block as ThinkingBlock).thinking}
        </div>
      </details>
    );
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallBlock;
    return (
      <div className="flex items-start gap-2">
        <Badge variant="warn">tool</Badge>
        <code className="break-words font-mono text-xs text-ink-muted">
          {tc.name}(
          <span className="text-ink-faint">{argsPreview(tc.arguments)}</span>)
        </code>
      </div>
    );
  }
  return <div className="font-mono text-xs text-ink-faint">[{block.type}]</div>;
}

function MessageBlock({ message }: { message: OmpMessage }) {
  if (message.role === "user") {
    const text = blocksText(message.content);
    return (
      <div className="space-y-1">
        <Badge variant="accent">user</Badge>
        <div className="whitespace-pre-wrap break-words font-mono text-xs text-ink">
          {text || <span className="text-ink-faint">(empty)</span>}
        </div>
      </div>
    );
  }
  if (message.role === "toolResult") {
    const body = blocksText(message.content);
    const shown =
      body.length > 2000 ? `${body.slice(0, 2000)}\n… (truncated)` : body;
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Badge variant={message.isError ? "danger" : "muted"}>
            tool result
          </Badge>
          <span className="font-mono text-xs text-ink-muted">
            {message.toolName}
          </span>
        </div>
        <pre className="scrollbar overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-bg-panel p-2 font-mono text-xs text-ink-muted">
          {shown || "(no output)"}
        </pre>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Badge>assistant</Badge>
      {message.content.map((block, i) => (
        <AssistantBlock key={i} block={block} />
      ))}
    </div>
  );
}

function SessionDetail({ path }: { path: string }) {
  const { data, loading, error } = useAsync(
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
        />
      </div>
    );
  }
  if (!data) return null;

  const { summary, messages } = data;
  return (
    <div className="p-6">
      <div className="mb-4 border-b border-border pb-3">
        <h2 className="text-base font-semibold text-ink">
          {summary.title || "(untitled)"}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
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
      {messages.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare className="h-6 w-6" />}
          title="No messages in this session"
        />
      ) : (
        <div className="space-y-4">
          {messages.map((message, i) => (
            <MessageBlock key={i} message={message} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sessions() {
  const { data, loading, error, reload } = useAsync(() =>
    window.omp.listSessions(),
  );
  const [query, setQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const groups = useMemo<SessionGroup[]>(() => {
    const list = data ?? [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (s) =>
            (s.title ?? "").toLowerCase().includes(q) ||
            s.project.toLowerCase().includes(q) ||
            (s.model ?? "").toLowerCase().includes(q),
        )
      : list;
    const byProject = new Map<string, SessionSummary[]>();
    for (const s of filtered) {
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
  }, [data, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Sessions</h1>
          <p className="truncate text-sm text-ink-muted">
            Past agent sessions on this machine
          </p>
        </div>
        <IconButton label="Reload sessions" onClick={reload}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[22rem] shrink-0 flex-col border-r border-border">
          <div className="shrink-0 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sessions"
                className="w-full rounded-md border border-border bg-bg-raised py-1.5 pl-8 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
            </div>
          </div>
          <div className="scrollbar min-h-0 flex-1 overflow-auto px-2 pb-3">
            {loading ? (
              <div className="flex justify-center p-8">
                <Spinner />
              </div>
            ) : error ? (
              <EmptyState
                icon={<TriangleAlert className="h-6 w-6" />}
                title="Failed to load sessions"
                hint={error}
              />
            ) : groups.length === 0 ? (
              <EmptyState
                icon={<Inbox className="h-6 w-6" />}
                title={query ? "No matching sessions" : "No sessions yet"}
              />
            ) : (
              groups.map((group) => (
                <div key={group.project}>
                  <div className="flex items-center gap-2 px-3 pb-1 pt-3">
                    <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                    <span className="truncate text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      {group.project}
                    </span>
                    <Badge variant="muted">{group.items.length}</Badge>
                  </div>
                  {group.items.map((s) => (
                    <button
                      key={s.path}
                      onClick={() => setSelectedPath(s.path)}
                      className={cn(
                        "flex w-full flex-col gap-1 rounded-md border border-transparent px-3 py-2 text-left transition hover:bg-bg-hover",
                        selectedPath === s.path &&
                          "border-border-strong bg-bg-hover",
                      )}
                    >
                      <span className="truncate text-sm text-ink">
                        {s.title || "(untitled)"}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
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
            <SessionDetail path={selectedPath} />
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

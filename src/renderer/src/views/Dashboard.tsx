import {
  Bot,
  Boxes,
  ChevronRight,
  FolderGit2,
  Github,
  Inbox,
  MessagesSquare,
  Plug,
  Plus,
  RefreshCw,
  Sparkles,
  SquareKanban,
} from "lucide-react";
import { useEffect } from "react";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Panel,
  Spinner,
  Stat,
} from "@/components/ui";
import { formatNumber, formatRelativeTime } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { useChatStore } from "@/store/chat";
import { useLinearStore } from "@/store/linear";
import { useShellStore } from "@/store/shell";

export default function Dashboard() {
  const setOpenPanel = useShellStore((s) => s.setOpenPanel);
  const newChat = useChatStore((s) => s.newChat);
  const { data, loading, error, reload } = useAsync(() =>
    window.omp.getDashboard(),
  );

  return (
    <div className="scrollbar h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <header className="no-drag flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-xl font-semibold text-ink">
              Dashboard
            </h1>
            <p className="truncate text-sm text-ink-muted">
              Overview of your Oh My Pi harness
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" onClick={newChat}>
              <Plus size={16} />
              Start a chat
            </Button>
            <IconButton label="Reload dashboard" onClick={reload}>
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </IconButton>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            Failed to load dashboard: {error}
          </div>
        )}

        {!data && loading && (
          <div className="flex items-center justify-center py-20">
            <Spinner size={24} />
          </div>
        )}

        {data && (
          <>
            <section className="grid grid-cols-2 gap-3 auto-rows-fr">
              <Stat
                label="Sessions"
                value={formatNumber(data.sessions.total)}
                hint={`${data.sessions.byProject.length} projects`}
                icon={<MessagesSquare size={16} />}
              />
              <Stat
                label="Models"
                value={formatNumber(data.models.total)}
                hint={`${data.models.providers} providers`}
                icon={<Boxes size={16} />}
              />
              <Stat
                label="Skills"
                value={formatNumber(data.skills)}
                icon={<Sparkles size={16} />}
              />
              <Stat
                label="Agents"
                value={formatNumber(data.agents)}
                icon={<Bot size={16} />}
              />
              <Stat
                label="MCP servers"
                value={formatNumber(data.mcp.length)}
                icon={<Plug size={16} />}
              />
              <Stat
                label="GitHub issues"
                value={formatNumber(data.github.openIssues)}
                hint={`${formatNumber(data.github.openPrs)} open PRs`}
                icon={<Github size={16} />}
              />
            </section>

            <div className="flex flex-col gap-4">
              <Panel
                title="Recent sessions"
                bodyClassName="p-0"
                actions={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOpenPanel("sessions")}
                  >
                    View all
                    <ChevronRight size={14} />
                  </Button>
                }
              >
                {data.sessions.recent.length === 0 ? (
                  <EmptyState
                    icon={<Inbox size={28} />}
                    title="No sessions yet"
                    hint="Start a chat to create your first session."
                    action={
                      <Button variant="subtle" size="sm" onClick={newChat}>
                        <Plus size={14} />
                        Start a chat
                      </Button>
                    }
                  />
                ) : (
                  <ul className="divide-y divide-border-subtle">
                    {data.sessions.recent.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => setOpenPanel("sessions")}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:bg-bg-hover"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink">
                              {s.title ?? "Untitled session"}
                            </p>
                            <p className="truncate text-xs text-ink-muted">
                              {s.project}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="text-xs text-ink-muted">
                              {formatRelativeTime(s.updatedAt)}
                            </span>
                            <Badge variant="muted">
                              {formatNumber(s.messageCount)} msgs
                            </Badge>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <div className="flex flex-col gap-4">
                <Panel title="MCP servers" bodyClassName="p-0">
                  {data.mcp.length === 0 ? (
                    <EmptyState
                      icon={<Plug size={24} />}
                      title="No MCP servers"
                      hint="Configure servers in mcp.json."
                    />
                  ) : (
                    <ul className="divide-y divide-border-subtle">
                      {data.mcp.map((server) => (
                        <li
                          key={`${server.source}:${server.name}`}
                          className="flex items-center justify-between gap-2 px-4 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">
                              {server.name}
                            </p>
                            <p className="text-xs text-ink-muted">
                              {server.type}
                            </p>
                          </div>
                          <Badge variant={server.enabled ? "success" : "muted"}>
                            {server.enabled ? "on" : "off"}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>

                <Panel title="Projects" bodyClassName="p-0">
                  {data.sessions.byProject.length === 0 ? (
                    <EmptyState
                      icon={<FolderGit2 size={24} />}
                      title="No projects"
                      hint="Sessions are grouped by project here."
                    />
                  ) : (
                    <ul className="divide-y divide-border-subtle">
                      {data.sessions.byProject.map((p) => (
                        <li
                          key={p.project}
                          className="flex items-center justify-between gap-2 px-4 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">
                              {p.project}
                            </p>
                            <p className="text-xs text-ink-muted">
                              {formatRelativeTime(p.lastActive)}
                            </p>
                          </div>
                          <Badge variant="muted">{formatNumber(p.count)}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>

                <MyLinearIssuesPanel />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Feature 2 — "My Linear issues" summary. Reuses store/linear.ts (the same store
// the Linear view drives); only one view mounts at a time, so refreshing the
// shared issue list here never races the full view. Degrades to a connect
// prompt when no key is validated.
function MyLinearIssuesPanel() {
  const setOpenPanel = useShellStore((s) => s.setOpenPanel);
  const status = useLinearStore((s) => s.status);
  const issues = useLinearStore((s) => s.issues);
  const loading = useLinearStore((s) => s.loading);
  const loadStatus = useLinearStore((s) => s.loadStatus);
  const loadIssues = useLinearStore((s) => s.loadIssues);

  const connected = status?.status === "authenticated";

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);
  useEffect(() => {
    if (connected) void loadIssues({ assignedToMe: true });
  }, [connected, loadIssues]);

  const mine = issues.slice(0, 6);

  return (
    <Panel
      title="My Linear issues"
      bodyClassName="p-0"
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpenPanel("linear")}
        >
          Open
          <ChevronRight size={14} />
        </Button>
      }
    >
      {!connected ? (
        <EmptyState
          icon={<SquareKanban size={24} />}
          title={
            status?.status === "error" ? "Linear unavailable" : "Not connected"
          }
          hint="Connect Linear to see issues assigned to you."
          action={
            <Button
              variant="subtle"
              size="sm"
              onClick={() => setOpenPanel("linear")}
            >
              Connect Linear
            </Button>
          }
        />
      ) : loading && issues.length === 0 ? (
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      ) : mine.length === 0 ? (
        <EmptyState icon={<Inbox size={24} />} title="No assigned issues" />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {mine.map((issue) => (
            <li key={issue.id}>
              <button
                type="button"
                onClick={() => window.omp.openExternal(issue.url)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:outline-none"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {issue.title}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {issue.identifier}
                    {issue.team?.key ? ` · ${issue.team.key}` : ""}
                  </p>
                </div>
                <Badge variant="muted">{issue.state.name}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

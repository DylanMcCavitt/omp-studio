import type {
  OmpStatsAggregate,
  OmpStatsBreakdown,
  OmpStatsSnapshot,
  ProjectSessions,
} from "@shared/domain";
import {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Database,
  FolderGit2,
  Gauge,
  Github,
  Inbox,
  MessagesSquare,
  Plug,
  Plus,
  RefreshCw,
  Sparkles,
  SquareKanban,
  TrendingUp,
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
  const stats = useAsync(() => window.omp.getOmpStats(), []);
  const reloadAll = () => {
    reload();
    stats.reload();
  };

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
            <IconButton label="Reload dashboard" onClick={reloadAll}>
              <RefreshCw
                size={16}
                className={loading || stats.loading ? "animate-spin" : ""}
              />
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

            <OmpStatsPanel
              stats={stats.data}
              loading={stats.loading}
              error={stats.error}
              projects={data.sessions.byProject}
              onRefresh={stats.reload}
            />

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

function readNumber(
  value: Record<string, unknown> | undefined,
  keys: string[],
): number | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const n = value[key];
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return undefined;
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? "—" : formatNumber(value);
}

function formatPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const pct = Math.abs(value) <= 1 ? value * 100 : value;
  return `${pct.toFixed(pct >= 10 ? 1 : 2)}%`;
}

function formatCost(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

function formatMillis(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value >= 1000
    ? `${(value / 1000).toFixed(1)}s`
    : `${Math.round(value)}ms`;
}

function totalTokens(
  overall: OmpStatsAggregate | undefined,
): number | undefined {
  if (!overall) return undefined;
  const keys = [
    "totalInputTokens",
    "totalOutputTokens",
    "totalCacheReadTokens",
    "totalCacheWriteTokens",
  ];
  let total = 0;
  let found = false;
  for (const key of keys) {
    const n = readNumber(overall, [key]);
    if (n !== undefined) {
      total += n;
      found = true;
    }
  }
  return found ? total : undefined;
}

function breakdownMetric(row: OmpStatsBreakdown): number | undefined {
  return readNumber(row, ["totalCost", "cost", "totalRequests", "requests"]);
}

function compactLabel(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function modelLabel(row: OmpStatsBreakdown): string {
  const model = compactLabel(row.model);
  const provider = compactLabel(row.provider);
  if (model && provider) return `${provider}/${model}`;
  return model ?? provider ?? compactLabel(row.name) ?? "Unknown model";
}

function folderLabel(
  row: OmpStatsBreakdown,
  projects: ProjectSessions[],
): string {
  const folder =
    compactLabel(row.folder) ?? compactLabel(row.name) ?? "Unknown folder";
  const match = projects.find((project) => {
    const cwdBase = project.cwd.split(/[\\/]/).filter(Boolean).at(-1);
    return (
      project.project === folder || project.cwd === folder || cwdBase === folder
    );
  });
  return match ? match.project : folder;
}

function agentLabel(row: OmpStatsBreakdown): string {
  return (
    compactLabel(row.agentType) ??
    compactLabel(row.type) ??
    compactLabel(row.name) ??
    "Unknown agent"
  );
}

function sortBreakdown(
  rows: OmpStatsBreakdown[] | undefined,
): OmpStatsBreakdown[] {
  return [...(rows ?? [])]
    .sort((a, b) => (breakdownMetric(b) ?? 0) - (breakdownMetric(a) ?? 0))
    .slice(0, 5);
}

function BreakdownList({
  title,
  rows,
  label,
}: {
  title: string;
  rows: OmpStatsBreakdown[] | undefined;
  label: (row: OmpStatsBreakdown) => string;
}) {
  const top = sortBreakdown(rows);
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-soft/40">
      <div className="border-b border-border-subtle px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
        {title}
      </div>
      {top.length === 0 ? (
        <p className="px-3 py-4 text-sm text-ink-muted">No data yet.</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {top.map((row, index) => (
            <li
              key={`${title}:${label(row)}:${index}`}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span className="min-w-0 truncate text-sm text-ink">
                {label(row)}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                {formatCost(readNumber(row, ["totalCost", "cost"]))}
                {" · "}
                {formatOptionalNumber(
                  readNumber(row, ["totalRequests", "requests"]),
                )}{" "}
                req
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OmpStatsPanel({
  stats,
  loading,
  error,
  projects,
  onRefresh,
}: {
  stats: OmpStatsSnapshot | null | undefined;
  loading: boolean;
  error: string | undefined;
  projects: ProjectSessions[];
  onRefresh: () => void;
}) {
  const overall = stats?.overall;
  const requests = readNumber(overall, ["totalRequests", "requests"]);
  const failed = readNumber(overall, ["failedRequests", "failures"]);
  const cost = readNumber(overall, ["totalCost", "cost"]);
  const avgTtft = readNumber(overall, ["avgTtft", "ttft"]);
  const avgDuration = readNumber(overall, ["avgDuration", "duration"]);
  const throughput = readNumber(overall, [
    "avgTokensPerSecond",
    "tokensPerSecond",
  ]);
  const last = readNumber(overall, ["lastTimestamp"]);

  return (
    <Panel
      title="OMP stats"
      actions={
        <IconButton
          label="Refresh OMP stats"
          onClick={onRefresh}
          disabled={loading}
          className="h-7 w-7"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </IconButton>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <Badge variant="muted">Global local stats</Badge>
        <span>Estimated cost from local OMP stats.</span>
        {last !== undefined && (
          <span>Last activity {formatRelativeTime(last)}</span>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          Failed to load OMP stats: {error}
        </div>
      )}

      {loading && !stats ? (
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      ) : !stats ? (
        <EmptyState
          icon={<BarChart3 size={24} />}
          title="OMP stats unavailable"
          hint="The dashboard still works; stats appear when `omp stats --json` is available."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat
              label="Requests"
              value={formatOptionalNumber(requests)}
              hint={`${formatOptionalNumber(failed)} failed · ${formatPercent(
                readNumber(overall, ["errorRate"]),
              )}`}
              icon={<Activity size={16} />}
            />
            <Stat
              label="Tokens"
              value={formatOptionalNumber(totalTokens(overall))}
              hint={`${formatPercent(
                readNumber(overall, ["cacheRate"]),
              )} cache hit`}
              icon={<Database size={16} />}
            />
            <Stat
              label="Est. cost"
              value={formatCost(cost)}
              hint="Local OMP stats"
              icon={<CircleDollarSign size={16} />}
            />
            <Stat
              label="Avg TTFT"
              value={formatMillis(avgTtft)}
              hint={`Duration ${formatMillis(avgDuration)}`}
              icon={<Clock3 size={16} />}
            />
            <Stat
              label="Throughput"
              value={
                throughput === undefined
                  ? "—"
                  : `${throughput.toFixed(1)} tok/s`
              }
              hint="Average decode speed"
              icon={<Gauge size={16} />}
            />
            <Stat
              label="Trend points"
              value={formatNumber(stats.timeSeries?.length ?? 0)}
              hint="Recent local history"
              icon={<TrendingUp size={16} />}
            />
          </section>

          <div className="grid gap-3 lg:grid-cols-3">
            <BreakdownList
              title="Top models"
              rows={stats.byModel}
              label={modelLabel}
            />
            <BreakdownList
              title="Top folders"
              rows={stats.byFolder}
              label={(row) => folderLabel(row, projects)}
            />
            <BreakdownList
              title="Agent split"
              rows={stats.byAgentType}
              label={agentLabel}
            />
          </div>
        </div>
      )}
    </Panel>
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

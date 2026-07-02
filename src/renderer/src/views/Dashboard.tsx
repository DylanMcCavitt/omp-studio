import type {
  OmpStatsAggregate,
  OmpStatsBreakdown,
  OmpStatsSnapshot,
  ProjectSessions,
} from "@shared/domain";
import {
  BarChart3,
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
import { useEffect, useState } from "react";
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

  useEffect(() => {
    const id = window.setInterval(reloadAll, 30_000);
    return () => window.clearInterval(id);
  }, [reload, stats.reload]);

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
            <section className="grid grid-cols-1 gap-3 auto-rows-fr sm:grid-cols-[repeat(2,minmax(0,1fr))]">
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
  const exact = projects.find(
    (project) => project.project === folder || project.cwd === folder,
  );
  if (exact) return exact.project;

  const basenameMatches = projects.filter(
    (project) => project.cwd.split(/[\\/]/).filter(Boolean).at(-1) === folder,
  );
  return basenameMatches.length === 1
    ? (basenameMatches[0]?.project ?? folder)
    : folder;
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

function NativeBreakdownList({
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
    <div className="rounded-2xl border border-border-subtle bg-bg-raised/80">
      <div className="border-b border-border-subtle px-4 py-3">
        <h3 className="font-semibold text-sm text-ink">{title}</h3>
      </div>
      {top.length === 0 ? (
        <p className="px-4 py-4 text-sm text-ink-muted">No data yet.</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {top.map((row, index) => {
            const requests = readNumber(row, ["totalRequests", "requests"]);
            const cost = readNumber(row, ["totalCost", "cost"]);
            return (
              <li
                key={`${title}:${label(row)}:${index}`}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="min-w-0 truncate text-sm font-medium text-ink">
                  {label(row)}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                  {formatCost(cost)}
                  {" · "}
                  {formatOptionalNumber(requests)} req
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatCompactNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}K`;
  return formatNumber(Math.round(value));
}

function metricTokens(row: OmpStatsAggregate | undefined): number | undefined {
  return totalTokens(row);
}

function NativeMetricCard({
  label,
  value,
  primary,
}: {
  label: string;
  value: string;
  primary?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-2xl border border-border-subtle bg-bg-raised p-5 ${
        primary ? "min-h-28" : "min-h-20"
      }`}
    >
      <div
        className={`font-semibold uppercase tracking-[0.18em] ${
          primary ? "text-fuchsia-500" : "text-ink-muted"
        } text-xs`}
      >
        {label}
      </div>
      <div
        className={`mt-4 truncate font-semibold tracking-tight text-ink ${
          primary ? "text-3xl" : "text-2xl"
        }`}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function agentTokenTotal(row: OmpStatsBreakdown): number {
  return (
    (readNumber(row, ["totalInputTokens"]) ?? 0) +
    (readNumber(row, ["totalOutputTokens"]) ?? 0) +
    (readNumber(row, ["totalCacheReadTokens"]) ?? 0) +
    (readNumber(row, ["totalCacheWriteTokens"]) ?? 0)
  );
}

function AgentUsagePanel({ rows }: { rows: OmpStatsBreakdown[] | undefined }) {
  const agents = sortBreakdown(rows).slice(0, 3);
  const total = agents.reduce((sum, row) => sum + agentTokenTotal(row), 0);
  const colors = ["#ec3fb5", "#8b5cf6", "#22c55e"];
  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-raised">
      <div className="border-b border-border-subtle px-5 py-4">
        <h3 className="font-semibold text-base text-ink">
          Token Usage by Agent
        </h3>
        <p className="mt-1 text-sm text-ink-muted">
          Share of tokens across the main agent and task subagents
        </p>
      </div>
      <div className="p-5">
        <div className="flex h-4 overflow-hidden rounded-full bg-bg-soft">
          {agents.map((row, index) => {
            const pct = total > 0 ? (agentTokenTotal(row) / total) * 100 : 0;
            return (
              <div
                key={`${agentLabel(row)}:bar`}
                className="h-full"
                style={{ width: `${pct}%`, backgroundColor: colors[index] }}
              />
            );
          })}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
          {agents.map((row, index) => {
            const tokens = agentTokenTotal(row);
            const pct = total > 0 ? (tokens / total) * 100 : 0;
            return (
              <div
                key={`${agentLabel(row)}:legend`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-bg-soft/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: colors[index] }}
                    />
                    <span
                      className="min-w-0 flex-1 truncate text-sm font-medium text-ink"
                      title={agentLabel(row)}
                    >
                      {agentLabel(row)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-ink-muted">
                    {formatOptionalNumber(
                      readNumber(row, ["totalRequests", "requests"]),
                    )}{" "}
                    req · {formatCompactNumber(tokens)} tok
                  </div>
                </div>
                <div className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                  {pct.toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ThroughputChart({ rows }: { rows: OmpStatsBreakdown[] | undefined }) {
  const series = [...(rows ?? [])].slice(-24);
  const maxRequests = Math.max(
    1,
    ...series.map((row) => readNumber(row, ["requests", "totalRequests"]) ?? 0),
  );
  const points = series.map((row, index) => {
    const x = series.length <= 1 ? 0 : (index / (series.length - 1)) * 100;
    const requests = readNumber(row, ["requests", "totalRequests"]) ?? 0;
    const y = 100 - (requests / maxRequests) * 82 - 8;
    return `${x},${y}`;
  });
  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-raised">
      <div className="border-b border-border-subtle px-5 py-4">
        <h3 className="font-semibold text-base text-ink">System Throughput</h3>
        <p className="mt-1 text-sm text-ink-muted">
          Request volume and errors over time
        </p>
      </div>
      <div className="p-5">
        {series.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">
            No trend data yet.
          </p>
        ) : (
          <svg
            viewBox="0 0 100 100"
            role="img"
            aria-label="Request volume over time"
            className="h-48 w-full overflow-visible"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient
                id="stats-throughput-fill"
                x1="0"
                x2="0"
                y1="0"
                y2="1"
              >
                <stop offset="0%" stopColor="#ec3fb5" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#ec3fb5" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon
              points={`0,100 ${points.join(" ")} 100,100`}
              fill="url(#stats-throughput-fill)"
            />
            <polyline
              points={points.join(" ")}
              fill="none"
              stroke="#ec3fb5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.6"
            />
            {series.map((row, index) => {
              const errors = readNumber(row, ["errors", "failedRequests"]) ?? 0;
              if (errors <= 0) return null;
              const x =
                series.length <= 1 ? 0 : (index / (series.length - 1)) * 100;
              return (
                <line
                  key={`${readNumber(row, ["timestamp"]) ?? index}:errors`}
                  x1={x}
                  x2={x}
                  y1={90}
                  y2={100}
                  stroke="#ef4444"
                  strokeLinecap="round"
                  strokeWidth="2"
                />
              );
            })}
          </svg>
        )}
      </div>
    </section>
  );
}

const STATS_RANGES = [
  { label: "1h", ms: 60 * 60 * 1000 },
  { label: "24h", ms: 24 * 60 * 60 * 1000 },
  { label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
  { label: "90d", ms: 90 * 24 * 60 * 60 * 1000 },
  { label: "All", ms: null },
] as const;

type StatsRange = (typeof STATS_RANGES)[number]["label"];

function rowTimestamp(row: OmpStatsBreakdown): number | undefined {
  return readNumber(row, ["timestamp"]);
}

function filterRowsByRange<T extends OmpStatsBreakdown>(
  rows: T[] | undefined,
  range: StatsRange,
): T[] {
  const series = rows ?? [];
  const selected = STATS_RANGES.find((item) => item.label === range);
  if (!selected?.ms || series.length === 0) return series;
  const latest = Math.max(
    ...series.map((row) => rowTimestamp(row) ?? 0).filter((n) => n > 0),
  );
  if (!Number.isFinite(latest) || latest <= 0) return series;
  const cutoff = latest - selected.ms;
  return series.filter((row) => (rowTimestamp(row) ?? latest) >= cutoff);
}

function sumValues(values: Array<number | undefined>): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function rollupSeries(
  rows: OmpStatsBreakdown[],
  fallback: OmpStatsAggregate | undefined,
): OmpStatsAggregate | undefined {
  if (rows.length === 0) return fallback;
  const requests = rows.map((row) =>
    readNumber(row, ["requests", "totalRequests"]),
  );
  const failures = rows.map((row) =>
    readNumber(row, ["errors", "failedRequests"]),
  );
  const costs = rows.map((row) => readNumber(row, ["cost", "totalCost"]));
  const totalRequests = sumValues(requests);
  const failedRequests = sumValues(failures);
  const totalCost = sumValues(costs);
  const hasRequests = requests.some((value) => value !== undefined);
  const hasFailures = failures.some((value) => value !== undefined);
  const hasCosts = costs.some((value) => value !== undefined);
  return {
    ...fallback,
    ...(hasRequests ? { totalRequests } : {}),
    ...(hasFailures
      ? {
          failedRequests,
          errorRate: totalRequests > 0 ? failedRequests / totalRequests : 0,
        }
      : {}),
    ...(hasCosts ? { totalCost } : {}),
  };
}

function aggregateModels(rows: OmpStatsBreakdown[] | undefined) {
  const byKey = new Map<string, OmpStatsBreakdown>();
  for (const row of rows ?? []) {
    const key = modelLabel(row);
    const current = byKey.get(key) ?? {
      provider: row.provider,
      model: row.model,
      totalRequests: 0,
      totalCost: 0,
    };
    current.totalRequests =
      (readNumber(current, ["totalRequests", "requests"]) ?? 0) +
      (readNumber(row, ["totalRequests", "requests"]) ?? 0);
    current.totalCost =
      (readNumber(current, ["totalCost", "cost"]) ?? 0) +
      (readNumber(row, ["totalCost", "cost"]) ?? 0);
    byKey.set(key, current);
  }
  return [...byKey.values()];
}

function RecentModelActivity({
  rows,
}: {
  rows: OmpStatsBreakdown[] | undefined;
}) {
  const recent = [...(rows ?? [])]
    .sort((a, b) => (rowTimestamp(b) ?? 0) - (rowTimestamp(a) ?? 0))
    .slice(0, 6);

  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-raised">
      <div className="border-b border-border-subtle px-5 py-4">
        <h3 className="font-semibold text-base text-ink">
          Recent model activity
        </h3>
        <p className="mt-1 text-sm text-ink-muted">
          Latest model buckets from the local stats snapshot
        </p>
      </div>
      {recent.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-muted">
          No model activity yet.
        </p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {recent.map((row, index) => (
            <li
              key={`${modelLabel(row)}:${rowTimestamp(row) ?? index}`}
              className="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="min-w-0">
                <div
                  className="truncate text-sm font-medium text-ink"
                  title={modelLabel(row)}
                >
                  {modelLabel(row)}
                </div>
                <div className="mt-1 text-xs text-ink-muted">
                  {formatOptionalNumber(
                    readNumber(row, ["requests", "totalRequests"]),
                  )}{" "}
                  req
                  {rowTimestamp(row)
                    ? ` · ${formatRelativeTime(rowTimestamp(row) ?? 0)}`
                    : ""}
                </div>
              </div>
              <div className="text-xs tabular-nums text-ink-muted">
                TTFT {formatMillis(readNumber(row, ["avgTtft"]))} ·{" "}
                {formatOptionalNumber(readNumber(row, ["avgTokensPerSecond"]))}{" "}
                tok/s
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
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
  const [range, setRange] = useState<StatsRange>("24h");
  const timeSeries = filterRowsByRange(stats?.timeSeries, range);
  const costSeries = filterRowsByRange(stats?.costSeries, range);
  const modelPerformanceSeries = filterRowsByRange(
    stats?.modelPerformanceSeries ?? stats?.modelSeries,
    range,
  );
  const overall = rollupSeries(timeSeries, stats?.overall);
  const requests = readNumber(overall, ["totalRequests", "requests"]);
  const failed = readNumber(overall, ["failedRequests", "failures"]);
  const cost = readNumber(overall, ["totalCost", "cost"]);
  const avgTtft = readNumber(stats?.overall, ["avgTtft", "ttft"]);
  const avgDuration = readNumber(stats?.overall, ["avgDuration", "duration"]);
  const throughput = readNumber(stats?.overall, [
    "avgTokensPerSecond",
    "tokensPerSecond",
  ]);
  const inputTokens = readNumber(stats?.overall, ["totalInputTokens"]);
  const outputTokens = readNumber(stats?.overall, ["totalOutputTokens"]);
  const premium = readNumber(stats?.overall, ["totalPremiumRequests"]);
  const last = readNumber(stats?.overall, ["lastTimestamp"]);

  return (
    <Panel
      title="Overview"
      bodyClassName="bg-bg/40"
      actions={
        <Button
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          className="border-fuchsia-500 bg-fuchsia-500 text-white hover:bg-fuchsia-600"
        >
          {loading ? "Refreshing…" : "Refresh stats"}
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-ink-muted">
          {last !== undefined
            ? `Updated ${formatRelativeTime(last)} · auto-refreshes every 30s`
            : "Local OMP usage statistics"}
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-border-subtle bg-bg-soft text-xs text-ink-muted">
          {STATS_RANGES.map(({ label }) => (
            <button
              key={label}
              type="button"
              onClick={() => setRange(label)}
              className={`px-3 py-1.5 transition-colors hover:bg-bg-hover hover:text-ink ${
                label === range ? "bg-bg-raised text-ink shadow-sm" : ""
              }`}
              aria-pressed={label === range}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
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
          <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <NativeMetricCard
              label="Total cost"
              value={formatCost(cost)}
              primary
            />
            <NativeMetricCard
              label="Requests"
              value={formatOptionalNumber(requests)}
              primary
            />
            <NativeMetricCard
              label="Cache rate"
              value={formatPercent(readNumber(stats?.overall, ["cacheRate"]))}
              primary
            />
            <NativeMetricCard
              label="Error rate"
              value={formatPercent(readNumber(overall, ["errorRate"]))}
              primary
            />
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <NativeMetricCard
              label="Input tokens"
              value={formatCompactNumber(inputTokens)}
            />
            <NativeMetricCard
              label="Output tokens"
              value={formatCompactNumber(outputTokens)}
            />
            <NativeMetricCard
              label="Premium requests"
              value={formatOptionalNumber(premium)}
            />
            <NativeMetricCard
              label="Tokens/s"
              value={throughput === undefined ? "—" : throughput.toFixed(1)}
            />
            <NativeMetricCard
              label="Avg latency"
              value={formatMillis(avgDuration)}
            />
            <NativeMetricCard label="Avg TTFT" value={formatMillis(avgTtft)} />
          </section>

          <AgentUsagePanel rows={stats.byAgentType} />
          <ThroughputChart rows={timeSeries} />
          <RecentModelActivity rows={modelPerformanceSeries} />

          <div className="grid gap-3 xl:grid-cols-[repeat(3,minmax(0,1fr))]">
            <NativeBreakdownList
              title="Top models"
              rows={stats.byModel}
              label={modelLabel}
            />
            <NativeBreakdownList
              title="Top folders"
              rows={stats.byFolder}
              label={(row) => folderLabel(row, projects)}
            />
            <NativeBreakdownList
              title="Cost by model"
              rows={aggregateModels(costSeries)}
              label={modelLabel}
            />
          </div>

          <div className="rounded-2xl border border-border-subtle bg-bg-raised px-4 py-3 text-xs text-ink-muted">
            Showing {range} request/cost data · {formatOptionalNumber(failed)}{" "}
            failed requests · {formatCompactNumber(metricTokens(stats.overall))}{" "}
            all-time tokens · {formatNumber(timeSeries.length)} trend points
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

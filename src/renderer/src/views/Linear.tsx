// Feature 2 — Linear browse surface. Read-only in v2: list teams' issues with
// team / scope / project filters and open any issue in Linear via the system
// browser (`openExternal`); the renderer never talks to api.linear.app directly
// (its CSP forbids it — all HTTP is in main). When no validated key is present
// (`status.status !== "authenticated"`) the whole view collapses to the
// connect card. State lives in `store/linear.ts`; this view only drives it.

import type { LinearIssue } from "@shared/domain";
import {
  Check,
  CircleDot,
  ListFilter,
  RefreshCw,
  SquareUser,
  TriangleAlert,
  Users,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { LinearConnectCard } from "@/components/linear/LinearConnectCard";
import {
  Badge,
  type BadgeVariant,
  Card,
  Combobox,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
  Spinner,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { useLinearStore } from "@/store/linear";

const ROW =
  "flex w-full flex-col gap-1 rounded-md border border-border bg-bg-raised px-3 py-2 text-left transition hover:bg-bg-hover";

/** Linear's numeric priority scale (0 = none … 1 = urgent). */
const PRIORITY: Record<number, { label: string; variant: BadgeVariant }> = {
  1: { label: "Urgent", variant: "danger" },
  2: { label: "High", variant: "warn" },
  3: { label: "Medium", variant: "default" },
  4: { label: "Low", variant: "muted" },
};

/** Map a workflow-state *type* (stable across renamed states) to a badge tone. */
const STATE_VARIANT: Record<string, BadgeVariant> = {
  completed: "success",
  started: "accent",
  canceled: "muted",
  unstarted: "default",
  backlog: "muted",
  triage: "warn",
};

type LinearStateTone = "running" | "todo" | "done";

const STATE_TONE: Record<string, LinearStateTone> = {
  started: "running",
  completed: "done",
  unstarted: "todo",
  backlog: "todo",
  triage: "todo",
  canceled: "todo",
};

interface IssueStateGroup {
  key: string;
  name: string;
  type: string;
  issues: LinearIssue[];
}

function groupIssuesByState(issues: LinearIssue[]): IssueStateGroup[] {
  const groups = new Map<string, IssueStateGroup>();
  for (const issue of issues) {
    const key = `${issue.state.type}:${issue.state.name}`;
    const group = groups.get(key);
    if (group) {
      group.issues.push(issue);
    } else {
      groups.set(key, {
        key,
        name: issue.state.name,
        type: issue.state.type,
        issues: [issue],
      });
    }
  }
  return [...groups.values()];
}

function StateDot({ type }: { type: string }) {
  const tone = STATE_TONE[type] ?? "todo";

  if (tone === "running") {
    return (
      <span
        aria-hidden
        data-state-dot={tone}
        className="h-2.5 w-2.5 shrink-0 animate-omp-pulse rounded-full"
        style={
          {
            backgroundColor: "#f2c94c",
            "--omp-glow": "rgba(242, 201, 76, 0.55)",
          } as CSSProperties
        }
      />
    );
  }

  if (tone === "done") {
    return (
      <span
        aria-hidden
        data-state-dot={tone}
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: "#5e6ad2" }}
      >
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      data-state-dot={tone}
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ boxShadow: "inset 0 0 0 1.5px #6c6c78" }}
    />
  );
}

export default function Linear() {
  const status = useLinearStore((s) => s.status);
  const statusLoading = useLinearStore((s) => s.statusLoading);
  const teams = useLinearStore((s) => s.teams);
  const projects = useLinearStore((s) => s.projects);
  const issues = useLinearStore((s) => s.issues);
  const loading = useLinearStore((s) => s.loading);
  const error = useLinearStore((s) => s.error);
  const loadStatus = useLinearStore((s) => s.loadStatus);
  const loadTeams = useLinearStore((s) => s.loadTeams);
  const loadProjects = useLinearStore((s) => s.loadProjects);
  const loadIssues = useLinearStore((s) => s.loadIssues);

  const [teamId, setTeamId] = useState("");
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [projectName, setProjectName] = useState("");

  const authed = status?.status === "authenticated";

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Team + project options only matter once a key is validated; project list is
  // re-scoped whenever the team filter changes.
  useEffect(() => {
    if (!authed) return;
    void loadTeams();
  }, [authed, loadTeams]);
  useEffect(() => {
    if (!authed) return;
    void loadProjects(teamId || undefined);
  }, [authed, teamId, loadProjects]);

  // Backend-scoped issue query: re-runs on team / scope change.
  useEffect(() => {
    if (!authed) return;
    void loadIssues({ teamId: teamId || undefined, assignedToMe });
  }, [authed, teamId, assignedToMe, loadIssues]);

  const visible = useMemo(
    () =>
      projectName
        ? issues.filter((i) => i.project?.name === projectName)
        : issues,
    [issues, projectName],
  );
  const visibleGroups = useMemo(() => groupIssuesByState(visible), [visible]);

  const teamOptions = [
    { value: "", label: "All teams" },
    ...teams.map((t) => ({ value: t.id, label: `${t.key} · ${t.name}` })),
  ];
  const projectOptions = [
    { value: "", label: "All projects" },
    ...projects.map((p) => ({ value: p.name, label: p.name })),
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Linear</h1>
          <p className="text-sm text-ink-muted">
            {authed && status?.viewer
              ? `Connected as ${status.viewer.name}`
              : "Browse issues, projects, and teams"}
          </p>
        </div>
        <IconButton
          label="Reload"
          onClick={() => {
            void loadStatus();
            if (authed) {
              void loadTeams();
              void loadProjects(teamId || undefined);
              void loadIssues({ teamId: teamId || undefined, assignedToMe });
            }
          }}
        >
          <RefreshCw
            className={cn(
              "h-4 w-4",
              (statusLoading || loading) && "animate-spin",
            )}
          />
        </IconButton>
      </div>

      {statusLoading && !status ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner size={24} />
        </div>
      ) : !authed ? (
        <div className="scrollbar min-h-0 flex-1 overflow-auto p-6">
          <Card className="mx-auto max-w-md p-5">
            <h2 className="text-sm font-semibold text-ink">Connect Linear</h2>
            <p className="mt-1 mb-4 text-xs text-ink-muted">
              Paste a personal API key to browse your issues, projects, and
              teams here.
            </p>
            <LinearConnectCard />
          </Card>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-6 py-3">
            <Menu
              aria-label="Issue scope"
              trigger={({ open, toggle, triggerRef }) => (
                <button
                  ref={triggerRef}
                  type="button"
                  onClick={toggle}
                  aria-expanded={open}
                  aria-haspopup="menu"
                  className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-raised px-3 py-2 text-sm text-ink transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  {assignedToMe ? (
                    <SquareUser className="h-4 w-4 text-ink-faint" />
                  ) : (
                    <Users className="h-4 w-4 text-ink-faint" />
                  )}
                  {assignedToMe ? "Assigned to me" : "All issues"}
                </button>
              )}
            >
              <MenuItem
                icon={<Users className="h-4 w-4" />}
                onClick={() => setAssignedToMe(false)}
              >
                All issues
              </MenuItem>
              <MenuItem
                icon={<SquareUser className="h-4 w-4" />}
                onClick={() => setAssignedToMe(true)}
              >
                Assigned to me
              </MenuItem>
            </Menu>

            <Combobox
              aria-label="Team filter"
              className="w-56"
              options={teamOptions}
              value={teamId}
              onChange={(v) => {
                setTeamId(v);
                setProjectName("");
              }}
              placeholder="All teams"
              searchPlaceholder="Filter teams…"
            />

            <Combobox
              aria-label="Project filter"
              className="w-56"
              options={projectOptions}
              value={projectName}
              onChange={setProjectName}
              placeholder="All projects"
              searchPlaceholder="Filter projects…"
            />

            <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-faint">
              <ListFilter className="h-3.5 w-3.5" />
              {visible.length} {visible.length === 1 ? "issue" : "issues"}
            </span>
          </div>

          <div className="scrollbar min-h-0 flex-1 overflow-auto px-6 py-4">
            {loading && issues.length === 0 ? (
              <div className="flex justify-center p-8">
                <Spinner />
              </div>
            ) : error ? (
              <EmptyState
                icon={<TriangleAlert className="h-6 w-6" />}
                title="Failed to load issues"
                hint={error}
              />
            ) : visible.length === 0 ? (
              <EmptyState
                icon={<CircleDot className="h-6 w-6" />}
                title="No issues"
                hint="Nothing matches the current filters."
              />
            ) : (
              <div className="space-y-5">
                {visibleGroups.map((group, index) => {
                  const headingId = `linear-state-${index}`;
                  return (
                    <section key={group.key} aria-labelledby={headingId}>
                      <div className="mb-2 flex items-center gap-2">
                        <StateDot type={group.type} />
                        <h2
                          id={headingId}
                          className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
                        >
                          {group.name}
                        </h2>
                        <span className="text-xs text-ink-faint">
                          {group.issues.length}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {group.issues.map((issue) => {
                          const priority =
                            issue.priority != null
                              ? PRIORITY[issue.priority]
                              : undefined;
                          return (
                            <button
                              key={issue.id}
                              type="button"
                              onClick={() => window.omp.openExternal(issue.url)}
                              className={ROW}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <StateDot type={issue.state.type} />
                                <span className="shrink-0 font-mono text-xs text-ink-faint">
                                  {issue.identifier}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                                  {issue.title}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 pl-4 text-xs text-ink-faint">
                                {priority && (
                                  <Badge
                                    variant={priority.variant}
                                    className="shrink-0"
                                  >
                                    {priority.label}
                                  </Badge>
                                )}
                                <Badge
                                  variant={
                                    STATE_VARIANT[issue.state.type] ?? "muted"
                                  }
                                  className="shrink-0"
                                >
                                  {issue.state.name}
                                </Badge>
                                {issue.team?.key && (
                                  <Badge variant="muted">
                                    {issue.team.key}
                                  </Badge>
                                )}
                                {issue.project?.name && (
                                  <span>{issue.project.name}</span>
                                )}
                                {issue.assignee?.name && (
                                  <span>{issue.assignee.name}</span>
                                )}
                                <span>·</span>
                                <span>
                                  {formatRelativeTime(issue.updatedAt)}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

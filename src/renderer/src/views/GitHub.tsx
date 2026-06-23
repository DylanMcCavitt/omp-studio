import {
  CircleDot,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Inbox,
  RefreshCw,
  Star,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Spinner,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatNumber, formatRelativeTime } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { useAppStore } from "@/store/app";

const TABS = [
  { id: "repos", label: "Repos", Icon: GitBranch },
  { id: "issues", label: "Issues", Icon: CircleDot },
  { id: "prs", label: "PRs", Icon: GitPullRequest },
] as const;

type TabId = (typeof TABS)[number]["id"];

const ROW =
  "flex w-full flex-col gap-1 rounded-md border border-border bg-bg-raised px-3 py-2 text-left transition hover:bg-bg-hover";

function ReposTab() {
  const { data, loading, error } = useAsync(() =>
    window.omp.github.listRepos(),
  );
  if (loading) return <Centered />;
  if (error) return <Failed hint={error} />;
  const repos = data ?? [];
  if (repos.length === 0) {
    return (
      <EmptyState
        icon={<GitBranch className="h-6 w-6" />}
        title="No repositories"
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {repos.map((repo) => (
        <button
          key={repo.nameWithOwner}
          onClick={() => window.omp.openExternal(repo.url)}
          className="flex flex-col gap-1.5 rounded-lg border border-border bg-bg-raised p-4 text-left transition hover:bg-bg-hover"
        >
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 shrink-0 text-ink-muted" />
            <span className="truncate font-mono text-sm text-ink">
              {repo.nameWithOwner}
            </span>
            <Badge
              variant={repo.isPrivate ? "warn" : "success"}
              className="ml-auto"
            >
              {repo.isPrivate ? "private" : "public"}
            </Badge>
          </div>
          {repo.description && (
            <p className="line-clamp-2 text-xs text-ink-muted">
              {repo.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
            {repo.primaryLanguage && <span>{repo.primaryLanguage}</span>}
            {typeof repo.stargazerCount === "number" && (
              <span className="flex items-center gap-1">
                <Star className="h-3 w-3" />
                {formatNumber(repo.stargazerCount)}
              </span>
            )}
            {repo.updatedAt && (
              <span>{formatRelativeTime(repo.updatedAt)}</span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

function IssuesTab() {
  const selectedProject = useAppStore((s) => s.selectedProject);
  const { data, loading, error } = useAsync(
    () =>
      selectedProject
        ? window.omp.github.listIssues(undefined, selectedProject)
        : Promise.resolve([]),
    [selectedProject],
  );
  if (!selectedProject) return <NeedsProject kind="issues" />;
  if (loading) return <Centered />;
  if (error) return <Failed hint={error} />;
  const issues = data ?? [];
  if (issues.length === 0) {
    return (
      <EmptyState icon={<Inbox className="h-6 w-6" />} title="No issues" />
    );
  }
  return (
    <div className="space-y-2">
      {issues.map((issue) => (
        <button
          key={issue.number}
          onClick={() => window.omp.openExternal(issue.url)}
          className={ROW}
        >
          <div className="flex items-center gap-2">
            <CircleDot className="h-3.5 w-3.5 shrink-0 text-success" />
            <span className="font-mono text-xs text-ink-faint">
              #{issue.number}
            </span>
            <span className="flex-1 truncate text-sm text-ink">
              {issue.title}
            </span>
            <Badge
              variant={
                issue.state.toLowerCase() === "open" ? "success" : "muted"
              }
            >
              {issue.state.toLowerCase()}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-6 text-xs text-ink-faint">
            <span>{issue.author}</span>
            <span>·</span>
            <span>{formatRelativeTime(issue.updatedAt)}</span>
            {issue.labels.slice(0, 4).map((label) => (
              <Badge key={label} variant="muted">
                {label}
              </Badge>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}

function PrsTab() {
  const selectedProject = useAppStore((s) => s.selectedProject);
  const { data, loading, error } = useAsync(
    () =>
      selectedProject
        ? window.omp.github.listPullRequests(undefined, selectedProject)
        : Promise.resolve([]),
    [selectedProject],
  );
  if (!selectedProject) return <NeedsProject kind="pull requests" />;
  if (loading) return <Centered />;
  if (error) return <Failed hint={error} />;
  const prs = data ?? [];
  if (prs.length === 0) {
    return (
      <EmptyState
        icon={<GitPullRequest className="h-6 w-6" />}
        title="No pull requests"
      />
    );
  }
  return (
    <div className="space-y-2">
      {prs.map((pr) => {
        const state = pr.state.toLowerCase();
        return (
          <button
            key={pr.number}
            onClick={() => window.omp.openExternal(pr.url)}
            className={ROW}
          >
            <div className="flex items-center gap-2">
              <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="font-mono text-xs text-ink-faint">
                #{pr.number}
              </span>
              <span className="flex-1 truncate text-sm text-ink">
                {pr.title}
              </span>
              <Badge
                variant={
                  pr.isDraft
                    ? "muted"
                    : state === "open"
                      ? "success"
                      : state === "merged"
                        ? "accent"
                        : "muted"
                }
              >
                {pr.isDraft ? "draft" : state}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-6 text-xs text-ink-faint">
              {pr.headRefName && pr.baseRefName && (
                <span className="font-mono">
                  {pr.headRefName} → {pr.baseRefName}
                </span>
              )}
              <span>{pr.author}</span>
              <span>·</span>
              <span>{formatRelativeTime(pr.updatedAt)}</span>
              {pr.labels.slice(0, 4).map((label) => (
                <Badge key={label} variant="muted">
                  {label}
                </Badge>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Centered() {
  return (
    <div className="flex justify-center p-8">
      <Spinner />
    </div>
  );
}

function Failed({ hint }: { hint: string }) {
  return (
    <EmptyState
      icon={<TriangleAlert className="h-6 w-6" />}
      title="Failed to load"
      hint={hint}
    />
  );
}

function NeedsProject({ kind }: { kind: "issues" | "pull requests" }) {
  const setSelectedProject = useAppStore((s) => s.setSelectedProject);
  return (
    <EmptyState
      icon={<FolderOpen className="h-6 w-6" />}
      title="No project selected"
      hint={`Choose a project directory to see its ${kind}.`}
      action={
        <Button
          variant="subtle"
          size="sm"
          onClick={() => {
            void window.omp.pickDirectory().then((dir) => {
              if (dir) setSelectedProject(dir);
            });
          }}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Choose project
        </Button>
      }
    />
  );
}

export default function GitHub() {
  const [tab, setTab] = useState<TabId>("repos");
  const [nonce, setNonce] = useState(0);
  const selectedProject = useAppStore((s) => s.selectedProject);
  const { data: repo, loading: repoLoading } = useAsync(
    () => window.omp.github.currentRepo(selectedProject ?? undefined),
    [nonce, selectedProject],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          {repoLoading ? (
            <Spinner size={18} />
          ) : repo ? (
            <>
              <button
                onClick={() => window.omp.openExternal(repo.url)}
                className="flex items-center gap-2 text-left"
              >
                <GitBranch className="h-4 w-4 shrink-0 text-ink-muted" />
                <span className="truncate text-lg font-semibold text-ink hover:text-accent">
                  {repo.nameWithOwner}
                </span>
                <Badge variant={repo.isPrivate ? "warn" : "success"}>
                  {repo.isPrivate ? "private" : "public"}
                </Badge>
              </button>
              {repo.description && (
                <p className="mt-1 truncate text-sm text-ink-muted">
                  {repo.description}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink-faint">
                {repo.primaryLanguage && <span>{repo.primaryLanguage}</span>}
                {typeof repo.stargazerCount === "number" && (
                  <span className="flex items-center gap-1">
                    <Star className="h-3 w-3" />
                    {formatNumber(repo.stargazerCount)}
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-ink">GitHub</h1>
              <p className="truncate text-sm text-ink-muted">
                No repository detected in this directory
              </p>
            </>
          )}
        </div>
        <IconButton label="Reload" onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw className={cn("h-4 w-4", repoLoading && "animate-spin")} />
        </IconButton>
      </div>

      <div className="flex shrink-0 gap-1 border-b border-border px-6">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition",
              tab === id
                ? "border-accent text-ink"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="scrollbar min-h-0 flex-1 overflow-auto px-6 py-4">
        {tab === "repos" ? (
          <ReposTab key={`repos-${nonce}`} />
        ) : tab === "issues" ? (
          <IssuesTab key={`issues-${nonce}`} />
        ) : (
          <PrsTab key={`prs-${nonce}`} />
        )}
      </div>
    </div>
  );
}

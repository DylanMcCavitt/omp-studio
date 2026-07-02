// Feature 9 — Changes view. A read-only, workspace-scoped surface for local
// uncommitted changes (working tree vs HEAD; staged + unstaged combined). It
// lists changed files with a status badge and drills into each file's unified
// diff hunks (additions/removals distinguished by the success/danger tokens).
// All git access happens in the main process via `window.omp.changes`, scoped
// to the active workspace (`app.selectedProject`); this view never shells out.

import type {
  ChangedFile,
  ChangesStatus,
  DiffHunk,
  FileDiff,
} from "@shared/domain";
import {
  ArrowLeft,
  FileDiff as FileDiffIcon,
  FolderOpen,
  GitBranch,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import {
  Badge,
  type BadgeVariant,
  Button,
  EmptyState,
  IconButton,
  Spinner,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAsync } from "@/lib/useAsync";
import { useAppStore } from "@/store/app";

const STATUS_LABEL: Record<ChangedFile["status"], string> = {
  modified: "modified",
  added: "added",
  deleted: "deleted",
  renamed: "renamed",
  untracked: "untracked",
};

const STATUS_VARIANT: Record<ChangedFile["status"], BadgeVariant> = {
  modified: "warn",
  added: "success",
  deleted: "danger",
  renamed: "accent",
  untracked: "muted",
};

export default function Changes() {
  const selectedProject = useAppStore((s) => s.selectedProject);
  const { data, loading, error, reload } = useAsync<ChangesStatus>(
    () =>
      selectedProject
        ? window.omp.changes.status(selectedProject)
        : Promise.resolve({ repo: false, files: [] }),
    [selectedProject],
  );
  const [selected, setSelected] = useState<string | null>(null);

  if (selected) {
    return (
      <FileDiffView
        relPath={selected}
        workspaceRoot={selectedProject}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Changes</h1>
          <p className="text-sm text-ink-muted">
            Uncommitted changes in this workspace
          </p>
        </div>
        <IconButton label="Reload changes" onClick={reload}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </IconButton>
      </div>

      <div className="scrollbar min-h-0 flex-1 overflow-auto px-6 py-4">
        {!selectedProject ? (
          <NeedsWorkspace />
        ) : loading ? (
          <div className="flex justify-center py-12">
            <Spinner size={18} />
          </div>
        ) : error ? (
          <EmptyState
            icon={<TriangleAlert className="h-6 w-6" />}
            title="Couldn’t read changes"
            hint={error}
          />
        ) : !data?.repo ? (
          <EmptyState
            icon={<GitBranch className="h-6 w-6" />}
            title="Not a Git workspace"
            hint="This workspace isn’t a Git repository, so there are no local changes to show."
          />
        ) : data.files.length === 0 ? (
          <EmptyState
            icon={<GitBranch className="h-6 w-6" />}
            title="No uncommitted changes"
            hint="The working tree matches the last commit."
          />
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {data.files.map((file) => (
              <li key={file.relPath}>
                <button
                  type="button"
                  onClick={() => setSelected(file.relPath)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-bg-hover"
                >
                  <FileDiffIcon className="h-4 w-4 shrink-0 text-ink-muted" />
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-sm text-ink"
                    title={file.relPath}
                  >
                    {file.relPath}
                  </span>
                  <Badge variant={STATUS_VARIANT[file.status]}>
                    {STATUS_LABEL[file.status]}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NeedsWorkspace() {
  const setSelectedProject = useAppStore((s) => s.setSelectedProject);
  return (
    <EmptyState
      icon={<FolderOpen className="h-6 w-6" />}
      title="No workspace selected"
      hint="Choose a project directory to see its local changes."
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

function FileDiffView({
  relPath,
  workspaceRoot,
  onBack,
}: {
  relPath: string;
  workspaceRoot: string | null;
  onBack: () => void;
}) {
  const { data, loading } = useAsync<FileDiff | null>(
    () => window.omp.changes.diff(relPath, workspaceRoot),
    [relPath, workspaceRoot],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <IconButton label="All changes" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <span
          className="min-w-0 flex-1 truncate font-mono text-sm text-ink"
          title={relPath}
        >
          {relPath}
        </span>
      </div>

      <div className="scrollbar min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size={18} />
          </div>
        ) : data?.binary ? (
          <div className="px-4 py-8 text-center text-sm text-ink-muted">
            Binary file — no text diff.
          </div>
        ) : !data || data.hunks.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-ink-muted">
            No text changes.
          </div>
        ) : (
          <div className="font-mono text-xs leading-relaxed">
            {data.hunks.map((hunk, hi) => (
              <HunkView key={hi} hunk={hunk} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HunkView({ hunk }: { hunk: DiffHunk }) {
  return (
    <div>
      <div className="sticky top-0 bg-bg-raised px-3 py-1 text-ink-faint">
        @@ -{hunk.oldStart} +{hunk.newStart} @@
      </div>
      <div>
        {hunk.lines.map((line, li) => {
          const prefix =
            line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
          return (
            <div
              key={li}
              className={cn(
                "whitespace-pre-wrap break-words px-3",
                line.type === "add" && "bg-success/10 text-success",
                line.type === "remove" && "bg-danger/10 text-danger",
                line.type === "context" && "text-ink-muted",
              )}
            >
              {`${prefix}${line.text}`}
            </div>
          );
        })}
      </div>
    </div>
  );
}

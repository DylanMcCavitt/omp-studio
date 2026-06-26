// Sidebar workspace switcher (feature 1): a Menu popover listing pinned
// workspaces, then recents, then "Add workspace…" / "Manage workspaces…".
// Selecting a workspace points new chats at its cwd (app.selectedProject) and
// bumps its recency — it never touches live sessions, and selecting or adding
// spawns nothing.

import type { GitWorkspaceInfo } from "@shared/domain";
import type { Workspace } from "@shared/ipc";
import {
  Check,
  ChevronsUpDown,
  FolderOpen,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui";
import { AddWorkspaceDialog } from "@/components/workspace/AddWorkspaceDialog";
import { WorkspaceColorDot } from "@/components/workspace/WorkspaceColor";
import { cn } from "@/lib/cn";
import {
  projectLabel,
  sortWorkspaces,
  WORKSPACE_RECENTS_LIMIT,
} from "@/lib/workspaces";
import { useAppStore } from "@/store/app";
import { useSettingsStore } from "@/store/settings";
import { useShellStore } from "@/store/shell";

export function WorkspaceSwitcher() {
  const selectedProject = useAppStore((s) => s.selectedProject);
  const setSelectedProject = useAppStore((s) => s.setSelectedProject);
  const setOpenPanel = useShellStore((s) => s.setOpenPanel);
  const workspaces = useSettingsStore((s) => s.settings?.workspaces);
  const recordWorkspace = useSettingsStore((s) => s.recordWorkspace);
  const [adding, setAdding] = useState(false);

  const sorted = sortWorkspaces(workspaces ?? []);
  const pinned = sorted.filter((w) => w.pinned);
  const recents = sorted
    .filter((w) => !w.pinned)
    .slice(0, WORKSPACE_RECENTS_LIMIT);

  const current = sorted.find((w) => w.cwd === selectedProject);
  const currentLabel = current
    ? current.label
    : selectedProject
      ? projectLabel(selectedProject)
      : "Select workspace";
  const [gitInfo, setGitInfo] = useState<GitWorkspaceInfo>({
    repo: false,
    branch: null,
    worktreePath: null,
  });
  const gitMeta = gitInfo.repo
    ? [gitInfo.branch, gitInfo.worktreePath].filter(Boolean).join(" · ")
    : "";

  useEffect(() => {
    let alive = true;
    const empty: GitWorkspaceInfo = {
      repo: false,
      branch: null,
      worktreePath: null,
    };
    const load = () => {
      if (!selectedProject || !window.omp.changes?.workspaceInfo) {
        setGitInfo(empty);
        return;
      }
      window.omp.changes.workspaceInfo(selectedProject).then(
        (info) => {
          if (alive) setGitInfo(info);
        },
        () => {
          if (alive) setGitInfo(empty);
        },
      );
    };

    load();
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
    };
  }, [selectedProject]);

  const select = (workspace: Workspace) => {
    setSelectedProject(workspace.cwd);
    void recordWorkspace(workspace.cwd);
  };

  const renderItem = (workspace: Workspace) => (
    <MenuItem
      key={workspace.id}
      icon={
        workspace.cwd === selectedProject ? (
          <Check className="h-4 w-4 text-accent" />
        ) : (
          <FolderOpen className="h-4 w-4" />
        )
      }
      onClick={() => select(workspace)}
    >
      <span className="flex min-w-0 items-center gap-2">
        {workspace.color && <WorkspaceColorDot color={workspace.color} />}
        <span className="truncate">{workspace.label}</span>
      </span>
    </MenuItem>
  );

  return (
    // The Popover wrapper Menu renders is `inline-flex`; stretch it so the
    // trigger fills the sidebar column rather than shrinking to its label.
    <div className="[&>div]:w-full">
      <Menu
        align="start"
        aria-label="Workspaces"
        trigger={({ open, toggle, triggerRef }) => (
          <button
            ref={triggerRef}
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-haspopup="menu"
            className={cn(
              "flex w-full items-center gap-2 rounded-lg border border-border-subtle bg-bg-raised px-2.5 py-1.5 text-left text-sm",
              "transition-colors hover:border-border-strong",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
            )}
            title={gitMeta || currentLabel}
          >
            {current?.color ? (
              <WorkspaceColorDot color={current.color} className="h-3 w-3" />
            ) : (
              <FolderOpen className="h-4 w-4 shrink-0 text-ink-muted" />
            )}
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate",
                  current ? "text-ink" : "text-ink-faint",
                )}
              >
                {currentLabel}
              </span>
              {gitMeta && (
                <span className="block truncate font-mono text-[11px] leading-tight text-ink-faint">
                  {gitMeta}
                </span>
              )}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-ink-faint" />
          </button>
        )}
      >
        {pinned.length > 0 && (
          <>
            {pinned.map(renderItem)}
            <MenuSeparator />
          </>
        )}
        {recents.length > 0 && (
          <>
            {recents.map(renderItem)}
            <MenuSeparator />
          </>
        )}
        <MenuItem
          icon={<Plus className="h-4 w-4" />}
          onClick={() => setAdding(true)}
        >
          Add workspace…
        </MenuItem>
        <MenuItem
          icon={<SlidersHorizontal className="h-4 w-4" />}
          onClick={() => setOpenPanel("settings")}
        >
          Manage workspaces…
        </MenuItem>
      </Menu>
      {adding && <AddWorkspaceDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

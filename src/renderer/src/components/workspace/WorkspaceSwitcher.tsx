// Sidebar workspace switcher (feature 1): a Menu popover listing pinned
// workspaces, then recents, then "Add workspace…" / "Manage workspaces…".
// Selecting a workspace points new chats at its cwd (app.selectedProject) and
// bumps its recency — it never touches live sessions, and selecting or adding
// spawns nothing.

import type { Workspace } from "@shared/ipc";
import {
  Check,
  ChevronsUpDown,
  FolderOpen,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui";
import { AddWorkspaceDialog } from "@/components/workspace/AddWorkspaceDialog";
import { cn } from "@/lib/cn";
import {
  projectLabel,
  sortWorkspaces,
  WORKSPACE_RECENTS_LIMIT,
} from "@/lib/workspaces";
import { useAppStore } from "@/store/app";
import { useSettingsStore } from "@/store/settings";

export function WorkspaceSwitcher() {
  const selectedProject = useAppStore((s) => s.selectedProject);
  const setSelectedProject = useAppStore((s) => s.setSelectedProject);
  const setRoute = useAppStore((s) => s.setRoute);
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
      {workspace.label}
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
          >
            <FolderOpen className="h-4 w-4 shrink-0 text-ink-muted" />
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                current ? "text-ink" : "text-ink-faint",
              )}
            >
              {currentLabel}
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
          onClick={() => setRoute("settings")}
        >
          Manage workspaces…
        </MenuItem>
      </Menu>
      {adding && <AddWorkspaceDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

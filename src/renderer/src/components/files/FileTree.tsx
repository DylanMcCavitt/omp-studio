// The workspace file tree (AGE-634) — replaces the Sidebar's Files-mode
// placeholder. Lazily expands: the root is listed on mount, and each directory
// fetches its children the first time it is opened (cached in the Files store,
// so re-expanding is instant and expansion survives a Chats|Files toggle).
// Directories sort first and hidden entries are dimmed (both honoured by the FS
// service); node_modules/.git never appear because the service skips them. A
// file click opens it in a center tab; the refresh button refetches the tree.

import type { FileEntry } from "@shared/domain";
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { projectLabel } from "@/lib/workspaces";
import { useAppStore } from "@/store/app";
import { ROOT_DIR, useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

export function FileTree() {
  const selectedProject = useAppStore((s) => s.selectedProject);
  const workspaces = useSettingsStore((s) => s.settings?.workspaces);
  const rootEntries = useFilesStore((s) => s.children[ROOT_DIR]);
  const rootLoading = useFilesStore((s) => s.dirLoading[ROOT_DIR] === true);
  const refreshTree = useFilesStore((s) => s.refreshTree);

  // Fetch the tree for the active workspace on mount and whenever the workspace
  // selection changes (the FS service is scoped to the active workspace cwd).
  useEffect(() => {
    void useFilesStore.getState().refreshTree();
  }, [selectedProject]);

  const current = (workspaces ?? []).find((w) => w.cwd === selectedProject);
  const rootLabel =
    current?.label ??
    (selectedProject ? projectLabel(selectedProject) : "Workspace");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 px-3 pb-1">
        <FolderOpen size={14} className="shrink-0 text-ink-faint" />
        <span
          className="truncate text-xs font-semibold uppercase tracking-wide text-ink-muted"
          title={selectedProject ?? undefined}
        >
          {rootLabel}
        </span>
        <div className="flex-1" />
        <IconButton
          label="Refresh files"
          onClick={() => void refreshTree()}
          className="h-6 w-6"
        >
          <RefreshCw size={13} className={cn(rootLoading && "animate-spin")} />
        </IconButton>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2"
        role="tree"
        aria-label="Workspace files"
      >
        <RootList entries={rootEntries} loading={rootLoading} />
      </div>
    </div>
  );
}

function RootList({
  entries,
  loading,
}: {
  entries: FileEntry[] | undefined;
  loading: boolean;
}) {
  if (entries === undefined) {
    return loading ? <TreeHint indent={8}>Loading…</TreeHint> : null;
  }
  if (entries.length === 0) {
    return <TreeHint indent={8}>No files in this workspace.</TreeHint>;
  }
  return (
    <>
      {entries.map((entry) => (
        <TreeNode key={entry.path} entry={entry} depth={0} />
      ))}
    </>
  );
}

function TreeNode({ entry, depth }: { entry: FileEntry; depth: number }) {
  const isDir = entry.kind === "dir";
  const expanded = useFilesStore((s) => s.expanded[entry.path] === true);
  const active = useFilesStore((s) => !isDir && s.activeTab === entry.path);
  const toggleDir = useFilesStore((s) => s.toggleDir);
  const openFile = useFilesStore((s) => s.openFile);

  const indent = 8 + depth * 12;

  return (
    <>
      <button
        type="button"
        role="treeitem"
        aria-expanded={isDir ? expanded : undefined}
        aria-selected={active}
        title={entry.path}
        onClick={() => {
          if (isDir) toggleDir(entry.path);
          else void openFile(entry.path);
        }}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          active
            ? "bg-accent-soft text-ink"
            : "text-ink-muted hover:bg-bg-hover hover:text-ink",
          entry.isHidden && "opacity-60",
        )}
        style={{ paddingLeft: indent }}
      >
        {isDir ? (
          <ChevronRight
            size={14}
            className={cn(
              "shrink-0 text-ink-faint transition-transform",
              expanded && "rotate-90",
            )}
          />
        ) : (
          <span className="w-3.5 shrink-0" aria-hidden />
        )}
        <NodeIcon isDir={isDir} expanded={expanded} />
        <span className="truncate">{entry.name}</span>
      </button>
      {isDir && expanded && (
        <TreeChildren dir={entry.path} depth={depth} indent={indent} />
      )}
    </>
  );
}

function TreeChildren({
  dir,
  depth,
  indent,
}: {
  dir: string;
  depth: number;
  indent: number;
}) {
  const children = useFilesStore((s) => s.children[dir]);
  const loading = useFilesStore((s) => s.dirLoading[dir] === true);

  if (children === undefined) {
    return loading ? <TreeHint indent={indent + 20}>Loading…</TreeHint> : null;
  }
  if (children.length === 0) {
    return <TreeHint indent={indent + 20}>Empty</TreeHint>;
  }
  return (
    <>
      {children.map((child) => (
        <TreeNode key={child.path} entry={child} depth={depth + 1} />
      ))}
    </>
  );
}

function NodeIcon({ isDir, expanded }: { isDir: boolean; expanded: boolean }) {
  if (!isDir) return <FileText size={14} className="shrink-0 text-ink-faint" />;
  return expanded ? (
    <FolderOpen size={14} className="shrink-0 text-accent" />
  ) : (
    <Folder size={14} className="shrink-0 text-ink-faint" />
  );
}

function TreeHint({
  indent,
  children,
}: {
  indent: number;
  children: ReactNode;
}) {
  return (
    <p
      style={{ paddingLeft: indent }}
      className="py-0.5 pr-2 text-xs text-ink-faint"
    >
      {children}
    </p>
  );
}

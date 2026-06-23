// Renderer Files store (AGE-634). Owns the two cohesive pieces of the Files
// feature: the lazy file tree (a children cache + expansion set, populated on
// demand from `window.omp.files.readDir`) and the center editor tabs (one per
// open file, keyed by workspace-relative path, alongside the always-present
// "chat" tab). Every bridge call degrades — a failed read surfaces an error tab,
// a failed write a toast — so nothing throws into the render path.
//
// `dirty` tracks the live buffer against `savedText` (its load/save baseline),
// so editing a file back to its saved contents clears the indicator. Window
// dialogs stay OUT of the store: `closeFileWithConfirm` (the confirm-on-unsaved
// wrapper) lives beside it, mirroring `closeSessionWithConfirm`.

import type { FileContent, FileEntry } from "@shared/domain";
import { create } from "zustand";
import { toast } from "@/store/toast";

/** Reserved center-tab id for chat. NUL cannot appear in a filesystem path. */
export const CHAT_TAB = "\0chat";
/** A center tab is either the chat sentinel or an open file's relative path. */
export type CenterTab = typeof CHAT_TAB | string;
/** Cache key for the tree root listing (`readDir` with no relPath). */
export const ROOT_DIR = "";

export interface FileTab {
  /** Workspace-relative path; the tab key. */
  path: string;
  /** Workspace root that produced this tab; guards async races on workspace switch. */
  workspaceRoot: string | null;
  /** Workspace selection generation that produced this tab (guards ABA switches). */
  workspaceGeneration: number;
  /** Live editor buffer (diverges from `savedText` while dirty). */
  text: string;
  /** Last loaded/saved text — the dirty baseline. */
  savedText: string;
  /** Unsaved edits vs. `savedText`. */
  dirty: boolean;
  /** A `readFile` is in flight (initial open). */
  loading: boolean;
  /** Exceeded the read cap — read-only notice, no editor. */
  tooLarge: boolean;
  /** Looks binary — read-only notice, no editor. */
  binary: boolean;
  /** Only a prefix was read (informational). */
  truncated: boolean;
  /** `readFile` returned null — error notice. */
  error: boolean;
}

interface FilesState {
  // ---- file tree (lazy, fetched per directory) ----
  /** Main-validated workspace root selected in the shell; null falls back safely. */
  workspaceRoot: string | null;
  /** Monotonic token bumped on every workspace selection change. */
  workspaceGeneration: number;
  /** Change workspace root used by subsequent Files IPC calls. */
  setWorkspaceRoot(root: string | null): void;
  /** Children by directory relPath; root keyed by `ROOT_DIR`. Absent = unloaded. */
  children: Record<string, FileEntry[]>;
  /** Directories currently expanded in the tree. */
  expanded: Record<string, boolean>;
  /** Directories with a `readDir` in flight. */
  dirLoading: Record<string, boolean>;
  /** Fetch (or refetch) a directory's children into the cache. */
  loadDir(relPath: string): Promise<void>;
  /** Expand/collapse a directory; first expand triggers a lazy load. */
  toggleDir(relPath: string): void;
  /** Refetch the root and every expanded directory (the refresh button). */
  refreshTree(): Promise<void>;
  /** Clear all workspace-scoped tree/editor state before changing workspace. */
  resetWorkspaceState(): void;

  // ---- center editor tabs ----
  /** Open file tabs keyed by workspace-relative path. */
  tabs: Record<string, FileTab>;
  /** File-tab order, left → right (the chat tab is implicit and always first). */
  order: string[];
  /** The focused center tab: `CHAT_TAB` or an open file's relPath. */
  activeTab: CenterTab;
  /** Focus a center tab. */
  setActiveTab(tab: CenterTab): void;
  /** Open `relPath` in a tab (read on first open) and focus it. */
  openFile(relPath: string): Promise<void>;
  /** Drop a file tab and re-focus a neighbor (no dialog — see the wrapper). */
  closeFile(relPath: string): void;
  /** Update a tab's live buffer and recompute its dirty flag. */
  setDirtyText(relPath: string, text: string): void;
  /** Write a tab's buffer via the Files IPC; toast the result; clear dirty. */
  save(relPath: string): Promise<void>;
}

/** Workspace-relative basename (POSIX `/` paths from the Files service). */
export function fileBasename(relPath: string): string {
  const i = relPath.lastIndexOf("/");
  return i >= 0 ? relPath.slice(i + 1) : relPath;
}

export const useFilesStore = create<FilesState>((set, get) => ({
  workspaceRoot: null,
  workspaceGeneration: 0,

  setWorkspaceRoot(root) {
    set((s) => ({
      workspaceRoot: root,
      workspaceGeneration: s.workspaceGeneration + 1,
    }));
  },

  children: {},
  expanded: {},
  dirLoading: {},

  async loadDir(relPath) {
    if (get().dirLoading[relPath]) return;
    set((s) => ({ dirLoading: { ...s.dirLoading, [relPath]: true } }));
    const workspaceRoot = get().workspaceRoot;
    const workspaceGeneration = get().workspaceGeneration;
    let entries: FileEntry[] = [];
    try {
      // The service defaults to "." for the root; pass undefined for ROOT_DIR.
      entries = await window.omp.files.readDir(
        relPath || undefined,
        workspaceRoot,
      );
    } catch {
      entries = [];
    }
    if (get().workspaceGeneration !== workspaceGeneration) return;
    set((s) => ({
      children: { ...s.children, [relPath]: entries },
      dirLoading: { ...s.dirLoading, [relPath]: false },
    }));
  },

  toggleDir(relPath) {
    const open = get().expanded[relPath] === true;
    set((s) => ({ expanded: { ...s.expanded, [relPath]: !open } }));
    if (!open && get().children[relPath] === undefined) {
      void get().loadDir(relPath);
    }
  },

  async refreshTree() {
    const expandedDirs = Object.keys(get().expanded).filter(
      (d) => get().expanded[d] === true,
    );
    set({ children: {}, dirLoading: {} });
    await Promise.all([
      get().loadDir(ROOT_DIR),
      ...expandedDirs.map((d) => get().loadDir(d)),
    ]);
  },

  resetWorkspaceState() {
    set({
      children: {},
      expanded: {},
      dirLoading: {},
      tabs: {},
      order: [],
      activeTab: CHAT_TAB,
    });
  },

  tabs: {},
  order: [],
  activeTab: CHAT_TAB,

  setActiveTab(tab) {
    set({ activeTab: tab });
  },

  async openFile(relPath) {
    // Already open: just focus it, preserving its buffer + dirty state.
    if (get().tabs[relPath]) {
      set({ activeTab: relPath });
      return;
    }
    const workspaceRoot = get().workspaceRoot;
    const workspaceGeneration = get().workspaceGeneration;
    // Optimistically add a loading tab and focus it, then resolve the read.
    const pending: FileTab = {
      path: relPath,
      workspaceRoot,
      workspaceGeneration,
      text: "",
      savedText: "",
      dirty: false,
      loading: true,
      tooLarge: false,
      binary: false,
      truncated: false,
      error: false,
    };
    set((s) => ({
      tabs: { ...s.tabs, [relPath]: pending },
      order: [...s.order, relPath],
      activeTab: relPath,
    }));

    let content: FileContent | null = null;
    try {
      content = await window.omp.files.readFile(relPath, workspaceRoot);
    } catch {
      content = null;
    }
    // The tab may have been closed or replaced under another workspace while the
    // read was in flight.
    const current = get().tabs[relPath];
    if (
      !current ||
      current.workspaceRoot !== workspaceRoot ||
      current.workspaceGeneration !== workspaceGeneration ||
      get().workspaceGeneration !== workspaceGeneration
    ) {
      return;
    }

    const resolved: FileTab = content
      ? {
          path: relPath,
          workspaceRoot,
          workspaceGeneration,
          text: content.text,
          savedText: content.text,
          dirty: false,
          loading: false,
          tooLarge: content.tooLarge,
          binary: content.binary,
          truncated: content.truncated,
          error: false,
        }
      : { ...pending, loading: false, error: true };
    set((s) => ({ tabs: { ...s.tabs, [relPath]: resolved } }));
  },

  closeFile(relPath) {
    set((s) => {
      if (!s.tabs[relPath]) return s;
      const { [relPath]: _closed, ...tabs } = s.tabs;
      const idx = s.order.indexOf(relPath);
      const order = s.order.filter((p) => p !== relPath);
      let activeTab = s.activeTab;
      if (activeTab === relPath) {
        // Focus the neighbor that slides into this slot, else the previous one,
        // else fall back to the chat tab.
        activeTab = order[idx] ?? order[idx - 1] ?? CHAT_TAB;
      }
      return { tabs, order, activeTab };
    });
  },

  setDirtyText(relPath, text) {
    set((s) => {
      const tab = s.tabs[relPath];
      if (!tab) return s;
      return {
        tabs: {
          ...s.tabs,
          [relPath]: { ...tab, text, dirty: text !== tab.savedText },
        },
      };
    });
  },

  async save(relPath) {
    const tab = get().tabs[relPath];
    // Nothing to persist for a missing, still-loading, read-only, or clean tab.
    if (!tab || tab.loading || tab.tooLarge || tab.binary || tab.error) return;
    if (!tab.dirty) return;
    const text = tab.text;
    const workspaceRoot = tab.workspaceRoot;
    const workspaceGeneration = tab.workspaceGeneration;

    let result: { ok: boolean; error?: string };
    try {
      result = await window.omp.files.writeFile(relPath, text, workspaceRoot);
    } catch (err) {
      result = { ok: false, error: (err as Error).message };
    }
    if (!result.ok) {
      toast.error("Save failed", { detail: result.error });
      return;
    }
    set((s) => {
      const current = s.tabs[relPath];
      if (!current || current.workspaceGeneration !== workspaceGeneration)
        return s;
      // Clear dirty only if the buffer is unchanged since the write started.
      return {
        tabs: {
          ...s.tabs,
          [relPath]: {
            ...current,
            savedText: text,
            dirty: current.text !== text,
          },
        },
      };
    });
    toast.success(`Saved ${fileBasename(relPath)}`);
  },
}));

/**
 * Clear workspace-scoped Files state before switching workspaces.
 * Dirty editors require an explicit user confirmation so a workspace switch does
 * not either discard unsaved edits silently or save them into the next workspace.
 */
export function resetWorkspaceFilesWithConfirm(
  workspaceRoot: string | null,
): boolean {
  const hasDirtyFiles = Object.values(useFilesStore.getState().tabs).some(
    (tab) => tab.dirty,
  );
  if (
    hasDirtyFiles &&
    !window.confirm(
      "Switching workspaces will close unsaved file tabs. Continue?",
    )
  ) {
    return false;
  }
  const files = useFilesStore.getState();
  files.setWorkspaceRoot(workspaceRoot);
  files.resetWorkspaceState();
  return true;
}

/**
 * Confirm-then-close a file tab: prompts before discarding unsaved edits.
 * Lives here (not in the `closeFile` action) so the store stays free of window
 * dialogs, mirroring `closeSessionWithConfirm`. Used by the center tab strip.
 */
export function closeFileWithConfirm(relPath: string): void {
  const { tabs, closeFile } = useFilesStore.getState();
  const tab = tabs[relPath];
  if (!tab) return;
  if (
    tab.dirty &&
    !window.confirm(
      `“${fileBasename(relPath)}” has unsaved changes. Close it anyway?`,
    )
  ) {
    return;
  }
  closeFile(relPath);
}

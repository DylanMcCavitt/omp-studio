// Zustand store mirroring the main-owned settings store (`settings:get` /
// `settings:update`). Loaded once at app bootstrap; every `update` is
// pessimistic — it persists through the bridge and adopts the canonical
// settings the main process returns, so the UI never drifts from disk.

import type { StudioSettings, Workspace } from "@shared/ipc";
import { create } from "zustand";
import { pinWorkspace, upsertWorkspace } from "@/lib/workspaces";

interface SettingsState {
  settings: StudioSettings | null;
  loading: boolean;
  error: string | undefined;
  /** Fetch settings from the bridge. Safe to call repeatedly (idempotent). */
  load(): Promise<void>;
  /** Persist a patch and adopt the returned canonical settings. */
  update(patch: Partial<StudioSettings>): Promise<void>;
  /** Bump (or create) the workspace for `cwd` to "now" recency (best-effort). */
  recordWorkspace(cwd: string): Promise<void>;
  /** Add a workspace from a picked directory, with an optional label override. */
  addWorkspace(cwd: string, label?: string): Promise<void>;
  /** Remove the workspace `id`; clears defaultProject if it pointed at its cwd. */
  removeWorkspace(id: string): Promise<void>;
  /** Patch a workspace's mutable fields (label / cwd / pinned) by id. */
  updateWorkspace(
    id: string,
    patch: Partial<Pick<Workspace, "label" | "cwd" | "pinned">>,
  ): Promise<void>;
  /**
   * Toggle a command name in `settings.ui.pinnedCommands` (Commands favorites).
   * Adds it when absent, removes it when present; preserves the rest of `ui`
   * (e.g. `collapsed`). Funnels through the pessimistic `update`.
   */
  togglePinnedCommand(name: string): Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loading: true,
  error: undefined,

  async load() {
    set({ loading: true, error: undefined });
    try {
      const settings = await window.omp.settings.get();
      set({ settings, loading: false });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  async update(patch) {
    try {
      const settings = await window.omp.settings.update(patch);
      set({ settings, error: undefined });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  async recordWorkspace(cwd) {
    const current = get().settings;
    if (!current) return;
    await get().update({
      workspaces: upsertWorkspace(current.workspaces ?? [], cwd),
    });
  },

  async addWorkspace(cwd, label) {
    const current = get().settings;
    if (!current) return;
    await get().update({
      workspaces: upsertWorkspace(current.workspaces ?? [], cwd, { label }),
    });
  },

  async removeWorkspace(id) {
    const current = get().settings;
    if (!current) return;
    const workspaces = current.workspaces ?? [];
    const removed = workspaces.find((w) => w.id === id);
    const patch: Partial<StudioSettings> = {
      workspaces: workspaces.filter((w) => w.id !== id),
    };
    // A removed workspace can no longer be the default target for new chats.
    if (removed && current.defaultProject === removed.cwd) {
      patch.defaultProject = null;
    }
    await get().update(patch);
  },

  async updateWorkspace(id, patch) {
    const current = get().settings;
    if (!current) return;
    const base = current.workspaces ?? [];
    const target = base.find((w) => w.id === id);
    const { pinned, ...fields } = patch;
    let workspaces =
      pinned === undefined ? base : pinWorkspace(base, id, pinned);
    if (Object.keys(fields).length > 0) {
      workspaces = workspaces.map((w) =>
        w.id === id ? { ...w, ...fields } : w,
      );
    }
    const settingsPatch: Partial<StudioSettings> = { workspaces };
    // Re-pointing a workspace's cwd: keep cwd unique (drop any other entry that
    // now collides) and carry the default with it so its badge + new-chat seed
    // don't go stale against the old path.
    if (patch.cwd !== undefined && target) {
      settingsPatch.workspaces = workspaces.filter(
        (w) => w.id === id || w.cwd !== patch.cwd,
      );
      if (current.defaultProject === target.cwd) {
        settingsPatch.defaultProject = patch.cwd;
      }
    }
    await get().update(settingsPatch);
  },

  async togglePinnedCommand(name) {
    const current = get().settings;
    if (!current) return;
    const ui = current.ui ?? {};
    const pinned = ui.pinnedCommands ?? [];
    const next = pinned.includes(name)
      ? pinned.filter((n) => n !== name)
      : [...pinned, name];
    await get().update({ ui: { ...ui, pinnedCommands: next } });
  },
}));

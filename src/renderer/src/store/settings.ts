// Zustand store mirroring the main-owned settings store (`settings:get` /
// `settings:update`). Loaded once at app bootstrap; every `update` is
// pessimistic — it persists through the bridge and adopts the canonical
// settings the main process returns, so the UI never drifts from disk.

import type { StudioSettings } from "@shared/ipc";
import { create } from "zustand";
import { upsertRecentProject } from "@/lib/recent-projects";

interface SettingsState {
  settings: StudioSettings | null;
  loading: boolean;
  error: string | undefined;
  /** Fetch settings from the bridge. Safe to call repeatedly (idempotent). */
  load(): Promise<void>;
  /** Persist a patch and adopt the returned canonical settings. */
  update(patch: Partial<StudioSettings>): Promise<void>;
  /** Bump a project to the front of the recents list (best-effort). */
  recordProject(cwd: string): Promise<void>;
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

  async recordProject(cwd) {
    const current = get().settings;
    if (!current) return;
    await get().update({
      recentProjects: upsertRecentProject(current.recentProjects, cwd),
    });
  },
}));

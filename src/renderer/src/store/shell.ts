// Right icon-rail UI state (AGE-630). Which expandable destination panel is
// open on the far-right rail is a discrete piece of *shell* state — separate
// from `route` (the left/center primary surface) and from the per-session chat
// rail. Toggling a panel both flips this live state AND persists the choice
// through the settings store's debounced `setLayout`, so the last-open panel is
// restored on the next launch (hydrated once at boot by `Layout`).

import { create } from "zustand";
import type { Route } from "@/store/app";
import { useSettingsStore } from "@/store/settings";

interface ShellState {
  /** The open right-rail destination panel, or null when the rail is collapsed. */
  openPanelId: Route | null;
  /** Open `id` (or collapse when null); persists the choice via `setLayout`. */
  setOpenPanel: (id: Route | null) => void;
  /** Open `id`, or collapse if it is already the open panel; persists. */
  togglePanel: (id: Route) => void;
  /** Collapse the rail panel; persists the collapsed state. */
  closePanel: () => void;
  /**
   * Adopt a persisted open-panel id at boot WITHOUT re-persisting it (it already
   * came from settings). Called once by `Layout` after settings load.
   */
  hydrate: (id: Route | null) => void;
}

/** Persist the open-panel id through the settings store's debounced writer. */
function persist(id: Route | null): void {
  useSettingsStore.getState().setLayout({ rightPanelId: id });
}

export const useShellStore = create<ShellState>((set, get) => ({
  openPanelId: null,

  setOpenPanel(id) {
    set({ openPanelId: id });
    persist(id);
  },

  togglePanel(id) {
    const next = get().openPanelId === id ? null : id;
    set({ openPanelId: next });
    persist(next);
  },

  closePanel() {
    set({ openPanelId: null });
    persist(null);
  },

  hydrate(id) {
    set({ openPanelId: id });
  },
}));

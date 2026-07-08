// Right icon-rail UI state (AGE-630). Which expandable destination panel is
// open on the far-right rail is a discrete piece of *shell* state — separate
// from `route` (the left/center primary surface) and from the per-session chat
// rail. Toggling a panel both flips this live state AND persists the choice
// through the settings store's debounced `setLayout`, so the last-open panel is
// restored on the next launch (hydrated once at boot by `Layout`).
//
// OWNERSHIP (AGE-801, load-bearing for AGE-777 split panes): the right icon
// rail and its expandable panels are EXPLICITLY GLOBAL — exactly one
// `openPanelId` per window, regardless of how many center panes exist. Rail
// destinations (Dashboard, Skills, MCP, Agents, Terminal, Browser, Changes,
// GitHub, Linear, Settings) are app-level tools; several are backed by
// main-process singletons (one BrowserViewManager overlay, one terminal
// registry view), so per-pane rails would alias one backend across panes.
// Anything that must vary per pane lives INSIDE the pane subtree
// (store/panes.ts), never here.

import { create } from "zustand";
import type { Route } from "@/store/app";
import { useSettingsStore } from "@/store/settings";

/** Which primary surface the left sidebar shows: the chat list or the file tree. */
export type SidebarMode = "chats" | "files";
type SidebarToggleHandler = () => void;

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

  /** Whether the Settings surface is open as a floating modal. */
  settingsModalOpen: boolean;
  /** Open the Settings modal without changing the current center or rail panel. */
  openSettingsModal: () => void;
  /** Close the Settings modal. */
  closeSettingsModal: () => void;
  /** Toggle the Settings modal from the right rail button. */
  toggleSettingsModal: () => void;

  /** The left sidebar's active surface (Chats list vs. Files tree). */
  sidebarMode: SidebarMode;
  /** Switch the left sidebar between its Chats and Files surfaces. */
  setSidebarMode: (mode: SidebarMode) => void;

  /** Imperative bridge owned by Layout for collapsing/expanding the left sidebar. */
  sidebarToggleHandler: SidebarToggleHandler | null;
  /** Register the live sidebar toggle bridge while the shell split is mounted. */
  setSidebarToggleHandler: (handler: SidebarToggleHandler | null) => void;
  /** Toggle the left sidebar through the registered shell split bridge. */
  toggleSidebar: () => void;
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

  settingsModalOpen: false,

  openSettingsModal() {
    set({ settingsModalOpen: true });
  },

  closeSettingsModal() {
    set({ settingsModalOpen: false });
  },

  toggleSettingsModal() {
    set((state) => ({ settingsModalOpen: !state.settingsModalOpen }));
  },

  sidebarMode: "chats",

  setSidebarMode(mode) {
    set({ sidebarMode: mode });
  },

  sidebarToggleHandler: null,

  setSidebarToggleHandler(handler) {
    set({ sidebarToggleHandler: handler });
  },

  toggleSidebar() {
    get().sidebarToggleHandler?.();
  },
}));

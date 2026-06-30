// Feature 8 — renderer mirror of the main-owned embedded browser. The actual
// web content is a sandboxed `WebContentsView` created and positioned by main
// (see `src/main/browser/view-manager.ts`); the renderer NEVER loads remote
// content itself — its CSP stays `'self'`. This store holds only the nav state
// pushed back over `evt:browser-state` (url/title/loading/can-go-*) plus a small
// visited-URL history for the omnibox, and forwards control intents
// (create/navigate/back/forward/reload/destroy) to `window.omp.browser.*`.
//
// One global `onState` subscription mirrors the chat store's single-subscription
// pattern: `ensureSubscribed` registers it once (guarded by `_unsub`) and
// `teardown` releases it. Every bridge call degrades — it never throws into the
// render path.

import type { BrowserViewState } from "@shared/domain";
import { create } from "zustand";

/** Window-relative rect the main view is positioned over (DIP, == CSS px). */
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Cap on the remembered visited-URL list backing the omnibox history. */
const HISTORY_CAP = 50;

const HIDDEN_BOUNDS: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 };

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  loading: boolean;
}

interface BrowserStore {
  /** Id of the active main-owned tab/view, or null when none exists. */
  viewId: string | null;
  /** Latest nav state pushed for `viewId` (null until the first push/create). */
  state: BrowserViewState | null;
  /** Open browser tabs, in creation order. */
  tabs: BrowserTab[];
  /** Distinct visited URLs, most-recent first (omnibox history source). */
  history: string[];
  /** True while a `create` is in flight (prevents a duplicate concurrent view). */
  creating: boolean;
  error: string | undefined;
  /** Unsubscribe for the global `onState` listener; null when not subscribed. */
  _unsub: (() => void) | null;
  /** Last state per known tab id, used to restore active state when switching. */
  _states: Record<string, BrowserViewState>;
  /** Bumped whenever pending creates must no longer adopt returned views. */
  _createToken: number;

  /** Register the single global `onState` subscription (idempotent). */
  ensureSubscribed(): void;
  /** Release the global subscription. */
  teardown(): void;
  /** Create a new main-owned tab over `bounds` and load `url`. */
  create(opts: { url: string; bounds: BrowserBounds }): Promise<void>;
  /** Switch the active tab without destroying any view. */
  switchTo(id: string): void;
  /** Close one tab/view. */
  close(id: string): void;
  /** Destroy every known tab/view and clear local nav state. */
  destroyAll(): void;
  /** Clear local visited-URL history without touching live browser views. */
  clearHistory(): void;
  /** Navigate the live view to `url`. */
  navigate(url: string): void;
  back(): void;
  forward(): void;
  reload(): void;
  openDevTools(): void;
  openExternal(): void;
  /** Destroy the active view and clear/switch local nav state. */
  destroy(): void;
  /** Reduce an incoming state push for a known tab (ignores stale ids). */
  _applyState(incoming: BrowserViewState): void;
}

export const useBrowserStore = create<BrowserStore>((set, get) => ({
  viewId: null,
  state: null,
  tabs: [],
  history: [],
  creating: false,
  error: undefined,
  _unsub: null,
  _states: {},
  _createToken: 0,

  ensureSubscribed() {
    if (get()._unsub) return;
    const off = window.omp.browser.onState((s) => get()._applyState(s));
    set({ _unsub: off });
  },

  teardown() {
    get()._unsub?.();
    set((s) => ({
      _unsub: null,
      creating: false,
      _createToken: s._createToken + 1,
    }));
  },

  async create(opts) {
    if (get().creating) return;
    const createToken = get()._createToken;
    set({ creating: true, error: undefined });
    try {
      const state = await window.omp.browser.create(opts);
      const s = get();
      if (s._createToken !== createToken) {
        void window.omp.browser.destroy(state.id);
        return;
      }
      if (s.viewId) {
        void window.omp.browser.setBounds(s.viewId, HIDDEN_BOUNDS);
      }
      set((current) => ({
        creating: false,
        viewId: state.id,
        state,
        tabs: upsertTab(current.tabs, state),
        _states: { ...current._states, [state.id]: state },
      }));
      // Adopt the initial url/state synchronously; later transitions arrive via
      // the onState subscription registered in ensureSubscribed.
      get()._applyState(state);
    } catch (e) {
      if (get()._createToken !== createToken) return;
      set({
        creating: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  switchTo(id) {
    const s = get();
    if (!s.tabs.some((t) => t.id === id)) return;
    if (s.viewId && s.viewId !== id) {
      void window.omp.browser.setBounds(s.viewId, HIDDEN_BOUNDS);
    }
    set({ viewId: id, state: s._states[id] ?? null });
  },

  close(id) {
    const s = get();
    const index = s.tabs.findIndex((t) => t.id === id);
    if (index === -1) return;

    void window.omp.browser.destroy(id);

    const tabs = s.tabs.filter((t) => t.id !== id);
    const _states = { ...s._states };
    delete _states[id];
    let viewId = s.viewId;
    let state = s.state;
    if (s.viewId === id) {
      viewId = tabs[index]?.id ?? tabs[index - 1]?.id ?? null;
      state = viewId ? (_states[viewId] ?? null) : null;
    }
    set({ tabs, _states, viewId, state });
  },

  destroyAll() {
    for (const tab of get().tabs) {
      void window.omp.browser.destroy(tab.id);
    }
    set((s) => ({
      tabs: [],
      _states: {},
      viewId: null,
      state: null,
      creating: false,
      _createToken: s._createToken + 1,
    }));
  },

  navigate(url) {
    const id = get().viewId;
    if (!id) return;
    void window.omp.browser.navigate(id, url);
  },

  back() {
    const id = get().viewId;
    if (id) void window.omp.browser.goBack(id);
  },

  forward() {
    const id = get().viewId;
    if (id) void window.omp.browser.goForward(id);
  },

  clearHistory() {
    set({ history: [] });
  },

  reload() {
    const id = get().viewId;
    if (id) void window.omp.browser.reload(id);
  },

  openDevTools() {
    const id = get().viewId;
    if (id) void window.omp.browser.openDevTools(id);
  },

  openExternal() {
    const id = get().viewId;
    if (id) void window.omp.browser.openExternal(id);
  },

  destroy() {
    const id = get().viewId;
    if (!id) return;
    if (get().tabs.some((t) => t.id === id)) {
      get().close(id);
      return;
    }
    void window.omp.browser.destroy(id);
    set({ viewId: null, state: null });
  },

  _applyState(incoming) {
    // Only known tabs are reduced; stale events from closed/foreign views never
    // resurrect tab metadata, active state, or history.
    if (!get().tabs.some((t) => t.id === incoming.id)) return;
    set((s) => {
      const url = incoming.url;
      let history = s.history;
      if (url && url !== history[0]) {
        history = [url, ...history.filter((h) => h !== url)].slice(
          0,
          HISTORY_CAP,
        );
      }
      return {
        state: incoming.id === s.viewId ? incoming : s.state,
        tabs: upsertTab(s.tabs, incoming),
        history,
        _states: { ...s._states, [incoming.id]: incoming },
      };
    });
  },
}));

function upsertTab(tabs: BrowserTab[], state: BrowserViewState): BrowserTab[] {
  const tab = {
    id: state.id,
    title: state.title,
    url: state.url,
    loading: state.loading,
  };
  const index = tabs.findIndex((t) => t.id === state.id);
  if (index === -1) return [...tabs, tab];
  return tabs.map((t, i) => (i === index ? tab : t));
}

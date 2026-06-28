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

interface BrowserStore {
  /** Id of the live main-owned view, or null when none exists. */
  viewId: string | null;
  /** Latest nav state pushed for `viewId` (null until the first push/create). */
  state: BrowserViewState | null;
  /** Distinct visited URLs, most-recent first (omnibox history source). */
  history: string[];
  /** True while a `create` is in flight (prevents a duplicate view). */
  creating: boolean;
  error: string | undefined;
  /** Unsubscribe for the global `onState` listener; null when not subscribed. */
  _unsub: (() => void) | null;

  /** Register the single global `onState` subscription (idempotent). */
  ensureSubscribed(): void;
  /** Release the global subscription. */
  teardown(): void;
  /** Create the main-owned view over `bounds` and load `url` (no-op if one exists). */
  create(opts: { url: string; bounds: BrowserBounds }): Promise<void>;
  /** Navigate the live view to `url`. */
  navigate(url: string): void;
  back(): void;
  forward(): void;
  reload(): void;
  openDevTools(): void;
  openExternal(): void;
  /** Destroy the live view and clear local nav state. */
  destroy(): void;
  /** Reduce an incoming state push for the active view (ignores foreign ids). */
  _applyState(incoming: BrowserViewState): void;
}

export const useBrowserStore = create<BrowserStore>((set, get) => ({
  viewId: null,
  state: null,
  history: [],
  creating: false,
  error: undefined,
  _unsub: null,

  ensureSubscribed() {
    if (get()._unsub) return;
    const off = window.omp.browser.onState((s) => get()._applyState(s));
    set({ _unsub: off });
  },

  teardown() {
    get()._unsub?.();
    set({ _unsub: null });
  },

  async create(opts) {
    if (get().viewId || get().creating) return;
    set({ creating: true, error: undefined });
    try {
      const state = await window.omp.browser.create(opts);
      set({ creating: false, viewId: state.id });
      // Adopt the initial url/state synchronously; later transitions arrive via
      // the onState subscription registered in ensureSubscribed.
      get()._applyState(state);
    } catch (e) {
      set({
        creating: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
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
    void window.omp.browser.destroy(id);
    set({ viewId: null, state: null });
  },

  _applyState(incoming) {
    // Only the active view's pushes matter; a stale/foreign id is dropped so a
    // late event from a torn-down view never resurrects state.
    if (incoming.id !== get().viewId) return;
    set((s) => {
      const url = incoming.url;
      let history = s.history;
      if (url && url !== history[0]) {
        history = [url, ...history.filter((h) => h !== url)].slice(
          0,
          HISTORY_CAP,
        );
      }
      return { state: incoming, history };
    });
  },
}));

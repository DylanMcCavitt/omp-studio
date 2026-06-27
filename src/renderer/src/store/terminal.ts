// Renderer-side terminal store (feature 7). A pty is a REAL shell spawned in
// main with the user's full privileges — not a sandbox. This store owns no
// process handle; it only forwards I/O to/from `window.omp.terminal.*` and
// keeps a small record of which terminals are open, keyed by the main-assigned
// `termId`.
//
// Like `store/chat.ts`, it registers exactly ONE global subscription to the
// high-frequency event streams (`onData`/`onExit`) and routes each frame to the
// right terminal by id. A pty's byte stream is far too hot to push through
// React state, so data is delivered to per-terminal *sinks* (the live xterm
// instance writes them straight to its buffer) instead of being reduced into
// the store — the store only reflects coarse lifecycle (open / exited) that the
// view actually re-renders on.

import type { TerminalInfo } from "@shared/domain";
import { create } from "zustand";

const MAX_DETACHED_BUFFER_CHARS = 64 * 1024;

/** Coarse, render-worthy lifecycle for one open terminal (not its scrollback). */
export interface TerminalEntry {
  id: string;
  cwd: string;
  shell: string;
  createdAt: string;
  /** True once the pty has exited; the view shows a restart affordance. */
  exited: boolean;
  /** Exit code reported by the pty (null = killed by signal / unknown). */
  exitCode?: number | null;
}

interface TerminalState {
  /** Every open terminal's lifecycle record, keyed by main's `termId`. */
  terminals: Record<string, TerminalEntry>;
  /** Cleanup for the single global data/exit subscription (null until wired). */
  _unsub: (() => void) | null;
}

interface TerminalActions {
  /** Register the single global onData/onExit subscription. Idempotent. */
  ensureSubscribed(): void;
  /** Tear down the global subscription (mirror of ensureSubscribed). */
  teardown(): void;

  /**
   * Spawn a pty in `cwd` sized to `cols`x`rows`, record it, and return its
   * info. Rejects (propagated to the caller) when main refuses — capability
   * disabled, concurrency cap hit, or a non-existent cwd — so the view can show
   * the honest reason rather than a silently blank terminal.
   */
  create(cwd: string, cols: number, rows: number): Promise<TerminalInfo>;
  /** Forward user keystrokes to the pty (no-op on an unknown / exited id). */
  write(id: string, data: string): void;
  /** Forward a fit/resize to the pty so its rows/cols track the viewport. */
  resize(id: string, cols: number, rows: number): void;
  /** Kill the pty and drop all local state + sinks for `id`. */
  dispose(id: string): Promise<void>;

  /**
   * Bind a sink for terminal `id`'s output. Any bytes that arrived before the
   * sink attached (the shell's initial prompt, emitted the instant the pty
   * spawns) are flushed to it first, in arrival order, so nothing is lost in
   * the gap between `create()` resolving and the view subscribing. Returns an
   * unsubscribe.
   */
  subscribeData(id: string, cb: (data: string) => void): () => void;
  /**
   * Bind a listener for terminal `id`'s exit. If the pty has already exited
   * (it raced ahead of the subscribe), the listener fires once immediately with
   * the recorded code. Returns an unsubscribe.
   */
  subscribeExit(id: string, cb: (code: number | null) => void): () => void;
}

export type TerminalStore = TerminalState & TerminalActions;

export const useTerminalStore = create<TerminalStore>()((set, get) => {
  // Non-reactive side-effect channels, private to the store singleton (same
  // shape as settings.ts's debounce closure state). Output never funnels
  // through `set` — it is written straight to the bound xterm instance.
  const dataSinks = new Map<string, Set<(data: string) => void>>();
  const exitSinks = new Map<string, Set<(code: number | null) => void>>();
  // Output buffered before a sink attaches, per id, flushed on subscribe. A
  // retained pty can keep writing while its panel is closed, so detached buffers
  // are capped to the latest output instead of growing renderer memory forever.
  const dataBuffers = new Map<string, string[]>();
  const dataBufferSizes = new Map<string, number>();

  return {
    terminals: {},
    _unsub: null,

    ensureSubscribed() {
      if (get()._unsub) return;
      const offData = window.omp.terminal.onData(({ id, data }) => {
        const sinks = dataSinks.get(id);
        if (sinks && sinks.size > 0) {
          for (const cb of sinks) cb(data);
          return;
        }
        // No live sink yet: hold a bounded tail until the view subscribes.
        let buf = dataBuffers.get(id);
        let size = dataBufferSizes.get(id) ?? 0;
        if (!buf) {
          buf = [];
          dataBuffers.set(id, buf);
        }
        if (data.length >= MAX_DETACHED_BUFFER_CHARS) {
          buf.splice(0, buf.length, data.slice(-MAX_DETACHED_BUFFER_CHARS));
          size = MAX_DETACHED_BUFFER_CHARS;
        } else {
          buf.push(data);
          size += data.length;
        }
        while (size > MAX_DETACHED_BUFFER_CHARS && buf.length > 0) {
          const overflow = size - MAX_DETACHED_BUFFER_CHARS;
          const first = buf[0];
          if (!first) break;
          if (first.length <= overflow) {
            size -= first.length;
            buf.shift();
          } else {
            buf[0] = first.slice(overflow);
            size -= overflow;
          }
        }
        dataBufferSizes.set(id, size);
      });
      const offExit = window.omp.terminal.onExit(({ id, code }) => {
        set((s) => {
          const t = s.terminals[id];
          if (!t) return s;
          return {
            terminals: {
              ...s.terminals,
              [id]: { ...t, exited: true, exitCode: code },
            },
          };
        });
        const sinks = exitSinks.get(id);
        if (sinks) for (const cb of sinks) cb(code);
      });
      set({
        _unsub: () => {
          offData();
          offExit();
        },
      });
    },

    teardown() {
      const unsub = get()._unsub;
      if (unsub) unsub();
      set({ _unsub: null });
    },

    async create(cwd, cols, rows) {
      get().ensureSubscribed();
      const info = await window.omp.terminal.create({ cwd, cols, rows });
      set((s) => ({
        terminals: {
          ...s.terminals,
          [info.id]: {
            id: info.id,
            cwd: info.cwd,
            shell: info.shell,
            createdAt: info.createdAt,
            exited: false,
          },
        },
      }));
      return info;
    },

    write(id, data) {
      // Fire-and-forget: main no-ops an unknown/exited id, so a write that
      // races an exit must never surface as an unhandled rejection.
      void window.omp.terminal.write(id, data).catch(() => {});
    },

    resize(id, cols, rows) {
      void window.omp.terminal.resize(id, cols, rows).catch(() => {});
    },

    async dispose(id) {
      try {
        await window.omp.terminal.kill(id);
      } catch {
        // main already dropped it (e.g. it exited first) — fall through.
      }
      dataSinks.delete(id);
      exitSinks.delete(id);
      dataBuffers.delete(id);
      dataBufferSizes.delete(id);
      set((s) => {
        if (!(id in s.terminals)) return s;
        const terminals = { ...s.terminals };
        delete terminals[id];
        return { terminals };
      });
    },

    subscribeData(id, cb) {
      let sinks = dataSinks.get(id);
      if (!sinks) {
        sinks = new Set();
        dataSinks.set(id, sinks);
      }
      // Replay anything buffered before this sink attached, in arrival order.
      const buffered = dataBuffers.get(id);
      if (buffered) {
        dataBuffers.delete(id);
        dataBufferSizes.delete(id);
        for (const chunk of buffered) cb(chunk);
      }
      sinks.add(cb);
      return () => {
        dataSinks.get(id)?.delete(cb);
      };
    },

    subscribeExit(id, cb) {
      let sinks = exitSinks.get(id);
      if (!sinks) {
        sinks = new Set();
        exitSinks.set(id, sinks);
      }
      sinks.add(cb);
      // The pty may have exited before this listener attached.
      const entry = get().terminals[id];
      if (entry?.exited) cb(entry.exitCode ?? null);
      return () => {
        exitSinks.get(id)?.delete(cb);
      };
    },
  };
});

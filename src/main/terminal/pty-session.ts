// A single live pty (pseudo-terminal): wraps one node-pty IPty handle and
// adapts its high-frequency byte stream into batched, IPC-friendly emits.
//
// This module must stay importable by PLAIN NODE via type-stripping, so it uses
// only erasable TypeScript (no enums, namespaces, parameter-properties) and
// never imports electron or node-pty directly — the pty handle is injected
// through the minimal structural `IPtyLike` surface, so the module loads even
// when the native addon is unavailable (tests inject a fake; the registry's
// default factory loads node-pty lazily on first spawn).
//
// Emits (EventEmitter):
//   - "data" (data: string)        — coalesced terminal output
//   - "exit" (code: number | null) — child exited (emitted at most once)

import { EventEmitter } from "node:events";
import type { TerminalInfo } from "@shared/domain";

// The slice of node-pty's IPty this module depends on. Keeping it structural
// means node-pty is never statically imported here — only the registry's
// default factory touches the real addon. node-pty's IPty satisfies this shape.
export interface IPtyLike {
  readonly pid: number;
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (e: { exitCode: number; signal?: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

// Coalescing keeps a burst of pty output (e.g. `cat bigfile`, a TUI redraw)
// from turning into one IPC message per chunk. The buffer is flushed once it
// has been quiet for FLUSH_INTERVAL_MS, or immediately when it crosses
// FLUSH_SIZE_THRESHOLD — whichever comes first — bounding both latency and the
// number of evt:terminal-data messages crossing the IPC boundary.
const FLUSH_INTERVAL_MS = 16;
const FLUSH_SIZE_THRESHOLD = 16_384;

export class PtySession extends EventEmitter {
  readonly id: string;
  readonly cwd: string;
  readonly shell: string;
  readonly createdAt: string;
  private cols: number;
  private rows: number;
  private readonly pty: IPtyLike;
  private pending = "";
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private exited = false;
  private disposed = false;
  // node-pty's onData/onExit return IDisposable subscriptions. They are
  // retained so dispose() can detach them from the NATIVE handle —
  // removeAllListeners() only drops this emitter's own listeners and would
  // leave the pty->session callbacks alive on the addon side.
  private readonly subscriptions: Array<{ dispose(): void }> = [];

  constructor(opts: {
    id: string;
    cwd: string;
    shell: string;
    cols: number;
    rows: number;
    pty: IPtyLike;
  }) {
    super();
    this.id = opts.id;
    this.cwd = opts.cwd;
    this.shell = opts.shell;
    this.cols = opts.cols;
    this.rows = opts.rows;
    this.pty = opts.pty;
    this.createdAt = new Date().toISOString();
    this.retain(this.pty.onData((data) => this.handleData(data)));
    this.retain(this.pty.onExit((e) => this.handleExit(e)));
  }

  /** Renderer-facing descriptor (terminal:create / terminal:list). */
  get info(): TerminalInfo {
    return {
      id: this.id,
      cwd: this.cwd,
      shell: this.shell,
      cols: this.cols,
      rows: this.rows,
      createdAt: this.createdAt,
    };
  }

  // Input flows ONLY from the local terminal view (never auto-fed from agent
  // output, evt:rpc frames, or remote content). Dropped once the pty has exited
  // or been disposed so a late write never hits a dead handle.
  write(data: string): void {
    if (this.exited || this.disposed) return;
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.exited || this.disposed) return;
    this.cols = cols;
    this.rows = rows;
    this.pty.resize(cols, rows);
  }

  // Request termination. The pty's natural onExit drives the "exit" emit and
  // registry cleanup — kill() never synthesizes an exit itself.
  kill(): void {
    if (this.exited || this.disposed) return;
    try {
      this.pty.kill();
    } catch {
      // Already dead / unkillable — the onExit path (or dispose) cleans up.
    }
  }

  // Hard teardown on app quit: stop the flush timer, kill the child, and drop
  // listeners. Idempotent and silent — no final "data"/"exit" is emitted since
  // the renderer is going away with the process. Mirrors OmpRpcSession.dispose.
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pending = "";
    try {
      this.pty.kill();
    } catch {
      // Already dead — nothing to clean up beyond dropping listeners.
    }
    for (const sub of this.subscriptions.splice(0)) {
      try {
        sub.dispose();
      } catch {
        // A dead native handle may throw on detach; teardown must not.
      }
    }
    this.removeAllListeners();
  }

  // Keep a pty event subscription iff the injected handle returned a real
  // IDisposable (node-pty does; minimal test fakes may return undefined).
  private retain(subscription: unknown): void {
    if (
      typeof subscription === "object" &&
      subscription !== null &&
      "dispose" in subscription &&
      typeof (subscription as { dispose: unknown }).dispose === "function"
    ) {
      this.subscriptions.push(subscription as { dispose(): void });
    }
  }

  private handleData(data: string): void {
    if (this.exited || this.disposed) return;
    this.pending += data;
    if (this.pending.length >= FLUSH_SIZE_THRESHOLD) {
      this.flush();
      return;
    }
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  private flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pending.length === 0 || this.disposed) return;
    const data = this.pending;
    this.pending = "";
    this.emit("data", data);
  }

  private handleExit(e: { exitCode: number; signal?: number }): void {
    if (this.exited || this.disposed) return;
    this.exited = true;
    // Flush buffered output before the exit so the renderer never loses the
    // final bytes a program wrote right before terminating.
    this.flush();
    const code =
      typeof e?.exitCode === "number" && Number.isFinite(e.exitCode)
        ? e.exitCode
        : null;
    this.emit("exit", code);
  }
}

// Owns the set of live pty (terminal) sessions — one IPty per opaque terminal
// id the renderer addresses. Mirrors SessionRegistry's discipline: injectable
// seams (a pty factory + a settings reader) so tests never spawn a real shell,
// a map keyed by id, and a synchronous disposeAll() that the coordinator
// (index.ts) wires into the electron quit hooks so no orphan shell outlives the
// app. Plain node, type-strippable — no electron import; node-pty is loaded
// lazily by the default factory only when a terminal is actually spawned, so a
// missing/unbuilt native addon never crashes app startup, only an opted-in
// terminal:create.

import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import type { TerminalInfo } from "@shared/domain";
import type { IPty } from "node-pty";
import { augmentedEnv } from "../paths";
import { loadSettings } from "../services/settings-service";
import { type IPtyLike, PtySession } from "./pty-session";

// Cap used when the terminal capability is enabled but the concurrency value is
// somehow absent/invalid — matches settings-service's default of 4.
const DEFAULT_MAX_CONCURRENT = 4;

// Fallback geometry for a malformed/zero cols-rows from the renderer; node-pty
// requires positive integers and would otherwise throw on spawn.
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

// Hard ceiling on one terminal:write payload. A pty is a real shell; a
// renderer bug (or hostile payload) must not be able to stream unbounded
// bytes into it in a single call. Generous enough for any human paste.
const MAX_WRITE_BYTES = 1_048_576;

/** Resolved spawn config handed to the pty factory. */
export interface PtySpawnOptions {
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
}

// How the registry materializes a pty. Injectable at construction (main owns the
// registry; the renderer never constructs it, so this is not a renderer-reachable
// sink) — letting tests assert lifecycle/cap without a real shell. Mirrors
// SessionRegistry's SessionFactory.
export type PtyFactory = (opts: PtySpawnOptions) => IPtyLike;

/** The capability gate + concurrency cap the registry enforces on create. */
export interface TerminalCaps {
  enabled: boolean;
  maxConcurrent: number;
}

// Read fresh on each create so a settings toggle is picked up immediately.
// Injectable for hermetic tests (no settings file / userData touched).
export type TerminalCapsReader = () => Promise<TerminalCaps>;

// The minimal node-pty module surface the default factory uses. Declared
// locally (rather than via `typeof import(...)`) so the import stays a top-level
// type-only reference and the spawn call is type-checked.
interface NodePtyModule {
  spawn(
    file: string,
    args: string[] | string,
    options: {
      name?: string;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      cols?: number;
      rows?: number;
    },
  ): IPty;
}

const requireNative = createRequire(import.meta.url);

const defaultFactory: PtyFactory = (opts) => {
  // Lazy require: the native addon loads only when a terminal is actually
  // spawned (the capability is off by default), so an unbuilt node-pty never
  // breaks app startup. Mirrors secret-store's lazy electron require.
  const pty = requireNative("node-pty") as NodePtyModule;
  return pty.spawn(opts.shell, [], {
    name: "xterm-color",
    cwd: opts.cwd,
    env: opts.env,
    cols: opts.cols,
    rows: opts.rows,
  });
};

const defaultCapsReader: TerminalCapsReader = async () => {
  const { terminal } = await loadSettings();
  return {
    enabled: terminal?.enabled === true,
    maxConcurrent:
      typeof terminal?.maxConcurrent === "number" && terminal.maxConcurrent > 0
        ? terminal.maxConcurrent
        : DEFAULT_MAX_CONCURRENT,
  };
};

// Cross-platform login shell: on win32 prefer ComSpec (cmd.exe), else
// PowerShell; elsewhere honor $SHELL and fall back to /bin/bash.
function resolveShell(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec ?? "powershell.exe";
  }
  return process.env.SHELL ?? "/bin/bash";
}

function isExistingDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export class TerminalRegistry {
  private readonly sessions = new Map<string, PtySession>();
  private readonly spawnPty: PtyFactory;
  private readonly readCaps: TerminalCapsReader;

  constructor(opts?: { spawnPty?: PtyFactory; readCaps?: TerminalCapsReader }) {
    this.spawnPty = opts?.spawnPty ?? defaultFactory;
    this.readCaps = opts?.readCaps ?? defaultCapsReader;
  }

  // Spawn a new pty in `cwd`. Enforces the capability gate (off by default) and
  // the concurrency cap, and validates cwd is a real, existing directory before
  // spawning — a shell is never spawned in an unvalidated dir. Throws a clean
  // error (the IPC layer surfaces it to the renderer) rather than degrading
  // silently, since the caller needs to know why no terminal appeared.
  async create(opts: {
    cwd: string;
    cols: number;
    rows: number;
  }): Promise<PtySession> {
    const { enabled, maxConcurrent } = await this.readCaps();
    if (!enabled) {
      throw new Error("terminal capability is disabled");
    }
    if (this.sessions.size >= maxConcurrent) {
      throw new Error(`terminal limit reached (max ${maxConcurrent})`);
    }
    if (typeof opts.cwd !== "string" || opts.cwd.length === 0) {
      throw new Error("terminal cwd is required");
    }
    if (!isExistingDir(opts.cwd)) {
      throw new Error("terminal cwd is not an existing directory");
    }
    const shell = resolveShell();
    // Guard against a malformed/zero geometry; node-pty needs positive ints.
    const cols =
      Number.isInteger(opts.cols) && opts.cols > 0 ? opts.cols : DEFAULT_COLS;
    const rows =
      Number.isInteger(opts.rows) && opts.rows > 0 ? opts.rows : DEFAULT_ROWS;
    const pty = this.spawnPty({
      shell,
      cwd: opts.cwd,
      cols,
      rows,
      env: augmentedEnv(),
    });
    const id = randomUUID();
    const session = new PtySession({
      id,
      cwd: opts.cwd,
      shell,
      cols,
      rows,
      pty,
    });
    this.sessions.set(id, session);
    // Drop the record when the pty exits (user typed `exit`, was killed, or
    // crashed) so it stops counting against the cap and leaves terminal:list.
    // The IPC layer subscribes to the same "exit" to push evt:terminal-exit.
    session.on("exit", () => {
      this.sessions.delete(id);
    });
    return session;
  }

  get(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }

  // Write renderer input to a live pty. A pty is a REAL SHELL with full user
  // privileges, so the capability gate is re-checked on every write (fresh
  // read — a settings toggle-off takes effect immediately, even for ptys
  // spawned while enabled) and the payload is shape/size-validated before it
  // can reach the native handle. An unknown id stays a silent no-op: the
  // renderer may race a write against an exit it has not processed yet.
  async write(id: unknown, data: unknown): Promise<void> {
    if (typeof id !== "string" || typeof data !== "string") {
      throw new Error("terminal write requires a string id and string data");
    }
    if (data.length === 0) return;
    // Cap in BYTES (what the pty fd actually receives), not UTF-16 code
    // units — a non-ASCII payload is up to 3x its .length in UTF-8.
    if (Buffer.byteLength(data, "utf8") > MAX_WRITE_BYTES) {
      throw new Error("terminal write payload exceeds the maximum size");
    }
    const session = this.sessions.get(id);
    if (!session) return;
    const { enabled } = await this.readCaps();
    if (!enabled) {
      throw new Error("terminal capability is disabled");
    }
    session.write(data);
  }

  /** Snapshot of every live terminal. */
  list(): TerminalInfo[] {
    return [...this.sessions.values()].map((session) => session.info);
  }

  // Kill every live pty and clear the map. Synchronous to match the electron
  // lifecycle hooks (window-all-closed / before-quit) the coordinator wires it
  // into — no orphan shell survives the app.
  disposeAll(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
  }
}

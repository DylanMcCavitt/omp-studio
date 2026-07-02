import { afterAll, expect, jest, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type IPtyLike, PtySession } from "../src/main/terminal/pty-session";
import {
  type PtyFactory,
  type PtySpawnOptions,
  type TerminalCaps,
  TerminalRegistry,
} from "../src/main/terminal/registry";

// Exercises the terminal backend through its injectable seams only: a fake pty
// factory (no real shell spawned) and a stub capability reader (no settings
// file / userData touched). cwd validation hits the real filesystem, so spawn
// targets are created under a temp root.

const tmpRoot = mkdtempSync(join(tmpdir(), "omp-terminal-"));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

// What resolveShell() should pick on this platform — the registry records the
// resolved shell into the spawn config, so the test asserts against the same
// rule rather than a hard-coded value.
const expectedShell =
  process.platform === "win32"
    ? (process.env.ComSpec ?? "powershell.exe")
    : (process.env.SHELL ?? "/bin/bash");

// A stand-in for a node-pty IPty: records writes/resizes/kills and lets a test
// drive the data/exit callbacks the PtySession wires up in its constructor.
class FakePty implements IPtyLike {
  readonly pid: number;
  killed = false;
  readonly written: string[] = [];
  readonly resizes: Array<[number, number]> = [];
  readonly disposed: string[] = [];
  private dataCb: ((data: string) => void) | null = null;
  private exitCb: ((e: { exitCode: number; signal?: number }) => void) | null =
    null;

  constructor(pid = 4000) {
    this.pid = pid;
  }
  onData(listener: (data: string) => void): unknown {
    this.dataCb = listener;
    return {
      dispose: () => {
        this.disposed.push("data");
        this.dataCb = null;
      },
    };
  }
  onExit(
    listener: (e: { exitCode: number; signal?: number }) => void,
  ): unknown {
    this.exitCb = listener;
    return {
      dispose: () => {
        this.disposed.push("exit");
        this.exitCb = null;
      },
    };
  }
  write(data: string): void {
    this.written.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resizes.push([cols, rows]);
  }
  kill(): void {
    this.killed = true;
  }
  // ---- test drivers ----
  pushData(data: string): void {
    this.dataCb?.(data);
  }
  pushExit(exitCode: number): void {
    this.exitCb?.({ exitCode });
  }
  pushExitRaw(e: { exitCode: number; signal?: number }): void {
    this.exitCb?.(e);
  }
}

function makeRegistry(caps: Partial<TerminalCaps> = {}) {
  const spawns: PtySpawnOptions[] = [];
  const ptys: FakePty[] = [];
  const spawnPty: PtyFactory = (opts) => {
    spawns.push(opts);
    const pty = new FakePty(4000 + ptys.length);
    ptys.push(pty);
    return pty;
  };
  const readCaps = async (): Promise<TerminalCaps> => ({
    enabled: caps.enabled ?? true,
    maxConcurrent: caps.maxConcurrent ?? 4,
  });
  return {
    registry: new TerminalRegistry({ spawnPty, readCaps }),
    spawns,
    ptys,
  };
}

function newSession(pty: IPtyLike, over: { id?: string } = {}): PtySession {
  return new PtySession({
    id: over.id ?? "t",
    cwd: tmpRoot,
    shell: expectedShell,
    cols: 80,
    rows: 24,
    pty,
  });
}

// ---------------------------------------------------------------------------
// TerminalRegistry
// ---------------------------------------------------------------------------

test("create spawns a pty in a validated cwd and returns its TerminalInfo", async () => {
  const { registry, spawns } = makeRegistry();
  const session = await registry.create({ cwd: tmpRoot, cols: 100, rows: 30 });

  expect(spawns).toHaveLength(1);
  expect(spawns[0]?.cwd).toBe(tmpRoot);
  expect(spawns[0]?.cols).toBe(100);
  expect(spawns[0]?.rows).toBe(30);
  expect(spawns[0]?.shell).toBe(expectedShell);

  const info = session.info;
  expect(info.cwd).toBe(tmpRoot);
  expect(info.cols).toBe(100);
  expect(info.rows).toBe(30);
  expect(info.shell).toBe(expectedShell);
  expect(typeof info.createdAt).toBe("string");

  expect(registry.list()).toHaveLength(1);
  expect(registry.list()[0]?.id).toBe(info.id);
});

test("create rejects when the terminal capability is disabled", async () => {
  const { registry, spawns } = makeRegistry({ enabled: false });
  await expect(
    registry.create({ cwd: tmpRoot, cols: 80, rows: 24 }),
  ).rejects.toThrow(/disabled/);
  expect(spawns).toHaveLength(0);
});

test("create enforces settings.terminal.maxConcurrent", async () => {
  const { registry } = makeRegistry({ maxConcurrent: 2 });
  await registry.create({ cwd: tmpRoot, cols: 80, rows: 24 });
  await registry.create({ cwd: tmpRoot, cols: 80, rows: 24 });
  await expect(
    registry.create({ cwd: tmpRoot, cols: 80, rows: 24 }),
  ).rejects.toThrow(/limit reached/);
  expect(registry.list()).toHaveLength(2);
});

test("a pty exit frees a slot under the cap and leaves the list", async () => {
  const { registry, ptys } = makeRegistry({ maxConcurrent: 1 });
  const first = await registry.create({ cwd: tmpRoot, cols: 80, rows: 24 });
  await expect(
    registry.create({ cwd: tmpRoot, cols: 80, rows: 24 }),
  ).rejects.toThrow(/limit reached/);

  ptys[0]?.pushExit(0); // pty exits → registry drops the record
  expect(registry.list()).toHaveLength(0);
  expect(registry.get(first.info.id)).toBeUndefined();

  // The freed slot lets a new terminal spawn under the same cap.
  const second = await registry.create({ cwd: tmpRoot, cols: 80, rows: 24 });
  expect(registry.list()).toHaveLength(1);
  expect(registry.list()[0]?.id).toBe(second.info.id);
});

test("create validates cwd: empty, missing, and non-directory are rejected", async () => {
  const { registry, spawns } = makeRegistry();
  await expect(
    registry.create({ cwd: "", cols: 80, rows: 24 }),
  ).rejects.toThrow(/cwd is required/);
  await expect(
    registry.create({ cwd: join(tmpRoot, "nope"), cols: 80, rows: 24 }),
  ).rejects.toThrow(/existing directory/);

  const filePath = join(tmpRoot, "regular.txt");
  writeFileSync(filePath, "x");
  await expect(
    registry.create({ cwd: filePath, cols: 80, rows: 24 }),
  ).rejects.toThrow(/existing directory/);

  expect(spawns).toHaveLength(0);
});

test("write/resize delegate to the live pty; unknown ids no-op", async () => {
  const { registry, ptys } = makeRegistry();
  const session = await registry.create({ cwd: tmpRoot, cols: 80, rows: 24 });
  const id = session.info.id;

  registry.get(id)?.write("ls\n");
  registry.get(id)?.resize(120, 40);
  expect(ptys[0]?.written).toEqual(["ls\n"]);
  expect(ptys[0]?.resizes).toEqual([[120, 40]]);
  expect(registry.get(id)?.info.cols).toBe(120);
  expect(registry.get(id)?.info.rows).toBe(40);

  // Unknown id is a no-op, never a throw (renderer may race a write past exit).
  expect(registry.get("unknown")).toBeUndefined();
  expect(() => registry.get("unknown")?.write("x")).not.toThrow();
});

test("kill terminates the pty and the natural exit removes it", async () => {
  const { registry, ptys } = makeRegistry();
  const session = await registry.create({ cwd: tmpRoot, cols: 80, rows: 24 });
  registry.get(session.info.id)?.kill();
  expect(ptys[0]?.killed).toBe(true);
  expect(registry.list()).toHaveLength(1); // still tracked until pty exits

  ptys[0]?.pushExit(0);
  expect(registry.list()).toHaveLength(0);
});

test("disposeAll kills every live pty and clears the registry", async () => {
  const { registry, ptys } = makeRegistry({ maxConcurrent: 5 });
  await registry.create({ cwd: tmpRoot, cols: 80, rows: 24 });
  await registry.create({ cwd: tmpRoot, cols: 80, rows: 24 });
  expect(registry.list()).toHaveLength(2);

  registry.disposeAll();
  expect(ptys.every((p) => p.killed)).toBe(true);
  expect(registry.list()).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// PtySession — coalescing + exit + lifecycle
// ---------------------------------------------------------------------------

test("coalesces buffered output and flushes it before exit", () => {
  const pty = new FakePty();
  const session = newSession(pty);
  const chunks: string[] = [];
  session.on("data", (d: string) => chunks.push(d));

  pty.pushData("foo");
  pty.pushData("bar");
  // Small chunks are buffered, not emitted one IPC message per chunk.
  expect(chunks).toEqual([]);

  let exitCode: number | null = -1;
  session.on("exit", (code: number | null) => {
    exitCode = code;
  });
  pty.pushExit(0);
  // Exit flushes the buffer (one combined emit), then signals exit.
  expect(chunks).toEqual(["foobar"]);
  expect(exitCode).toBe(0);
});

test("flushes immediately once the buffer crosses the size threshold", () => {
  const pty = new FakePty();
  const session = newSession(pty);
  const chunks: string[] = [];
  session.on("data", (d: string) => chunks.push(d));

  const big = "x".repeat(16_384);
  pty.pushData(big);
  // No timer needed: a buffer at/over the threshold flushes synchronously.
  expect(chunks).toEqual([big]);
});

test("flushes buffered output after a quiet interval", () => {
  jest.useFakeTimers();
  try {
    const pty = new FakePty();
    const session = newSession(pty);
    const chunks: string[] = [];
    session.on("data", (d: string) => chunks.push(d));

    pty.pushData("hi");
    expect(chunks).toEqual([]); // buffered, awaiting the quiet-interval timer
    jest.advanceTimersByTime(16);
    expect(chunks).toEqual(["hi"]);
  } finally {
    jest.useRealTimers();
  }
});

test("normalizes a non-finite exit code to null", () => {
  const pty = new FakePty();
  const session = newSession(pty);
  let exitCode: number | null = 7;
  session.on("exit", (code: number | null) => {
    exitCode = code;
  });
  pty.pushExitRaw({ exitCode: Number.NaN });
  expect(exitCode).toBeNull();
});

test("drops input written after the pty has exited", () => {
  const pty = new FakePty();
  const session = newSession(pty);
  pty.pushExit(0);
  session.write("late");
  expect(pty.written).toEqual([]);
});

test("dispose kills the pty and emits no further data or exit", () => {
  const pty = new FakePty();
  const session = newSession(pty);
  const chunks: string[] = [];
  let exited = false;
  session.on("data", (d: string) => chunks.push(d));
  session.on("exit", () => {
    exited = true;
  });

  pty.pushData("buffered"); // buffered, not yet flushed
  session.dispose();
  expect(pty.killed).toBe(true);
  expect(chunks).toEqual([]); // disposed → buffer dropped, no emit
  expect(exited).toBe(false); // disposed → no exit emit
});

// ---------------------------------------------------------------------------
// AGE-802: gated terminal:write path + native disposable cleanup.
// ---------------------------------------------------------------------------

test("registry.write routes validated input to the pty", async () => {
  const { registry, ptys } = makeRegistry();
  const session = await registry.create({ cwd: tmpRoot, cols: 80, rows: 24 });
  await registry.write(session.id, "ls -la\n");
  expect(ptys[0]?.written).toEqual(["ls -la\n"]);
});

test("registry.write re-checks the capability gate on every write", async () => {
  // Caps are read FRESH per call: enabled at create time, then toggled off.
  let enabled = true;
  const spawnPty: PtyFactory = () => new FakePty();
  const registry = new TerminalRegistry({
    spawnPty,
    readCaps: async () => ({ enabled, maxConcurrent: 4 }),
  });
  const session = await registry.create({ cwd: tmpRoot, cols: 80, rows: 24 });

  enabled = false;
  await expect(registry.write(session.id, "rm -rf /\n")).rejects.toThrow(
    /disabled/,
  );
  // The pty received NOTHING once the capability was off.
  const pty = registry.get(session.id);
  expect(pty).toBeDefined();
  session.dispose();
});

test("registry.write rejects non-string id/data and oversized payloads without touching a pty", async () => {
  const { registry, ptys } = makeRegistry();
  const session = await registry.create({ cwd: tmpRoot, cols: 80, rows: 24 });

  await expect(registry.write(42, "x")).rejects.toThrow(/string id/);
  await expect(registry.write(session.id, { evil: 1 })).rejects.toThrow(
    /string/,
  );
  await expect(
    registry.write(session.id, "x".repeat(1_048_577)),
  ).rejects.toThrow(/maximum size/);
  // The cap is BYTES, not UTF-16 code units: a 3-byte-per-char payload whose
  // .length is under the cap must still be rejected.
  await expect(
    registry.write(session.id, "\u0800".repeat(400_000)),
  ).rejects.toThrow(/maximum size/);
  expect(ptys[0]?.written).toEqual([]);
});

test("registry.write is a silent no-op for an unknown id (write/exit race)", async () => {
  const { registry } = makeRegistry();
  await expect(registry.write("ghost", "ls\n")).resolves.toBeUndefined();
});

test("dispose detaches the native onData/onExit subscriptions", () => {
  const pty = new FakePty();
  const session = newSession(pty);
  expect(pty.disposed).toEqual([]);

  session.dispose();

  // Both node-pty disposables were disposed — not just EventEmitter listeners.
  expect(pty.disposed.sort()).toEqual(["data", "exit"]);
  // A post-dispose native callback (addon race) finds no live subscription.
  pty.pushData("late");
  pty.pushExit(0);
});

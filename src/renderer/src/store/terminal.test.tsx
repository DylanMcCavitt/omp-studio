// AGE-622 — the terminal store. The behaviours that matter: it registers ONE
// global onData/onExit subscription (idempotent), routes each frame to the sink
// bound to its termId and to no other, replays output that arrived before a
// sink attached (so the shell's first prompt is never lost), and reflects the
// pty's exit in coarse state + to a late-attaching exit listener.

import type { TerminalInfo } from "@shared/domain";
import { useTerminalStore } from "@/store/terminal";

type DataCb = (e: { id: string; data: string }) => void;
type ExitCb = (e: { id: string; code: number | null }) => void;

// Unique ids across the whole file so the store's per-id sink/buffer maps
// (private to the singleton, not resettable via setState) never collide between
// cases.
let seq = 0;
const uid = (prefix = "t") => `${prefix}-${seq++}`;

function info(id: string, over: Partial<TerminalInfo> = {}): TerminalInfo {
  return {
    id,
    cwd: "/work",
    shell: "/bin/zsh",
    cols: 80,
    rows: 24,
    createdAt: "2026-06-23T00:00:00.000Z",
    ...over,
  };
}

function installTerminalMock() {
  const dataCbs = new Set<DataCb>();
  const exitCbs = new Set<ExitCb>();
  const onData = vi.fn((cb: DataCb) => {
    dataCbs.add(cb);
    return () => dataCbs.delete(cb);
  });
  const onExit = vi.fn((cb: ExitCb) => {
    exitCbs.add(cb);
    return () => exitCbs.delete(cb);
  });
  const terminal = {
    create: vi.fn(),
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    onData,
    onExit,
  };
  Object.assign(window.omp, { terminal });
  return {
    terminal,
    onData,
    onExit,
    emitData: (id: string, data: string) => {
      for (const cb of dataCbs) cb({ id, data });
    },
    emitExit: (id: string, code: number | null) => {
      for (const cb of exitCbs) cb({ id, code });
    },
  };
}

beforeEach(() => {
  // Drop the prior subscription so ensureSubscribed re-binds to the fresh mock.
  useTerminalStore.setState({ terminals: {}, _unsub: null });
});

it("registers exactly one onData/onExit subscription, idempotently", () => {
  const h = installTerminalMock();
  const store = useTerminalStore.getState();
  store.ensureSubscribed();
  store.ensureSubscribed();
  expect(h.onData).toHaveBeenCalledTimes(1);
  expect(h.onExit).toHaveBeenCalledTimes(1);
});

it("routes output to the sink for its termId and to no other", () => {
  const h = installTerminalMock();
  const store = useTerminalStore.getState();
  store.ensureSubscribed();

  const idA = uid();
  const idB = uid();
  const a: string[] = [];
  const b: string[] = [];
  store.subscribeData(idA, (d) => a.push(d));
  store.subscribeData(idB, (d) => b.push(d));

  h.emitData(idA, "ls\r\n");
  h.emitData(idB, "pwd\r\n");
  h.emitData(idA, "$ ");

  expect(a).toEqual(["ls\r\n", "$ "]);
  expect(b).toEqual(["pwd\r\n"]);
});

it("buffers output that arrives before a sink attaches, then replays it in order", () => {
  const h = installTerminalMock();
  const store = useTerminalStore.getState();
  store.ensureSubscribed();

  const id = uid();
  // The pty emits its prompt the instant it spawns, before the view subscribes.
  h.emitData(id, "first");
  h.emitData(id, "second");

  const got: string[] = [];
  store.subscribeData(id, (d) => got.push(d));
  expect(got).toEqual(["first", "second"]);

  // After attaching, further output streams live (and is not re-buffered).
  h.emitData(id, "third");
  expect(got).toEqual(["first", "second", "third"]);
});

it("caps detached output buffering to a bounded tail", () => {
  const h = installTerminalMock();
  const store = useTerminalStore.getState();
  store.ensureSubscribed();

  const id = uid();
  h.emitData(id, "old");
  h.emitData(id, "x".repeat(70 * 1024));
  h.emitData(id, "tail");

  const got: string[] = [];
  store.subscribeData(id, (d) => got.push(d));

  const replayed = got.join("");
  expect(replayed).not.toContain("old");
  expect(replayed).toHaveLength(64 * 1024);
  expect(replayed.endsWith("tail")).toBe(true);
});

it("create records the terminal; dispose kills it and drops it", async () => {
  const h = installTerminalMock();
  const id = uid();
  h.terminal.create.mockResolvedValue(
    info(id, { cwd: "/proj", cols: 100, rows: 30 }),
  );
  const store = useTerminalStore.getState();

  const created = await store.create("/proj", 100, 30);
  expect(h.terminal.create).toHaveBeenCalledWith({
    cwd: "/proj",
    cols: 100,
    rows: 30,
  });
  expect(created.id).toBe(id);
  expect(useTerminalStore.getState().terminals[id]).toMatchObject({
    id,
    cwd: "/proj",
    shell: "/bin/zsh",
    exited: false,
  });

  await store.dispose(id);
  expect(h.terminal.kill).toHaveBeenCalledWith(id);
  expect(useTerminalStore.getState().terminals[id]).toBeUndefined();
});

it("marks a terminal exited and notifies its exit listener", async () => {
  const h = installTerminalMock();
  const id = uid();
  h.terminal.create.mockResolvedValue(info(id));
  const store = useTerminalStore.getState();
  await store.create("/work", 80, 24);

  let seen: number | null | "none" = "none";
  store.subscribeExit(id, (code) => {
    seen = code;
  });
  h.emitExit(id, 0);

  expect(seen).toBe(0);
  const entry = useTerminalStore.getState().terminals[id];
  expect(entry?.exited).toBe(true);
  expect(entry?.exitCode).toBe(0);
});

it("fires the exit listener immediately when the pty already exited", async () => {
  const h = installTerminalMock();
  const id = uid();
  h.terminal.create.mockResolvedValue(info(id));
  const store = useTerminalStore.getState();
  await store.create("/work", 80, 24);

  // Exit races ahead of the view's subscribe.
  h.emitExit(id, 137);

  let seen: number | null | "none" = "none";
  store.subscribeExit(id, (code) => {
    seen = code;
  });
  expect(seen).toBe(137);
});

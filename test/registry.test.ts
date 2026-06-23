import { afterAll, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenSessionDescriptor } from "@shared/ipc";
import type { RpcState } from "@shared/rpc";
import {
  type SessionFactory,
  SessionRegistry,
  type SessionStore,
  type SpawnSessionOptions,
} from "../src/main/omp/registry";
import type { OmpRpcSession } from "../src/main/omp/rpc-session";

// Exercises the registry through its injectable seams only: a fake session
// factory (no real omp spawn) and a stub settings store (no real userData
// write). This keeps list/resume/hibernate + persistence assertions hermetic.

const tmpRoot = mkdtempSync(join(tmpdir(), "omp-registry-"));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

// A stand-in for OmpRpcSession: emits frames on demand and records disposal.
class FakeSession extends EventEmitter {
  disposed = false;
  state: RpcState;
  constructor(state: RpcState) {
    super();
    this.state = state;
  }
  whenReady(): Promise<void> {
    return Promise.resolve();
  }
  getState(): Promise<RpcState> {
    return Promise.resolve(this.state);
  }
  dispose(): void {
    this.disposed = true;
    this.removeAllListeners();
  }
}

function makeState(over: Partial<RpcState> = {}): RpcState {
  return {
    model: { provider: "anthropic", id: "claude-opus-4-8" },
    thinkingLevel: "medium",
    isStreaming: false,
    isCompacting: false,
    steeringMode: "all",
    followUpMode: "all",
    interruptMode: "immediate",
    autoCompactionEnabled: true,
    messageCount: 0,
    queuedMessageCount: 0,
    todoPhases: [],
    ...over,
  };
}

function descriptor(
  over: Partial<OpenSessionDescriptor> = {},
): OpenSessionDescriptor {
  return {
    studioSessionId: "studio-1",
    cwd: "/work/resume",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: "2026-01-01T00:00:00.000Z",
    title: null,
    approvalPolicy: { mode: "always-ask", autoApprove: false },
    status: "hibernated",
    ...over,
  };
}

function makeRegistry() {
  const spawns: SpawnSessionOptions[] = [];
  const sessions: FakeSession[] = [];
  const saves: OpenSessionDescriptor[][] = [];
  const createSession: SessionFactory = (opts) => {
    spawns.push(opts);
    const n = spawns.length;
    const fake = new FakeSession(
      makeState({
        sessionFile: `/tmp/sessions/${n}.jsonl`,
        sessionId: `omp-runtime-${n}`,
        sessionName: `Session ${n}`,
      }),
    );
    sessions.push(fake);
    return fake as unknown as OmpRpcSession;
  };
  const store: SessionStore = {
    save: async (descriptors) => {
      // Snapshot at call time — the registry mutates descriptors in place.
      saves.push(structuredClone(descriptors));
    },
  };
  const registry = new SessionRegistry({ createSession, store });
  return { registry, spawns, sessions, saves };
}

test("list reflects created and hibernated sessions", async () => {
  const { registry } = makeRegistry();
  const a = await registry.create({ cwd: "/work/a", model: "anthropic/x" });
  const b = await registry.create({ cwd: "/work/b" });

  let snapshot = registry.list();
  expect(snapshot.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  const sa = snapshot.find((s) => s.id === a.id)!;
  expect(sa.cwd).toBe("/work/a");
  expect(sa.model).toBe("anthropic/x");
  expect(sa.status).toBe("open");
  expect(sa.sessionFile).toBe("/tmp/sessions/1.jsonl");
  expect(typeof sa.lastActiveAt).toBe("string");

  await registry.hibernate(a.id);
  snapshot = registry.list();
  // The descriptor is kept (still listed) but now hibernated; the other stays open.
  expect(snapshot.length).toBe(2);
  expect(snapshot.find((s) => s.id === a.id)!.status).toBe("hibernated");
  expect(snapshot.find((s) => s.id === b.id)!.status).toBe("open");
  // The hibernated child is detached; the live one is still addressable.
  expect(registry.get(a.id)).toBeUndefined();
  expect(registry.get(b.id)).toBeDefined();
});

test("resume passes --resume <sessionFile> when the transcript exists", async () => {
  const { registry, spawns } = makeRegistry();
  const file = join(tmpRoot, "live.jsonl");
  writeFileSync(file, '{"type":"message"}\n');
  const d = descriptor({ sessionFile: file, ompSessionId: "omp-stored" });

  const resumed = await registry.resume(d);
  // studioSessionId is stable across resume.
  expect(resumed.id).toBe("studio-1");
  // The spawn resumed from the JSONL path, not the omp id.
  expect(spawns.at(-1)!.resume).toBe(file);
  expect(spawns.at(-1)!.cwd).toBe("/work/resume");
  expect(spawns.at(-1)!.approvalMode).toBe("always-ask");
  // Now live and open.
  expect(registry.list().find((s) => s.id === "studio-1")!.status).toBe("open");
  expect(registry.get("studio-1")).toBeDefined();
});

test("resume falls back to --resume <ompSessionId> when the file is missing", async () => {
  const { registry, spawns } = makeRegistry();
  const d = descriptor({
    sessionFile: join(tmpRoot, "does-not-exist.jsonl"),
    ompSessionId: "omp-fallback",
  });
  await registry.resume(d);
  expect(spawns.at(-1)!.resume).toBe("omp-fallback");
});

test("resume with a missing transcript and no session id surfaces a clear error", async () => {
  const { registry, spawns } = makeRegistry();
  const d = descriptor({ sessionFile: join(tmpRoot, "gone.jsonl") });
  await expect(registry.resume(d)).rejects.toThrow(/transcript not found/);
  // No fake transcript: nothing was spawned.
  expect(spawns.length).toBe(0);
});

test("hibernate disposes the child but keeps the descriptor", async () => {
  const { registry, sessions } = makeRegistry();
  const c = await registry.create({ cwd: "/work/h" });
  const child = sessions.at(-1)!;
  expect(child.disposed).toBe(false);

  await registry.hibernate(c.id);
  expect(child.disposed).toBe(true);
  const snap = registry.list().find((s) => s.id === c.id)!;
  expect(snap.status).toBe("hibernated");
  expect(registry.descriptors().some((d) => d.studioSessionId === c.id)).toBe(
    true,
  );
  expect(registry.get(c.id)).toBeUndefined();
});

test("descriptors are persisted via the settings store on create, turn-end, and hibernate", async () => {
  const { registry, sessions, saves } = makeRegistry();
  const c = await registry.create({
    cwd: "/work/persist",
    model: "anthropic/persist",
    thinkingLevel: "high",
    approvalPolicy: { mode: "write", autoApprove: true },
  });

  // create persisted a complete descriptor.
  expect(saves.length).toBe(1);
  const created = saves[0]!.find((d) => d.studioSessionId === c.id)!;
  expect(created).toMatchObject({
    studioSessionId: c.id,
    cwd: "/work/persist",
    model: "anthropic/persist",
    thinkingLevel: "high",
    approvalPolicy: { mode: "write", autoApprove: true },
    sessionFile: "/tmp/sessions/1.jsonl",
    ompSessionId: "omp-runtime-1",
    status: "open",
  });
  expect(typeof created.createdAt).toBe("string");
  expect(typeof created.lastActiveAt).toBe("string");
  expect(created.title).toBe("Session 1");

  // A completed turn re-persists.
  const before = saves.length;
  sessions.at(-1)!.emit("frame", { type: "agent_end" });
  await Promise.resolve();
  expect(saves.length).toBe(before + 1);
  expect(saves.at(-1)!.find((d) => d.studioSessionId === c.id)!.status).toBe(
    "open",
  );

  // hibernate persists the hibernated status (descriptor still present).
  await registry.hibernate(c.id);
  expect(saves.at(-1)!.find((d) => d.studioSessionId === c.id)!.status).toBe(
    "hibernated",
  );
});

test("dispose tears the child down and drops the descriptor from persistence", async () => {
  const { registry, sessions, saves } = makeRegistry();
  const c = await registry.create({ cwd: "/work/d" });
  const child = sessions.at(-1)!;

  await registry.dispose(c.id);
  expect(child.disposed).toBe(true);
  expect(registry.get(c.id)).toBeUndefined();
  expect(registry.list()).toHaveLength(0);
  // The latest persisted set no longer contains the disposed descriptor.
  expect(saves.at(-1)!.some((d) => d.studioSessionId === c.id)).toBe(false);
});

test("resume of an already-live session retires the previous child (no orphan)", async () => {
  const { registry, sessions } = makeRegistry();
  const live = await registry.create({ cwd: "/work/dup" });
  const first = sessions.at(-1)!;
  expect(first.disposed).toBe(false);
  expect(registry.list()).toHaveLength(1);

  const file = join(tmpRoot, "dup.jsonl");
  writeFileSync(file, '{"type":"message"}\n');
  await registry.resume(
    descriptor({ studioSessionId: live.id, sessionFile: file }),
  );
  const second = sessions.at(-1)!;

  expect(first).not.toBe(second);
  expect(first.disposed).toBe(true); // old child retired
  expect(second.disposed).toBe(false); // new child is live
  // Still exactly one record for the chat, now pointing at the new child.
  expect(registry.list()).toHaveLength(1);
  expect(registry.get(live.id)).toBe(second as unknown as OmpRpcSession);
});

test("disposeAll retires children but retains descriptors as hibernated", async () => {
  const { registry, sessions } = makeRegistry();
  const a = await registry.create({ cwd: "/work/a" });
  const b = await registry.create({ cwd: "/work/b" });

  registry.disposeAll();

  // Children stopped...
  expect(sessions[0]!.disposed).toBe(true);
  expect(sessions[1]!.disposed).toBe(true);
  // ...but descriptors survive (macOS reopen after window-all-closed), now
  // hibernated and resumable rather than wiped.
  const snap = registry.list();
  expect(snap).toHaveLength(2);
  expect(snap.every((s) => s.status === "hibernated")).toBe(true);
  expect(
    registry
      .descriptors()
      .map((d) => d.studioSessionId)
      .sort(),
  ).toEqual([a.id, b.id].sort());
  expect(registry.get(a.id)).toBeUndefined();
  expect(registry.get(b.id)).toBeUndefined();
});

test("hydrate seeds persisted descriptors and resume preserves the un-resumed set", async () => {
  const { registry, saves } = makeRegistry();
  const file = join(tmpRoot, "hydrate-a.jsonl");
  writeFileSync(file, '{"type":"message"}\n');
  const a = descriptor({
    studioSessionId: "studio-a",
    cwd: "/work/a",
    sessionFile: file,
    // Persisted as "open" from the last run (disposeAll never re-persists), to
    // prove hydrate normalizes a stale status to hibernated on boot.
    status: "open",
  });
  const b = descriptor({ studioSessionId: "studio-b", cwd: "/work/b" });
  const c = descriptor({ studioSessionId: "studio-c", cwd: "/work/c" });

  // Boot seed: a fresh process loads the persisted set into the registry.
  registry.hydrate([a, b, c]);

  // chat:list surfaces all three as hibernated (no live child), regardless of
  // the stale persisted status.
  let listed = registry.descriptors();
  expect(listed.map((d) => d.studioSessionId).sort()).toEqual([
    "studio-a",
    "studio-b",
    "studio-c",
  ]);
  expect(listed.every((d) => d.status === "hibernated")).toBe(true);
  expect(registry.get("studio-a")).toBeUndefined();

  // Resuming one keeps its stable id and marks it open — and crucially does NOT
  // clobber the un-resumed b/c descriptors when it re-persists.
  const resumed = await registry.resume(a);
  expect(resumed.id).toBe("studio-a");
  expect(registry.get("studio-a")).toBeDefined();

  listed = registry.descriptors();
  expect(listed.map((d) => d.studioSessionId).sort()).toEqual([
    "studio-a",
    "studio-b",
    "studio-c",
  ]);
  expect(listed.find((d) => d.studioSessionId === "studio-a")!.status).toBe(
    "open",
  );
  expect(listed.find((d) => d.studioSessionId === "studio-b")!.status).toBe(
    "hibernated",
  );
  expect(listed.find((d) => d.studioSessionId === "studio-c")!.status).toBe(
    "hibernated",
  );

  // The persisted snapshot (settings store) likewise retains all three, so a
  // second restart still lists b and c.
  expect(
    saves
      .at(-1)!
      .map((d) => d.studioSessionId)
      .sort(),
  ).toEqual(["studio-a", "studio-b", "studio-c"]);
});

test("hydrate is idempotent and never overwrites a tracked record", async () => {
  const { registry } = makeRegistry();
  const live = await registry.create({ cwd: "/work/live" });
  // A persisted descriptor for an already-tracked id must not clobber the live
  // record (boot order or a double-seed should be harmless).
  registry.hydrate([
    descriptor({
      studioSessionId: live.id,
      cwd: "/stale",
      status: "hibernated",
    }),
  ]);
  expect(registry.get(live.id)).toBeDefined();
  const d = registry.descriptors().find((x) => x.studioSessionId === live.id)!;
  expect(d.cwd).toBe("/work/live");
  expect(d.status).toBe("open");
});

import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { OpenSessionDescriptor } from "@shared/ipc";
import type { RpcState } from "@shared/rpc";
import {
  type SessionFactory,
  SessionRegistry,
  type SessionStore,
} from "../src/main/omp/registry";
import type { OmpRpcSession } from "../src/main/omp/rpc-session";

// AGE-797: registry crash/self-exit handling and in-flight spawn disposal,
// exercised through the injectable seams (fake session factory + stub store).
//
// The FakeSession mirrors OmpRpcSession's LOAD-BEARING dispose ordering:
// removeAllListeners() BEFORE the child dies, so a deliberate teardown never
// re-enters the registry's "exit" listener. A crash is simulated by emitting
// "exit" directly (as the real child's exit event would).

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

class FakeSession extends EventEmitter {
  disposed = false;
  private readonly ready = Promise.withResolvers<void>();

  constructor(private readonly state: RpcState) {
    super();
    this.ready.resolve();
  }

  whenReady(): Promise<void> {
    return this.ready.promise;
  }
  getState(): Promise<RpcState> {
    return Promise.resolve(this.state);
  }
  // Mirrors OmpRpcSession.dispose: listeners dropped BEFORE the child dies.
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removeAllListeners();
  }
  crash(): void {
    this.emit("exit");
  }
}

// A session stuck in the spawn-to-ready window: whenReady() settles only when
// dispose() rejects it (quit during startup) — matching the real bridge, where
// dispose() rejects a still-pending ready promise with "session disposed".
class HangingSession extends EventEmitter {
  disposed = false;
  private readonly ready = Promise.withResolvers<void>();

  constructor() {
    super();
    this.ready.promise.catch(() => undefined);
  }

  whenReady(): Promise<void> {
    return this.ready.promise;
  }
  getState(): Promise<RpcState> {
    return Promise.resolve(makeState());
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removeAllListeners();
    this.ready.reject(new Error("session disposed"));
  }
}

function harness(factory: SessionFactory) {
  const saves: OpenSessionDescriptor[][] = [];
  const store: SessionStore = {
    save: async (descriptors) => {
      saves.push(structuredClone(descriptors));
    },
  };
  return {
    registry: new SessionRegistry({ createSession: factory, store }),
    saves,
  };
}

test("a self-exited child hibernates its record and persists the fresh state", async () => {
  const sessions: FakeSession[] = [];
  const { registry, saves } = harness(() => {
    const s = new FakeSession(makeState({ sessionFile: "/tmp/s/1.jsonl" }));
    sessions.push(s);
    return s as unknown as OmpRpcSession;
  });

  const { id } = await registry.create({ cwd: "/work/a" });
  expect(registry.list().find((s) => s.id === id)?.status).toBe("open");
  const savesBefore = saves.length;

  // The child dies on its own (crash / external kill / clean self-exit).
  sessions[0]?.crash();
  // persist() is async — one microtask hop settles the void-returned chain.
  await Promise.resolve();

  const snapshot = registry.list().find((s) => s.id === id);
  expect(snapshot?.status).toBe("hibernated");
  // The dead child ref is dropped: chat commands report unknown session
  // instead of throwing into a dead pipe, and get() no longer returns it.
  expect(registry.get(id)).toBeUndefined();
  // The hibernated state was persisted from the fresh record.
  expect(saves.length).toBeGreaterThan(savesBefore);
  expect(saves.at(-1)?.find((d) => d.studioSessionId === id)?.status).toBe(
    "hibernated",
  );
});

test("deliberate hibernate/dispose never re-enters the exit listener (dispose ordering)", async () => {
  const sessions: FakeSession[] = [];
  const { registry, saves } = harness(() => {
    const s = new FakeSession(makeState());
    sessions.push(s);
    return s as unknown as OmpRpcSession;
  });

  const a = await registry.create({ cwd: "/work/a" });
  const b = await registry.create({ cwd: "/work/b" });

  await registry.hibernate(a.id);
  await registry.dispose(b.id);
  const savesAfter = saves.length;

  // dispose() removed listeners BEFORE the (real) child died — emitting exit
  // now models the child's post-kill exit event reaching nobody.
  sessions[0]?.emit("exit");
  sessions[1]?.emit("exit");
  await Promise.resolve();

  // No extra persist happened, and the states are exactly what the deliberate
  // paths set (hibernated / removed), not re-written by the crash listener.
  expect(saves.length).toBe(savesAfter);
  expect(registry.list().find((s) => s.id === a.id)?.status).toBe("hibernated");
  expect(registry.list().find((s) => s.id === b.id)).toBeUndefined();
});

test("a crash of a REPLACED child never touches the successor's record", async () => {
  const sessions: FakeSession[] = [];
  const { registry } = harness(() => {
    const s = new FakeSession(
      makeState({ sessionFile: "/tmp/s/x.jsonl", sessionId: "omp-x" }),
    );
    sessions.push(s);
    return s as unknown as OmpRpcSession;
  });

  const created = await registry.create({ cwd: "/work/a" });
  const descriptor = registry
    .descriptors()
    .find((d) => d.studioSessionId === created.id);
  if (!descriptor) throw new Error("descriptor missing");

  // Resume the same studio id: the registry disposes the old child and
  // replaces the record with the new one.
  await registry.resume(descriptor);
  expect(sessions).toHaveLength(2);
  expect(sessions[0]?.disposed).toBe(true);

  // The OLD child's exit (already disposed — listeners gone) is a no-op; even
  // emitting on it directly must not hibernate the successor.
  sessions[0]?.emit("exit");
  await Promise.resolve();
  expect(registry.list().find((s) => s.id === created.id)?.status).toBe("open");
  expect(registry.get(created.id)).toBeDefined();
});

test("disposeAll reaches a session still in the spawn-to-ready window", async () => {
  const hanging: HangingSession[] = [];
  const { registry } = harness(() => {
    const s = new HangingSession();
    hanging.push(s);
    return s as unknown as OmpRpcSession;
  });

  // create() is now parked awaiting whenReady() — the child is alive but not
  // yet registered.
  const pendingCreate = registry.create({ cwd: "/work/slow" });
  // Let the factory run and startSession park on whenReady().
  await Promise.resolve();
  expect(hanging).toHaveLength(1);
  expect(hanging[0]?.disposed).toBe(false);

  // Quit during startup: disposeAll must reach the in-flight child.
  registry.disposeAll();
  expect(hanging[0]?.disposed).toBe(true);
  // The awaiting create unwinds with the dispose rejection — no hang, no
  // zombie record.
  await expect(pendingCreate).rejects.toThrow(/session disposed/);
  expect(registry.list()).toHaveLength(0);
});

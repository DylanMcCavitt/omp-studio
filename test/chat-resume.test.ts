import { beforeEach, expect, test } from "bun:test";
import type { SessionSummary, SessionTranscript } from "@shared/domain";
import type {
  ChatCreateResult,
  OpenSessionDescriptor,
  StudioSettingsV1,
} from "@shared/ipc";
import type { OmpMessage, RpcState } from "@shared/rpc";
import { useAppStore } from "../src/renderer/src/store/app";
import { useApprovalStore } from "../src/renderer/src/store/approvals";
import { useChatStore } from "../src/renderer/src/store/chat";
import { createSession } from "../src/renderer/src/store/session-reducer";
import { useSettingsStore } from "../src/renderer/src/store/settings";

// D3r: boot restore + resume/hydrate flow, exercised through the chat store with
// a stubbed `window.omp` bridge. We assert the observable contract:
//   - boot lists persisted descriptors as hibernated rows (no auto-spawn);
//   - opening one hydrates the transcript from JSONL FIRST, then merges live
//     state over it (no empty-transcript flash);
//   - a missing JSONL or a failed resume surfaces an honest error row and never
//     leaves a fabricated/zombie transcript behind.

// --- bridge stub -----------------------------------------------------------

interface Handlers {
  list: () => Promise<OpenSessionDescriptor[]>;
  resume: (d: OpenSessionDescriptor) => Promise<ChatCreateResult>;
  dispose: (id: string) => Promise<void>;
  readSession: (path: string) => Promise<SessionTranscript>;
  getMessages: (id: string) => Promise<OmpMessage[]>;
  getState: (id: string) => Promise<RpcState>;
  getSubagents: (id: string) => Promise<unknown[]>;
  getSessionStats: (id: string) => Promise<Record<string, unknown>>;
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

function makeSummary(path: string, sizeBytes = 128): SessionSummary {
  return {
    id: "sum",
    path,
    project: "proj",
    cwd: "/work",
    title: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messageCount: 0,
    sizeBytes,
  };
}

function descriptor(
  over: Partial<OpenSessionDescriptor> = {},
): OpenSessionDescriptor {
  return {
    studioSessionId: "A",
    cwd: "/work/a",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: "2026-01-01T00:00:00.000Z",
    title: null,
    approvalPolicy: { mode: "always-ask", autoApprove: false },
    status: "hibernated",
    ...over,
  };
}

function settings(open: OpenSessionDescriptor[]): StudioSettingsV1 {
  return {
    version: 1,
    theme: "system",
    defaultProject: null,
    defaultModel: null,
    defaultThinkingLevel: "medium",
    defaultApprovalMode: "always-ask",
    defaultAutoApprove: false,
    liveSessionLimit: 4,
    recentProjects: [],
    openSessions: open,
  };
}

let h: Handlers;
let calls: { readSession: string[]; resume: string[]; dispose: string[] };

function defaultHandlers(): Handlers {
  return {
    list: async () => [],
    resume: async (d) => ({ sessionId: d.studioSessionId, state: makeState() }),
    dispose: async () => {},
    readSession: async (path) => ({ summary: makeSummary(path), messages: [] }),
    getMessages: async () => [],
    getState: async () => makeState(),
    getSubagents: async () => [],
    getSessionStats: async () => ({}),
  };
}

// One window stub for the whole file; each method delegates to the mutable `h`
// so a test can swap behavior without re-wiring the bridge.
(globalThis as unknown as { window: unknown }).window = {
  omp: {
    readSession: (path: string) => h.readSession(path),
    chat: {
      list: () => h.list(),
      resume: (d: OpenSessionDescriptor) => h.resume(d),
      dispose: (id: string) => h.dispose(id),
      getMessages: (id: string) => h.getMessages(id),
      getState: (id: string) => h.getState(id),
      getSubagents: (id: string) => h.getSubagents(id),
      getSessionStats: (id: string) => h.getSessionStats(id),
      onEvent: () => () => {},
      onLifecycle: () => () => {},
      onUiRequest: () => () => {},
    },
  },
};

/** Drain pending microtasks (no real timers) so awaited stub promises settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  h = defaultHandlers();
  calls = { readSession: [], resume: [], dispose: [] };
  const unsub = useChatStore.getState()._unsub;
  if (unsub) unsub();
  useChatStore.setState({
    openSessions: {},
    hibernatedSessions: {},
    activeSessionId: null,
    creating: false,
    createError: undefined,
    _unsub: null,
  });
  useSettingsStore.setState({ settings: settings([]), loading: false });
  useApprovalStore.setState({ policies: {}, rulesBySession: {} });
  useAppStore.setState({ route: "dashboard" });
});

// --- boot restore ----------------------------------------------------------

test("loadOpenSessions unions chat.list + settings.openSessions as hibernated rows (no spawn)", async () => {
  h.list = async () => [descriptor({ studioSessionId: "A", cwd: "/a" })];
  useSettingsStore.setState({
    settings: settings([
      descriptor({ studioSessionId: "B", cwd: "/b" }),
      // overlapping id: the registry (chat.list) entry must win.
      descriptor({ studioSessionId: "A", cwd: "/a-stale" }),
    ]),
    loading: false,
  });

  await useChatStore.getState().loadOpenSessions();

  const s = useChatStore.getState();
  expect(Object.keys(s.hibernatedSessions).sort()).toEqual(["A", "B"]);
  expect(s.hibernatedSessions.A?.descriptor.cwd).toBe("/a");
  // No child was auto-spawned on boot.
  expect(s.openSessions).toEqual({});
});

test("loadOpenSessions does not re-add a session that is already live", async () => {
  useChatStore.setState({ openSessions: { A: createSession("A") } });
  h.list = async () => [descriptor({ studioSessionId: "A" })];

  await useChatStore.getState().loadOpenSessions();

  expect(useChatStore.getState().hibernatedSessions.A).toBeUndefined();
});

test("loadOpenSessions falls back to settings.openSessions when chat.list throws", async () => {
  h.list = async () => {
    throw new Error("registry unavailable");
  };
  useSettingsStore.setState({
    settings: settings([descriptor({ studioSessionId: "B", cwd: "/b" })]),
    loading: false,
  });

  await useChatStore.getState().loadOpenSessions();

  expect(Object.keys(useChatStore.getState().hibernatedSessions)).toEqual([
    "B",
  ]);
});

// --- resume / hydrate ------------------------------------------------------

test("resumeSession hydrates from JSONL first, then merges live state (no flash)", async () => {
  const A = descriptor({
    studioSessionId: "A",
    cwd: "/work/a",
    sessionFile: "/sessions/a.jsonl",
    title: "Chat A",
    approvalPolicy: { mode: "write", autoApprove: false },
  });
  useChatStore.setState({ hibernatedSessions: { A: { descriptor: A } } });

  const hydrated: OmpMessage[] = [
    { role: "user", content: "old question", timestamp: 1 },
  ];
  const live: OmpMessage[] = [
    { role: "user", content: "old question", timestamp: 1 },
    {
      role: "assistant",
      content: [{ type: "text", text: "resumed" }],
      timestamp: 2,
    },
  ];
  h.readSession = async (path) => {
    calls.readSession.push(path);
    return { summary: makeSummary(path), messages: hydrated };
  };
  const deferred = Promise.withResolvers<ChatCreateResult>();
  h.resume = (d) => {
    calls.resume.push(d.studioSessionId);
    return deferred.promise;
  };
  h.getMessages = async () => live;

  const p = useChatStore.getState().resumeSession("A");
  await flush();

  // Optimistic phase: history is visible while the child spawns.
  let s = useChatStore.getState();
  expect(calls.readSession).toEqual(["/sessions/a.jsonl"]);
  expect(calls.resume).toEqual(["A"]);
  expect(s.hibernatedSessions.A).toBeUndefined();
  expect(s.openSessions.A?.status).toBe("spawning");
  expect(s.openSessions.A?.messages).toEqual(hydrated);
  expect(s.activeSessionId).toBe("A");
  expect(useAppStore.getState().route).toBe("chat");
  // Approval policy mirrored from the descriptor (parity with create()).
  expect(useApprovalStore.getState().policies.A).toEqual({
    mode: "write",
    autoApprove: false,
  });

  // Child ready: live get_messages replaces the hydrated transcript in one step.
  deferred.resolve({
    sessionId: "A",
    state: makeState({ sessionName: "Chat A" }),
  });
  await p;

  s = useChatStore.getState();
  expect(s.openSessions.A?.messages).toEqual(live);
  expect(s.openSessions.A?.status).toBe("idle");
  expect(s.hibernatedSessions.A).toBeUndefined();
});

test("resumeSession with no sessionFile skips hydration but still resumes", async () => {
  const N = descriptor({ studioSessionId: "N", sessionFile: undefined });
  useChatStore.setState({ hibernatedSessions: { N: { descriptor: N } } });
  const live: OmpMessage[] = [{ role: "user", content: "hi", timestamp: 1 }];
  h.readSession = async (path) => {
    calls.readSession.push(path);
    return { summary: makeSummary(path), messages: [] };
  };
  h.getMessages = async () => live;

  await useChatStore.getState().resumeSession("N");

  expect(calls.readSession).toEqual([]);
  expect(useChatStore.getState().openSessions.N?.messages).toEqual(live);
  expect(useChatStore.getState().hibernatedSessions.N).toBeUndefined();
});

test("a failed resume surfaces an error row and leaves no zombie transcript", async () => {
  const A = descriptor({
    studioSessionId: "A",
    sessionFile: "/sessions/a.jsonl",
  });
  useChatStore.setState({ hibernatedSessions: { A: { descriptor: A } } });
  h.readSession = async (path) => ({
    summary: makeSummary(path),
    messages: [{ role: "user", content: "old", timestamp: 1 }],
  });
  h.resume = async () => {
    throw new Error("spawn failed");
  };

  await useChatStore.getState().resumeSession("A");

  const s = useChatStore.getState();
  // No live pane left behind for a child that never came up.
  expect(s.openSessions.A).toBeUndefined();
  expect(s.activeSessionId).toBeNull();
  expect(s.hibernatedSessions.A?.error).toBe("spawn failed");
  expect(s.hibernatedSessions.A?.resuming).toBeFalsy();
});

test("a missing JSONL (empty placeholder) surfaces an error row WITHOUT spawning", async () => {
  const A = descriptor({
    studioSessionId: "A",
    sessionFile: "/sessions/gone.jsonl",
  });
  useChatStore.setState({ hibernatedSessions: { A: { descriptor: A } } });
  // main's readSession degrades to an EMPTY PLACEHOLDER (sizeBytes 0, no
  // messages) for a deleted file instead of throwing — the resume flow must
  // detect that and refuse to spawn a fabricated/empty session.
  h.readSession = async (path) => ({
    summary: makeSummary(path, 0),
    messages: [],
  });
  let resumeCalled = false;
  h.resume = async (d) => {
    resumeCalled = true;
    return { sessionId: d.studioSessionId, state: makeState() };
  };

  await useChatStore.getState().resumeSession("A");

  const s = useChatStore.getState();
  // No fabricated transcript: nothing went live and no spawn was attempted.
  expect(resumeCalled).toBe(false);
  expect(s.openSessions.A).toBeUndefined();
  expect(s.hibernatedSessions.A?.error).toMatch(/transcript not found/i);
  expect(s.hibernatedSessions.A?.resuming).toBeFalsy();
});

test("a readSession throw surfaces an error row WITHOUT spawning", async () => {
  const A = descriptor({
    studioSessionId: "A",
    sessionFile: "/sessions/locked.jsonl",
  });
  useChatStore.setState({ hibernatedSessions: { A: { descriptor: A } } });
  h.readSession = async () => {
    throw new Error("EACCES: permission denied");
  };
  let resumeCalled = false;
  h.resume = async (d) => {
    resumeCalled = true;
    return { sessionId: d.studioSessionId, state: makeState() };
  };

  await useChatStore.getState().resumeSession("A");

  const s = useChatStore.getState();
  expect(resumeCalled).toBe(false);
  expect(s.openSessions.A).toBeUndefined();
  expect(s.hibernatedSessions.A?.error).toMatch(/EACCES/);
});

// --- remove ----------------------------------------------------------------

test("removeHibernated drops the row and disposes the descriptor permanently", async () => {
  const A = descriptor({ studioSessionId: "A", error: undefined });
  useChatStore.setState({
    hibernatedSessions: { A: { descriptor: A, error: "boom" } },
  });
  h.dispose = async (id) => {
    calls.dispose.push(id);
  };

  await useChatStore.getState().removeHibernated("A");

  expect(useChatStore.getState().hibernatedSessions.A).toBeUndefined();
  expect(calls.dispose).toEqual(["A"]);
});

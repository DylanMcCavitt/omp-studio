import { afterAll, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow, IpcMain } from "electron";
import { registerChatIpc } from "../src/main/ipc/chat";
import { SessionRegistry } from "../src/main/omp/registry";
import { OmpRpcSession } from "../src/main/omp/rpc-session";
import type {
  ChatCreateOptions,
  ChatUiRequestEvent,
  OpenSessionDescriptor,
} from "../src/shared/ipc";
import { CH } from "../src/shared/ipc";
import type {
  AvailableSlashCommand,
  ExtensionUiRequest,
  ExtensionUiResponse,
  RpcState,
  SubagentMessagesResult,
  SubagentSubscriptionLevel,
} from "../src/shared/rpc";

// ---------------------------------------------------------------------------
// chat IPC wiring (C2): ui-request forwarding, uiRespond routing, and
// approval-policy threading. These exercise the real registerChatIpc against
// stubbed electron/registry/session seams — no real omp child is spawned.
// ---------------------------------------------------------------------------

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

function makeIpcMain(): {
  ipcMain: IpcMain;
  invoke: (channel: string, ...args: unknown[]) => unknown;
} {
  const handlers = new Map<string, IpcHandler>();
  const ipcMain = {
    handle(channel: string, listener: IpcHandler) {
      handlers.set(channel, listener);
    },
  };
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`no handler registered for ${channel}`);
    return handler({}, ...args);
  };
  return { ipcMain: ipcMain as unknown as IpcMain, invoke };
}

// Stand-in for a live OmpRpcSession: an EventEmitter that records the calls the
// chat IPC handlers route to it (respondUi + the feature-4/6b methods).
class FakeSession extends EventEmitter {
  readonly respondUiCalls: Array<{
    requestId: string;
    response: ExtensionUiResponse;
  }> = [];
  readonly subagentMessagesCalls: Array<{
    subagentId?: string;
    sessionFile?: string;
    fromByte?: number;
  }> = [];
  readonly subscriptionCalls: SubagentSubscriptionLevel[] = [];
  availableCommandsCalls = 0;
  availableCommands: AvailableSlashCommand[] = [
    { name: "compact", description: "Compact the session", source: "builtin" },
    { name: "review", description: "Run a review", source: "skill" },
  ];

  respondUi(requestId: string, response: ExtensionUiResponse): void {
    this.respondUiCalls.push({ requestId, response });
  }

  async getSubagentMessages(sel: {
    subagentId?: string;
    sessionFile?: string;
    fromByte?: number;
  }): Promise<SubagentMessagesResult> {
    this.subagentMessagesCalls.push(sel);
    return {
      sessionFile: sel.sessionFile ?? "",
      fromByte: sel.fromByte ?? 0,
      nextByte: 0,
      reset: false,
      entries: [],
      messages: [],
    };
  }

  async setSubagentSubscription(
    level: SubagentSubscriptionLevel,
  ): Promise<void> {
    this.subscriptionCalls.push(level);
  }

  async getAvailableCommands(): Promise<AvailableSlashCommand[]> {
    this.availableCommandsCalls += 1;
    return this.availableCommands;
  }
}

function makeRegistry(): {
  registry: SessionRegistry;
  createCalls: ChatCreateOptions[];
  resumeCalls: OpenSessionDescriptor[];
  sessions: Map<string, FakeSession>;
} {
  const createCalls: ChatCreateOptions[] = [];
  const resumeCalls: OpenSessionDescriptor[] = [];
  const sessions = new Map<string, FakeSession>();
  const registry = {
    async create(opts: ChatCreateOptions) {
      createCalls.push(opts);
      const id = "sess-1";
      const session = new FakeSession();
      sessions.set(id, session);
      return { id, session, state: {} as RpcState };
    },
    async resume(descriptor: OpenSessionDescriptor) {
      resumeCalls.push(descriptor);
      const id = descriptor.studioSessionId;
      const session = new FakeSession();
      sessions.set(id, session);
      return { id, session, state: {} as RpcState };
    },
    get(id: string) {
      return sessions.get(id);
    },
  };
  return {
    registry: registry as unknown as SessionRegistry,
    createCalls,
    resumeCalls,
    sessions,
  };
}

function makeWindow(): {
  win: BrowserWindow;
  sends: Array<{ channel: string; payload: unknown }>;
} {
  const sends: Array<{ channel: string; payload: unknown }> = [];
  const win = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send(channel: string, payload: unknown) {
        sends.push({ channel, payload });
      },
    },
  };
  return { win: win as unknown as BrowserWindow, sends };
}

test("a session 'ui-request' forwards to the renderer with the right shape", async () => {
  const { ipcMain, invoke } = makeIpcMain();
  const { registry, sessions } = makeRegistry();
  const { win, sends } = makeWindow();
  registerChatIpc(ipcMain, registry, () => win);

  const created = (await invoke(CH.chatCreate, {
    cwd: "/tmp/x",
  } satisfies ChatCreateOptions)) as { sessionId: string };
  const session = sessions.get(created.sessionId);
  expect(session).toBeDefined();

  const request: ExtensionUiRequest = {
    type: "extension_ui_request",
    id: "ui-1",
    method: "confirm",
    message: "Proceed?",
  };
  session?.emit("ui-request", { request, responseRequired: true });

  const uiSends = sends.filter((s) => s.channel === CH.evtUiRequest);
  expect(uiSends).toHaveLength(1);
  expect(uiSends[0]?.payload).toEqual({
    sessionId: created.sessionId,
    request,
    responseRequired: true,
  } satisfies ChatUiRequestEvent);
});

test("open_url forwards to the renderer as a non-blocking hint (not auto-opened in main)", async () => {
  const { ipcMain, invoke } = makeIpcMain();
  const { registry, sessions } = makeRegistry();
  const { win, sends } = makeWindow();
  registerChatIpc(ipcMain, registry, () => win);

  await invoke(CH.chatCreate, { cwd: "/tmp/x" } satisfies ChatCreateOptions);
  const session = sessions.get("sess-1");

  const request: ExtensionUiRequest = {
    type: "extension_ui_request",
    id: "ui-open",
    method: "open_url",
    url: "https://example.com",
  };
  session?.emit("ui-request", { request, responseRequired: false });

  const uiSends = sends.filter((s) => s.channel === CH.evtUiRequest);
  expect(uiSends).toHaveLength(1);
  const payload = uiSends[0]?.payload as ChatUiRequestEvent;
  expect(payload.responseRequired).toBe(false);
  expect(payload.request.method).toBe("open_url");
  expect(payload.request.url).toBe("https://example.com");
});

test("CH.chatRespondUi routes the response to the originating session", async () => {
  const { ipcMain, invoke } = makeIpcMain();
  const { registry, sessions } = makeRegistry();
  const { win } = makeWindow();
  registerChatIpc(ipcMain, registry, () => win);

  await invoke(CH.chatCreate, { cwd: "/tmp/x" } satisfies ChatCreateOptions);
  const session = sessions.get("sess-1");

  const response: ExtensionUiResponse = { confirmed: true };
  await invoke(CH.chatRespondUi, {
    sessionId: "sess-1",
    requestId: "ui-1",
    response,
  });

  expect(session?.respondUiCalls).toEqual([{ requestId: "ui-1", response }]);
});

test("CH.chatRespondUi is a safe no-op when the session is gone", async () => {
  const { ipcMain, invoke } = makeIpcMain();
  const { registry } = makeRegistry();
  const { win } = makeWindow();
  registerChatIpc(ipcMain, registry, () => win);

  // No session was ever created — must resolve, never throw across IPC.
  await expect(
    invoke(CH.chatRespondUi, {
      sessionId: "ghost",
      requestId: "x",
      response: { cancelled: true },
    }) as Promise<unknown>,
  ).resolves.toBeUndefined();
});

test("approvalPolicy flows into registry.create", async () => {
  const { ipcMain, invoke } = makeIpcMain();
  const { registry, createCalls } = makeRegistry();
  const { win } = makeWindow();
  registerChatIpc(ipcMain, registry, () => win);

  const opts: ChatCreateOptions = {
    cwd: "/tmp/x",
    approvalPolicy: { mode: "write", autoApprove: true },
  };
  await invoke(CH.chatCreate, opts);

  expect(createCalls).toHaveLength(1);
  expect(createCalls[0]?.approvalPolicy).toEqual({
    mode: "write",
    autoApprove: true,
  });
});

test("chat:create forwards only known fields to registry.create (drops a renderer-supplied binary override)", async () => {
  const { ipcMain, invoke } = makeIpcMain();
  const { registry, createCalls } = makeRegistry();
  const { win } = makeWindow();
  registerChatIpc(ipcMain, registry, () => win);

  // A malicious renderer payload carrying an extra `binary` (an arbitrary
  // executable) plus an unknown key — neither may reach registry.create.
  const malicious = {
    cwd: "/tmp/x",
    approvalPolicy: { mode: "write", autoApprove: true },
    binary: "/evil/payload",
    bogus: 1,
  } as unknown as ChatCreateOptions;
  await invoke(CH.chatCreate, malicious);

  const seen = createCalls[0] as Record<string, unknown>;
  expect(seen).not.toHaveProperty("binary");
  expect(seen).not.toHaveProperty("bogus");
  expect(Object.keys(seen).sort()).toEqual([
    "approvalPolicy",
    "cwd",
    "model",
    "thinkingLevel",
  ]);
  expect(seen.cwd).toBe("/tmp/x");
  expect(seen.approvalPolicy).toEqual({ mode: "write", autoApprove: true });
});

// ---------------------------------------------------------------------------
// Feature 4: subagent drill-in handler wiring + sessionFile path containment.
// These exercise registerChatIpc against the stubbed seams (no omp child); the
// FakeSession records exactly what each handler forwards to the session.
//
// A real temp agent dir backs sessionsDir() so containment is checked against
// an actual on-disk root: the guard canonicalizes via realpathSync, so a
// symlink planted under the root that points outside it must be rejected.
// ---------------------------------------------------------------------------

const agentRoot = mkdtempSync(join(tmpdir(), "omp-studio-agent-"));
mkdirSync(join(agentRoot, "sessions"), { recursive: true });
const sessionsRoot = realpathSync(join(agentRoot, "sessions"));
const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentRoot;
afterAll(() => {
  if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
  rmSync(agentRoot, { recursive: true, force: true });
});

async function wiredSession(): Promise<{
  invoke: (channel: string, ...args: unknown[]) => unknown;
  session: FakeSession;
  sessionId: string;
}> {
  const { ipcMain, invoke } = makeIpcMain();
  const { registry, sessions } = makeRegistry();
  const { win } = makeWindow();
  registerChatIpc(ipcMain, registry, () => win);
  const created = (await invoke(CH.chatCreate, {
    cwd: "/tmp/x",
  } satisfies ChatCreateOptions)) as { sessionId: string };
  const session = sessions.get(created.sessionId);
  if (!session) throw new Error("session not created");
  return { invoke, session, sessionId: created.sessionId };
}

test("chat:getSubagentMessages forwards a normalized, contained sessionFile to the session", async () => {
  const { invoke, session, sessionId } = await wiredSession();
  const file = join(sessionsRoot, "proj-abc", "agent.jsonl");
  const result = (await invoke(CH.chatGetSubagentMessages, sessionId, {
    sessionFile: file,
    fromByte: 10,
  })) as SubagentMessagesResult;
  expect(session.subagentMessagesCalls).toHaveLength(1);
  expect(session.subagentMessagesCalls[0]?.sessionFile).toBe(file);
  expect(session.subagentMessagesCalls[0]?.fromByte).toBe(10);
  expect(result.sessionFile).toBe(file);
});

test("chat:getSubagentMessages passes a subagentId selector through without a path check", async () => {
  const { invoke, session, sessionId } = await wiredSession();
  await invoke(CH.chatGetSubagentMessages, sessionId, {
    subagentId: "child-1",
  });
  expect(session.subagentMessagesCalls).toEqual([{ subagentId: "child-1" }]);
});

test("chat:getSubagentMessages rejects a sessionFile that escapes sessionsDir()", async () => {
  const { invoke, session, sessionId } = await wiredSession();
  const traversal = join(sessionsRoot, "..", "evil.jsonl");
  await expect(
    invoke(CH.chatGetSubagentMessages, sessionId, { sessionFile: traversal }),
  ).rejects.toThrow(/escapes the sessions directory/);
  await expect(
    invoke(CH.chatGetSubagentMessages, sessionId, {
      sessionFile: "/etc/passwd",
    }),
  ).rejects.toThrow(/escapes the sessions directory/);
  // A rejected path never reaches the child reader.
  expect(session.subagentMessagesCalls).toHaveLength(0);
});

test("chat:getSubagentMessages rejects a symlink under sessionsDir() pointing outside (canonical containment)", async () => {
  const { invoke, session, sessionId } = await wiredSession();
  const outsideDir = join(agentRoot, "outside");
  mkdirSync(outsideDir, { recursive: true });
  const secret = join(outsideDir, "secret.jsonl");
  writeFileSync(secret, "{}\n");
  // link.jsonl lives lexically INSIDE the sessions root but resolves outside it;
  // a purely lexical resolve()+relative() check would wrongly accept it.
  const link = join(sessionsRoot, "link.jsonl");
  symlinkSync(secret, link);
  await expect(
    invoke(CH.chatGetSubagentMessages, sessionId, { sessionFile: link }),
  ).rejects.toThrow(/escapes the sessions directory/);
  expect(session.subagentMessagesCalls).toHaveLength(0);
});

test("chat:setSubagentSubscription forwards the level to the session", async () => {
  const { invoke, session, sessionId } = await wiredSession();
  await invoke(CH.chatSetSubagentSubscription, sessionId, "progress");
  expect(session.subscriptionCalls).toEqual(["progress"]);
});

test("chat:getSubagentMessages throws for an unknown session id", async () => {
  const { invoke } = await wiredSession();
  await expect(
    invoke(CH.chatGetSubagentMessages, "no-such-session", {
      subagentId: "x",
    }),
  ).rejects.toThrow(/unknown session/);
});

// ---------------------------------------------------------------------------
// Feature 6b: per-session commands palette snapshot handler wiring. Per-session
// only — there is no global commands channel. The FakeSession records the call
// and returns a fixed palette; the handler must resolve the session by id and
// return the list verbatim.
// ---------------------------------------------------------------------------

test("chat:getAvailableCommands resolves the session by id and returns the palette", async () => {
  const { invoke, session, sessionId } = await wiredSession();
  const commands = (await invoke(
    CH.chatGetAvailableCommands,
    sessionId,
  )) as AvailableSlashCommand[];
  expect(session.availableCommandsCalls).toBe(1);
  expect(commands).toEqual(session.availableCommands);
});

test("chat:getAvailableCommands throws for an unknown session id", async () => {
  const { invoke } = await wiredSession();
  await expect(
    invoke(CH.chatGetAvailableCommands, "no-such-session"),
  ).rejects.toThrow(/unknown session/);
});

// ---------------------------------------------------------------------------
// approvalPolicy -> rpc-ui spawn flags. Two layers, tested hermetically:
//   1. SessionRegistry maps ApprovalPolicy -> {approvalMode, autoApprove} via an
//      injected session factory (no child spawned, no renderer-reachable sink).
//   2. OmpRpcSession turns those into argv flags — driven through a tiny fake
//      omp passed by `binary` (never via the global OMP_BINARY/ompBinary cache,
//      which Bun shares across test files) that records its argv to argv.json.
// ---------------------------------------------------------------------------

const fakeDir = mkdtempSync(join(tmpdir(), "omp-studio-chatipc-"));
const fakeOmp = join(fakeDir, "fake-omp-argv.mjs");
writeFileSync(
  fakeOmp,
  `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
try {
  writeFileSync(join(process.cwd(), "argv.json"), JSON.stringify(process.argv.slice(2)));
} catch {}
process.stdout.write(JSON.stringify({ type: "ready" }) + "\\n");
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let nl;
  while ((nl = buf.indexOf("\\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg && typeof msg.id === "string") {
      process.stdout.write(JSON.stringify({ type: "response", id: msg.id, success: true, data: {} }) + "\\n");
    }
  }
});
process.stdin.on("end", () => process.exit(0));
`,
);
chmodSync(fakeOmp, 0o755);
afterAll(() => rmSync(fakeDir, { recursive: true, force: true }));

test("SessionRegistry maps approvalPolicy into the session spawn opts (and defaults safely)", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const fakeSession = {
    whenReady: async () => undefined,
    getState: async () => ({}) as RpcState,
    dispose: () => undefined,
    on: () => undefined,
  } as unknown as OmpRpcSession;
  const registry = new SessionRegistry({
    createSession: (opts) => {
      calls.push(opts as unknown as Record<string, unknown>);
      return fakeSession;
    },
    store: { save: async () => undefined },
  });

  await registry.create({
    cwd: "/tmp/x",
    approvalPolicy: { mode: "write", autoApprove: true },
  });
  await registry.create({ cwd: "/tmp/y" });

  expect(calls[0]).toMatchObject({
    cwd: "/tmp/x",
    approvalMode: "write",
    autoApprove: true,
  });
  // An omitted policy defaults to the safest spawn config.
  expect(calls[1]).toMatchObject({
    approvalMode: "always-ask",
    autoApprove: false,
  });
});

test("OmpRpcSession turns an explicit approval policy into rpc-ui spawn flags", async () => {
  const cwd = mkdtempSync(join(fakeDir, "wt-"));
  const session = new OmpRpcSession({
    cwd,
    binary: fakeOmp,
    approvalMode: "write",
    autoApprove: true,
  });
  try {
    await session.whenReady();
    const argv = JSON.parse(
      readFileSync(join(cwd, "argv.json"), "utf8"),
    ) as string[];
    expect(argv).toContain("--mode");
    expect(argv[argv.indexOf("--mode") + 1]).toBe("rpc-ui");
    expect(argv[argv.indexOf("--approval-mode") + 1]).toBe("write");
    expect(argv).toContain("--auto-approve");
  } finally {
    session.dispose();
  }
}, 15000);

test("OmpRpcSession defaults to always-ask spawn flags with no --auto-approve", async () => {
  const cwd = mkdtempSync(join(fakeDir, "wt-"));
  const session = new OmpRpcSession({ cwd, binary: fakeOmp });
  try {
    await session.whenReady();
    const argv = JSON.parse(
      readFileSync(join(cwd, "argv.json"), "utf8"),
    ) as string[];
    expect(argv[argv.indexOf("--approval-mode") + 1]).toBe("always-ask");
    expect(argv).not.toContain("--auto-approve");
  } finally {
    session.dispose();
  }
}, 15000);

// ---------------------------------------------------------------------------
// AGE-798: chat:resume descriptor hardening. The renderer-supplied descriptor
// is rebuilt from known fields only, and its sessionFile is contained under
// sessionsDir() BEFORE it can drive an `omp --resume` spawn.
// ---------------------------------------------------------------------------

function resumeDescriptor(
  over: Partial<OpenSessionDescriptor> & Record<string, unknown> = {},
): OpenSessionDescriptor {
  return {
    studioSessionId: "resume-1",
    cwd: "/work/a",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: "2026-01-01T00:00:00.000Z",
    title: null,
    approvalPolicy: { mode: "always-ask", autoApprove: false },
    status: "hibernated",
    ...over,
  } as OpenSessionDescriptor;
}

test("chat:resume rejects a descriptor whose sessionFile escapes sessionsDir()", async () => {
  const { ipcMain, invoke } = makeIpcMain();
  const { registry, resumeCalls } = makeRegistry();
  const { win } = makeWindow();
  registerChatIpc(ipcMain, registry, () => win);

  for (const sessionFile of [
    "/etc/passwd",
    join(sessionsRoot, "..", "evil.jsonl"),
  ]) {
    await expect(
      invoke(
        CH.chatResume,
        resumeDescriptor({ sessionFile }),
      ) as Promise<unknown>,
    ).rejects.toThrow(/escapes the sessions directory/);
  }
  // A rejected descriptor never reaches the registry (no spawn attempt).
  expect(resumeCalls).toHaveLength(0);
});

test("chat:resume forwards only known descriptor fields with a contained sessionFile", async () => {
  const { ipcMain, invoke } = makeIpcMain();
  const { registry, resumeCalls } = makeRegistry();
  const { win } = makeWindow();
  registerChatIpc(ipcMain, registry, () => win);

  const file = join(sessionsRoot, "proj", "resume.jsonl");
  await invoke(
    CH.chatResume,
    resumeDescriptor({
      sessionFile: file,
      model: "anthropic/claude-opus-4-8",
      // Hostile extras that must not survive sanitization:
      binary: "/tmp/evil-omp",
      extraFlag: "--yolo",
    }),
  );

  expect(resumeCalls).toHaveLength(1);
  const forwarded = resumeCalls[0] as OpenSessionDescriptor &
    Record<string, unknown>;
  expect(forwarded.sessionFile).toBe(file);
  expect(forwarded.model).toBe("anthropic/claude-opus-4-8");
  expect(forwarded["binary"]).toBeUndefined();
  expect(forwarded["extraFlag"]).toBeUndefined();
  expect(Object.keys(forwarded).sort()).toEqual([
    "approvalPolicy",
    "createdAt",
    "cwd",
    "lastActiveAt",
    "model",
    "sessionFile",
    "status",
    "studioSessionId",
    "title",
  ]);
});

test("chat:resume accepts a descriptor without a sessionFile (omp-id resume)", async () => {
  const { ipcMain, invoke } = makeIpcMain();
  const { registry, resumeCalls } = makeRegistry();
  const { win } = makeWindow();
  registerChatIpc(ipcMain, registry, () => win);

  await invoke(CH.chatResume, resumeDescriptor({ ompSessionId: "omp-abc123" }));
  expect(resumeCalls).toHaveLength(1);
  expect(resumeCalls[0]?.ompSessionId).toBe("omp-abc123");
  expect(resumeCalls[0]?.sessionFile).toBeUndefined();
});

test("chat:resume rejects a path-shaped ompSessionId (no --resume smuggling through the id arm)", async () => {
  const { ipcMain, invoke } = makeIpcMain();
  const { registry, resumeCalls } = makeRegistry();
  const { win } = makeWindow();
  registerChatIpc(ipcMain, registry, () => win);

  for (const ompSessionId of [
    "/etc/passwd",
    "../../../etc/passwd",
    "..\\..\\secrets",
    ".hidden",
    "",
  ]) {
    await expect(
      invoke(
        CH.chatResume,
        resumeDescriptor({ ompSessionId }),
      ) as Promise<unknown>,
    ).rejects.toThrow(/not a valid omp session id/);
  }
  expect(resumeCalls).toHaveLength(0);
});

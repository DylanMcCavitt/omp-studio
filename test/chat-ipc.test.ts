import { afterAll, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow, IpcMain } from "electron";
import { registerChatIpc } from "../src/main/ipc/chat";
import { SessionRegistry } from "../src/main/omp/registry";
import type { ChatCreateOptions, ChatUiRequestEvent } from "../src/shared/ipc";
import { CH } from "../src/shared/ipc";
import type {
  ExtensionUiRequest,
  ExtensionUiResponse,
  RpcState,
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

// Stand-in for a live OmpRpcSession: an EventEmitter that records respondUi.
class FakeSession extends EventEmitter {
  readonly respondUiCalls: Array<{
    requestId: string;
    response: ExtensionUiResponse;
  }> = [];

  respondUi(requestId: string, response: ExtensionUiResponse): void {
    this.respondUiCalls.push({ requestId, response });
  }
}

function makeRegistry(): {
  registry: SessionRegistry;
  createCalls: ChatCreateOptions[];
  sessions: Map<string, FakeSession>;
} {
  const createCalls: ChatCreateOptions[] = [];
  const sessions = new Map<string, FakeSession>();
  const registry = {
    async create(opts: ChatCreateOptions) {
      createCalls.push(opts);
      const id = "sess-1";
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
    sessions,
  };
}

function makeWindow(): {
  win: BrowserWindow;
  sends: Array<{ channel: string; payload: unknown }>;
} {
  const sends: Array<{ channel: string; payload: unknown }> = [];
  const win = {
    webContents: {
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

// ---------------------------------------------------------------------------
// registry.create -> rpc-ui spawn flags. A tiny fake omp records its argv to
// `argv.json` in its cwd, then speaks just enough protocol (ready + response to
// any id'd command) for registry.create to resolve.
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

test("explicit approvalPolicy becomes rpc-ui spawn flags via registry.create", async () => {
  const registry = new SessionRegistry();
  const cwd = mkdtempSync(join(fakeDir, "wt-"));
  const { id } = await registry.create({
    cwd,
    binary: fakeOmp,
    approvalPolicy: { mode: "write", autoApprove: true },
  });
  try {
    const argv = JSON.parse(
      readFileSync(join(cwd, "argv.json"), "utf8"),
    ) as string[];
    expect(argv).toContain("--mode");
    expect(argv[argv.indexOf("--mode") + 1]).toBe("rpc-ui");
    expect(argv).toContain("--approval-mode");
    expect(argv[argv.indexOf("--approval-mode") + 1]).toBe("write");
    expect(argv).toContain("--auto-approve");
  } finally {
    await registry.dispose(id);
  }
}, 15000);

test("omitted approvalPolicy defaults to always-ask with no --auto-approve", async () => {
  const registry = new SessionRegistry();
  const cwd = mkdtempSync(join(fakeDir, "wt-"));
  const { id } = await registry.create({ cwd, binary: fakeOmp });
  try {
    const argv = JSON.parse(
      readFileSync(join(cwd, "argv.json"), "utf8"),
    ) as string[];
    expect(argv).toContain("--approval-mode");
    expect(argv[argv.indexOf("--approval-mode") + 1]).toBe("always-ask");
    expect(argv).not.toContain("--auto-approve");
  } finally {
    await registry.dispose(id);
  }
}, 15000);

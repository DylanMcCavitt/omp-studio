import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OmpRpcSession } from "../src/main/omp/rpc-session";
import type {
  ExtensionUiRequest,
  ExtensionUiResponse,
  RpcFrame,
} from "../src/shared/rpc";

// Real integration test: drives the installed `omp --mode rpc-ui` binary through
// the actual OmpRpcSession bridge. The handshake assertions cost nothing; the
// live streaming prompt (a paid model call) only runs when RPC_LIVE=1.

const cwd = mkdtempSync(join(tmpdir(), "omp-studio-rpc-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

test("bridge spawns omp, reaches ready, and reports a model + tools", async () => {
  const session = new OmpRpcSession({ cwd });
  try {
    await session.whenReady();
    const state = await session.getState();
    expect(state.model).toBeDefined();
    expect(typeof state.model.provider).toBe("string");
    expect(typeof state.model.id).toBe("string");
    expect(Array.isArray(state.dumpTools)).toBe(true);
    expect((state.dumpTools ?? []).length).toBeGreaterThan(0);

    const messages = await session.getMessages();
    expect(Array.isArray(messages)).toBe(true);
  } finally {
    session.dispose();
  }
}, 30000);

test("bridge emits a lifecycle 'exited' frame when omp shuts down", async () => {
  const session = new OmpRpcSession({ cwd });
  await session.whenReady();
  const exited = new Promise<string>((resolve) => {
    session.on("lifecycle", (status: string) => {
      if (status === "exited") resolve(status);
    });
  });
  // Closing stdin makes omp exit 0.
  // dispose() removes consumer listeners, so trigger a natural exit instead.
  (
    session as unknown as { child: { stdin: { end(): void } } }
  ).child.stdin.end();
  expect(await exited).toBe("exited");
}, 20000);

const live = process.env.RPC_LIVE === "1" ? test : test.skip;
live(
  "bridge streams an assistant turn for a real prompt",
  async () => {
    // Uses the session default model (config-resolved). A single short reply.
    const session = new OmpRpcSession({ cwd });
    let sawTextDelta = false;
    session.on("frame", (f: RpcFrame) => {
      if (
        f.type === "message_update" &&
        (f as { assistantMessageEvent?: { type?: string } })
          .assistantMessageEvent?.type === "text_delta"
      ) {
        sawTextDelta = true;
      }
    });
    const ended = new Promise<void>((resolve) => {
      session.on("frame", (f: RpcFrame) => {
        if (f.type === "agent_end") resolve();
      });
    });
    try {
      await session.whenReady();
      await session.prompt("Reply with exactly the word: pong");
      await ended;
      const messages = await session.getMessages();
      const last = messages[messages.length - 1];
      expect(last?.role).toBe("assistant");
      const text = (last?.content as { type: string; text?: string }[])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      expect(text.length).toBeGreaterThan(0);
      expect(sawTextDelta).toBe(true);
    } finally {
      session.dispose();
    }
  },
  120000,
);

// ---------------------------------------------------------------------------
// Non-live interactive-UI bridge tests.
//
// These never spawn the real (paid) model. A tiny fake omp child speaks just
// enough of the rpc-ui protocol: it emits `ready`, and for each
// `{ type: "__emit", frame }` line it receives on stdin it writes `frame` to
// stdout — letting a test synthesize extension_ui_request frames on demand. We
// spy on the child's stdin to assert exactly what the bridge writes back.
// ---------------------------------------------------------------------------

const fakeDir = mkdtempSync(join(tmpdir(), "omp-studio-fake-"));
const fakeOmp = join(fakeDir, "fake-omp.mjs");
writeFileSync(
  fakeOmp,
  `#!/usr/bin/env node
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
    if (msg && msg.type === "__emit" && msg.frame) {
      process.stdout.write(JSON.stringify(msg.frame) + "\\n");
    }
  }
});
process.stdin.on("end", () => process.exit(0));
`,
);
chmodSync(fakeOmp, 0o755);
afterAll(() => rmSync(fakeDir, { recursive: true, force: true }));

interface ChildStdin {
  write(chunk: unknown, ...rest: unknown[]): boolean;
  end(): void;
}

function childStdin(session: OmpRpcSession): ChildStdin {
  return (session as unknown as { child: { stdin: ChildStdin } }).child.stdin;
}

function pendingUiSize(session: OmpRpcSession): number {
  return (session as unknown as { pendingUi: Map<string, unknown> }).pendingUi
    .size;
}

// Spawn a fake-omp-backed session and capture every line written to its stdin.
function fakeSession(): { session: OmpRpcSession; writes: string[] } {
  const session = new OmpRpcSession({ cwd, binary: fakeOmp });
  const writes: string[] = [];
  const stdin = childStdin(session);
  const original = stdin.write.bind(stdin);
  stdin.write = (chunk: unknown, ...rest: unknown[]): boolean => {
    writes.push(typeof chunk === "string" ? chunk : String(chunk));
    return original(chunk, ...rest);
  };
  return { session, writes };
}

// Ask the fake child to surface an extension_ui_request frame to the bridge.
function emitUiRequest(
  session: OmpRpcSession,
  frame: Record<string, unknown>,
): void {
  childStdin(session).write(JSON.stringify({ type: "__emit", frame }) + "\n");
}

function nextUiRequest(
  session: OmpRpcSession,
): Promise<{ request: ExtensionUiRequest; responseRequired: boolean }> {
  return new Promise((resolve) => {
    session.once("ui-request", (payload: unknown) => {
      resolve(
        payload as { request: ExtensionUiRequest; responseRequired: boolean },
      );
    });
  });
}

// Parsed extension_ui_response frames the bridge wrote to the child's stdin.
function uiResponses(writes: string[]): Record<string, unknown>[] {
  const frames: Record<string, unknown>[] = [];
  for (const line of writes) {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(line.trim()) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (frame.type === "extension_ui_response") frames.push(frame);
  }
  return frames;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("respondUi writes the matching response frame for each method", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();

    const cases: {
      id: string;
      method: string;
      response: ExtensionUiResponse;
    }[] = [
      { id: "ui-confirm", method: "confirm", response: { confirmed: true } },
      { id: "ui-select", method: "select", response: { value: "opt-b" } },
      { id: "ui-input", method: "input", response: { value: "branch-x" } },
      { id: "ui-editor", method: "editor", response: { value: "edited" } },
    ];

    for (const c of cases) {
      const pending = nextUiRequest(session);
      emitUiRequest(session, {
        type: "extension_ui_request",
        id: c.id,
        method: c.method,
        message: "?",
      });
      const { request, responseRequired } = await pending;
      expect(responseRequired).toBe(true);
      expect(request.id).toBe(c.id);
      session.respondUi(c.id, c.response);
    }

    const responses = uiResponses(writes);
    for (const c of cases) {
      expect(responses.find((f) => f.id === c.id)).toEqual({
        type: "extension_ui_response",
        id: c.id,
        ...c.response,
      });
    }
    // Every answered request is removed from pending tracking.
    expect(pendingUiSize(session)).toBe(0);
  } finally {
    session.dispose();
  }
}, 15000);

test("hint methods forward as fire-and-forget (no response required)", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();
    const pending = nextUiRequest(session);
    emitUiRequest(session, {
      type: "extension_ui_request",
      id: "ui-notify",
      method: "notify",
      message: "hi",
    });
    const { responseRequired } = await pending;
    expect(responseRequired).toBe(false);
    // No timer armed, nothing tracked, and respondUi stays a no-op.
    expect(pendingUiSize(session)).toBe(0);
    session.respondUi("ui-notify", { confirmed: true });
    expect(uiResponses(writes).length).toBe(0);
  } finally {
    session.dispose();
  }
}, 15000);

test("an unanswered request times out fail-closed", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();

    const confirmPending = nextUiRequest(session);
    emitUiRequest(session, {
      type: "extension_ui_request",
      id: "to-confirm",
      method: "confirm",
      message: "?",
      timeout: 40,
    });
    await confirmPending;

    const inputPending = nextUiRequest(session);
    emitUiRequest(session, {
      type: "extension_ui_request",
      id: "to-input",
      method: "input",
      message: "?",
      timeout: 40,
    });
    await inputPending;

    await delay(150);

    const responses = uiResponses(writes);
    // confirm fails closed to a decline; others fail closed to a cancel.
    expect(responses.find((f) => f.id === "to-confirm")).toEqual({
      type: "extension_ui_response",
      id: "to-confirm",
      confirmed: false,
      timedOut: true,
    });
    expect(responses.find((f) => f.id === "to-input")).toEqual({
      type: "extension_ui_response",
      id: "to-input",
      cancelled: true,
      timedOut: true,
    });
    expect(pendingUiSize(session)).toBe(0);
  } finally {
    session.dispose();
  }
}, 15000);

test("pending UI requests are cleared on child exit with no late write", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();

    const pending = nextUiRequest(session);
    emitUiRequest(session, {
      type: "extension_ui_request",
      id: "ui-exit",
      method: "confirm",
      message: "?",
      timeout: 60000,
    });
    await pending;
    expect(pendingUiSize(session)).toBe(1);

    const exited = new Promise<void>((resolve) => {
      session.on("lifecycle", (status: string) => {
        if (status === "exited") resolve();
      });
    });
    // Closing stdin makes the fake child exit, mirroring real omp.
    childStdin(session).end();
    await exited;

    expect(pendingUiSize(session)).toBe(0);
    // The 60s timer was cleared; no fail-closed frame hits the dead child.
    expect(uiResponses(writes).some((f) => f.id === "ui-exit")).toBe(false);
  } finally {
    session.dispose();
  }
}, 15000);

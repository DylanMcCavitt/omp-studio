import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OmpRpcSession } from "../src/main/omp/rpc-session";
import type {
  AvailableSlashCommand,
  ExtensionUiRequest,
  ExtensionUiResponse,
  RpcFrame,
} from "../src/shared/rpc";
import { hasOmp } from "./has-omp";

// Real integration test: drives the installed `omp --mode rpc-ui` binary through
// the actual OmpRpcSession bridge. The handshake assertions cost nothing; the
// live streaming prompt (a paid model call) only runs when RPC_LIVE=1.

const cwd = mkdtempSync(join(tmpdir(), "omp-studio-rpc-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

// These two spawn the real installed omp; skip on a clean runner (no omp).
const ompTest = test.skipIf(!hasOmp());

ompTest(
  "bridge spawns omp, reaches ready, and reports a model + tools",
  async () => {
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
  },
  30000,
);

ompTest(
  "bridge emits a lifecycle 'exited' frame when omp shuts down",
  async () => {
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
  },
  20000,
);

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

// ---------------------------------------------------------------------------
// Non-live session stats + compaction bridge tests (E2).
//
// Same fake-omp child: we read the request frame the bridge wrote to stdin,
// then echo a correlated `response` (or an id-less unknown-command failure, the
// way real omp replies for commands a build doesn't implement) back via __emit.
// ---------------------------------------------------------------------------

// Every frame the bridge wrote to the child's stdin (commands + injected lines).
function outgoing(writes: string[]): Record<string, unknown>[] {
  const frames: Record<string, unknown>[] = [];
  for (const line of writes) {
    try {
      frames.push(JSON.parse(line.trim()) as Record<string, unknown>);
    } catch {
      // not JSON (partial write) — skip it.
    }
  }
  return frames;
}

// Ask the fake child to surface an arbitrary frame (response or event) to the
// bridge, mirroring emitUiRequest but for non-UI frames.
function emitFrame(
  session: OmpRpcSession,
  frame: Record<string, unknown>,
): void {
  childStdin(session).write(JSON.stringify({ type: "__emit", frame }) + "\n");
}

function collectFrames(session: OmpRpcSession): RpcFrame[] {
  const frames: RpcFrame[] = [];
  session.on("frame", (f: RpcFrame) => frames.push(f));
  return frames;
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await delay(5);
  }
}

test("getSessionStats sends get_session_stats and returns the parsed stats", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();
    const pending = session.getSessionStats();
    // send() writes the request synchronously, so it is already captured.
    const req = outgoing(writes).find((f) => f.type === "get_session_stats");
    expect(req).toBeDefined();

    const stats = {
      tokens: 1234,
      cost: 0.05,
      contextUsage: { tokens: 1100, contextWindow: 200000, percent: 0.55 },
    };
    emitFrame(session, {
      type: "response",
      command: "get_session_stats",
      id: req?.id as string,
      success: true,
      data: stats,
    });
    await expect(pending).resolves.toEqual(stats);
  } finally {
    session.dispose();
  }
}, 15000);

test("getSessionStats degrades to empty stats on an unknown command", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();
    const pending = session.getSessionStats();
    expect(outgoing(writes).some((f) => f.type === "get_session_stats")).toBe(
      true,
    );
    // Real omp drops the id and reports success:false for unknown commands; the
    // bridge must correlate by command name and degrade instead of hanging.
    emitFrame(session, {
      type: "response",
      command: "get_session_stats",
      success: false,
      error: "Unknown command: get_session_stats",
    });
    await expect(pending).resolves.toEqual({});
  } finally {
    session.dispose();
  }
}, 15000);

test("compact sends the compact command with custom instructions", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();
    const pending = session.compact("keep the API decisions");
    const req = outgoing(writes).find((f) => f.type === "compact");
    expect(req).toBeDefined();
    expect(req?.customInstructions).toBe("keep the API decisions");
    emitFrame(session, {
      type: "response",
      command: "compact",
      id: req?.id as string,
      success: true,
      data: {},
    });
    await expect(pending).resolves.toBeUndefined();
  } finally {
    session.dispose();
  }
}, 15000);

test("compact omits customInstructions when none are given", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();
    const pending = session.compact();
    const req = outgoing(writes).find((f) => f.type === "compact");
    expect(req).toBeDefined();
    // undefined is dropped by JSON.stringify, matching the optional wire field.
    expect(req?.customInstructions).toBeUndefined();
    emitFrame(session, {
      type: "response",
      command: "compact",
      id: req?.id as string,
      success: true,
    });
    await expect(pending).resolves.toBeUndefined();
  } finally {
    session.dispose();
  }
}, 15000);

test("compact degrades on an unknown command", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();
    const pending = session.compact();
    expect(outgoing(writes).some((f) => f.type === "compact")).toBe(true);
    emitFrame(session, {
      type: "response",
      command: "compact",
      success: false,
      error: "Unknown command: compact",
    });
    await expect(pending).resolves.toBeUndefined();
  } finally {
    session.dispose();
  }
}, 15000);

test("isCompacting tracks auto_compaction_start/end and still forwards the frames", async () => {
  const { session } = fakeSession();
  try {
    await session.whenReady();
    const frames = collectFrames(session);
    expect(session.isCompacting()).toBe(false);

    emitFrame(session, {
      type: "auto_compaction_start",
      reason: "threshold",
      action: "context-full",
    });
    await waitUntil(() =>
      frames.some((f) => f.type === "auto_compaction_start"),
    );
    expect(session.isCompacting()).toBe(true);

    emitFrame(session, {
      type: "auto_compaction_end",
      action: "context-full",
      aborted: false,
    });
    await waitUntil(() => frames.some((f) => f.type === "auto_compaction_end"));
    expect(session.isCompacting()).toBe(false);

    // The renderer reads compaction state from these forwarded frames (evt:rpc).
    const compaction = frames
      .map((f) => f.type)
      .filter((t) => typeof t === "string" && t.startsWith("auto_compaction"));
    expect(compaction).toEqual([
      "auto_compaction_start",
      "auto_compaction_end",
    ]);
  } finally {
    session.dispose();
  }
}, 15000);

// ---------------------------------------------------------------------------
// Non-live subagent drill-in bridge tests (feature 4).
//
// Same fake-omp child: read the request frame the bridge wrote, then echo a
// correlated response (or an id-less unknown-command failure the way real omp
// replies for commands a build doesn't implement) back via __emit.
// ---------------------------------------------------------------------------

test("getSubagents returns the widened subagent snapshot array", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();
    const pending = session.getSubagents();
    const req = outgoing(writes).find((f) => f.type === "get_subagents");
    expect(req).toBeDefined();
    const snapshot = [
      {
        id: "c1",
        index: 0,
        agent: "task",
        agentSource: "bundled",
        status: "running",
        lastUpdate: 1,
      },
    ];
    emitFrame(session, {
      type: "response",
      command: "get_subagents",
      id: req?.id as string,
      success: true,
      data: { subagents: snapshot },
    });
    await expect(pending).resolves.toEqual(snapshot);
  } finally {
    session.dispose();
  }
}, 15000);

test("getSubagentMessages sends the selector and returns the parsed cursor", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();
    const pending = session.getSubagentMessages({
      subagentId: "child-1",
      fromByte: 42,
    });
    const req = outgoing(writes).find(
      (f) => f.type === "get_subagent_messages",
    );
    expect(req).toBeDefined();
    expect(req?.subagentId).toBe("child-1");
    expect(req?.fromByte).toBe(42);

    const result = {
      sessionFile: "/sessions/child-1.jsonl",
      fromByte: 42,
      nextByte: 99,
      reset: false,
      entries: [{ type: "message" }],
      messages: [],
    };
    emitFrame(session, {
      type: "response",
      command: "get_subagent_messages",
      id: req?.id as string,
      success: true,
      data: result,
    });
    await expect(pending).resolves.toEqual(result);
  } finally {
    session.dispose();
  }
}, 15000);

test("getSubagentMessages degrades to an empty result on an unknown command", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();
    const pending = session.getSubagentMessages({ sessionFile: "/x.jsonl" });
    expect(
      outgoing(writes).some((f) => f.type === "get_subagent_messages"),
    ).toBe(true);
    // Real omp drops the id and reports success:false for unknown commands; no
    // markReady auto-send competes for this command, so id-less correlation by
    // command name resolves exactly this request and the method degrades.
    emitFrame(session, {
      type: "response",
      command: "get_subagent_messages",
      success: false,
      error: "Unknown command: get_subagent_messages",
    });
    await expect(pending).resolves.toEqual({
      sessionFile: "",
      fromByte: 0,
      nextByte: 0,
      reset: false,
      entries: [],
      messages: [],
    });
  } finally {
    session.dispose();
  }
}, 15000);

test("setSubagentSubscription sends the level and resolves on success", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();
    const pending = session.setSubagentSubscription("progress");
    // markReady already emits set_subagent_subscription {level:"events"}, so
    // match OUR call by level and respond by its exact id (id-match wins over
    // the id-less command correlation, which would otherwise settle markReady's).
    const req = outgoing(writes).find(
      (f) => f.type === "set_subagent_subscription" && f.level === "progress",
    );
    expect(req).toBeDefined();
    emitFrame(session, {
      type: "response",
      command: "set_subagent_subscription",
      id: req?.id as string,
      success: true,
    });
    await expect(pending).resolves.toBeUndefined();
  } finally {
    session.dispose();
  }
}, 15000);

test("setSubagentSubscription degrades on an unknown command", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();
    const pending = session.setSubagentSubscription("off");
    const req = outgoing(writes).find(
      (f) => f.type === "set_subagent_subscription" && f.level === "off",
    );
    expect(req).toBeDefined();
    emitFrame(session, {
      type: "response",
      command: "set_subagent_subscription",
      id: req?.id as string,
      success: false,
      error: "Unknown command: set_subagent_subscription",
    });
    await expect(pending).resolves.toBeUndefined();
  } finally {
    session.dispose();
  }
}, 15000);

// ---------------------------------------------------------------------------
// Non-live commands palette snapshot bridge tests (feature 6b).
//
// Same fake-omp child: read the request frame the bridge wrote, then echo a
// correlated response (a `{ commands }` object, a bare array, or an id-less
// unknown-command failure the way real omp replies for commands a build doesn't
// implement) back via __emit.
// ---------------------------------------------------------------------------

test("getAvailableCommands sends get_available_commands and returns the parsed list", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();
    const pending = session.getAvailableCommands();
    const req = outgoing(writes).find(
      (f) => f.type === "get_available_commands",
    );
    expect(req).toBeDefined();
    const commands: AvailableSlashCommand[] = [
      {
        name: "compact",
        description: "Compact the session",
        source: "builtin",
      },
      { name: "review", source: "skill" },
    ];
    emitFrame(session, {
      type: "response",
      command: "get_available_commands",
      id: req?.id as string,
      success: true,
      data: { commands },
    });
    await expect(pending).resolves.toEqual(commands);
  } finally {
    session.dispose();
  }
}, 15000);

test("getAvailableCommands accepts a bare array response", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();
    const pending = session.getAvailableCommands();
    const req = outgoing(writes).find(
      (f) => f.type === "get_available_commands",
    );
    expect(req).toBeDefined();
    const commands: AvailableSlashCommand[] = [
      { name: "tan", source: "builtin" },
    ];
    emitFrame(session, {
      type: "response",
      command: "get_available_commands",
      id: req?.id as string,
      success: true,
      data: commands,
    });
    await expect(pending).resolves.toEqual(commands);
  } finally {
    session.dispose();
  }
}, 15000);

test("getAvailableCommands degrades to an empty list on an unknown command", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();
    const pending = session.getAvailableCommands();
    expect(
      outgoing(writes).some((f) => f.type === "get_available_commands"),
    ).toBe(true);
    // Real omp drops the id and reports success:false for unknown commands; no
    // markReady auto-send competes for this command, so id-less correlation by
    // command name resolves exactly this request and the method degrades to [].
    emitFrame(session, {
      type: "response",
      command: "get_available_commands",
      success: false,
      error: "Unknown command: get_available_commands",
    });
    await expect(pending).resolves.toEqual([]);
  } finally {
    session.dispose();
  }
}, 15000);

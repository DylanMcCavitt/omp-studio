import { afterAll, expect, jest, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OmpRpcSession } from "../src/main/omp/rpc-session";

// Non-live coverage for the respondUi answer paths the rpc-bridge suite does not
// exercise: answering an untracked id, double-answering one request, and an
// answer racing (and winning against) the fail-closed timeout. A tiny fake omp
// child speaks just enough rpc-ui: it emits `ready`, and echoes the `frame` of
// each `{ type: "__emit", frame }` line on stdin to stdout, letting a test
// synthesize extension_ui_request frames on demand. The child's stdin is spied
// so we can assert exactly which extension_ui_response frames the bridge wrote.

const cwd = mkdtempSync(join(tmpdir(), "omp-studio-rpcui-"));
const fakeDir = mkdtempSync(join(tmpdir(), "omp-studio-rpcui-fake-"));
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
afterAll(() => {
  rmSync(fakeDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

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

// Spawn a fake-omp-backed session capturing every line written to its stdin.
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

function emitUiRequest(
  session: OmpRpcSession,
  frame: Record<string, unknown>,
): void {
  childStdin(session).write(JSON.stringify({ type: "__emit", frame }) + "\n");
}

function nextUiRequest(session: OmpRpcSession): Promise<unknown> {
  const { promise, resolve } = Promise.withResolvers<unknown>();
  session.once("ui-request", resolve);
  return promise;
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

test("respondUi for an untracked request id writes nothing", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();
    // No request was ever surfaced for this id — must be a silent no-op. The
    // write (if any) is synchronous, so no waiting is required to assert.
    session.respondUi("never-requested", { confirmed: true });
    expect(uiResponses(writes)).toHaveLength(0);
    expect(pendingUiSize(session)).toBe(0);
  } finally {
    session.dispose();
  }
}, 15000);

test("a second respondUi for the same id is a no-op (one response frame)", async () => {
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();

    const pending = nextUiRequest(session);
    emitUiRequest(session, {
      type: "extension_ui_request",
      id: "dup",
      method: "confirm",
      message: "?",
    });
    await pending;

    session.respondUi("dup", { confirmed: true });
    // The id is already settled; the second answer must not write again.
    session.respondUi("dup", { confirmed: false });

    const responses = uiResponses(writes).filter((f) => f.id === "dup");
    expect(responses).toHaveLength(1);
    expect(responses[0]).toEqual({
      type: "extension_ui_response",
      id: "dup",
      confirmed: true,
    });
    expect(pendingUiSize(session)).toBe(0);
  } finally {
    session.dispose();
  }
}, 15000);

test("answering a request cancels its fail-closed timeout", async () => {
  // Fake timers so the session's internal fail-closed timer is driven
  // deterministically (no wall-clock wait); child IO stays on the real loop.
  jest.useFakeTimers();
  const { session, writes } = fakeSession();
  try {
    await session.whenReady();

    const pending = nextUiRequest(session);
    emitUiRequest(session, {
      type: "extension_ui_request",
      id: "race",
      method: "confirm",
      message: "?",
      timeout: 40,
    });
    await pending;

    // Answer, then advance well past the 40ms fail-closed window.
    session.respondUi("race", { confirmed: true });
    jest.advanceTimersByTime(150);

    const responses = uiResponses(writes).filter((f) => f.id === "race");
    // Exactly the answer — the cancelled timer never fired a timedOut frame.
    expect(responses).toHaveLength(1);
    expect(responses[0]).toEqual({
      type: "extension_ui_response",
      id: "race",
      confirmed: true,
    });
    expect(responses[0]?.timedOut).toBeUndefined();
    expect(pendingUiSize(session)).toBe(0);
  } finally {
    jest.useRealTimers();
    session.dispose();
  }
}, 15000);

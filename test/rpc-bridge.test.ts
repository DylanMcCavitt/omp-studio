import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OmpRpcSession } from "../src/main/omp/rpc-session";
import type { RpcFrame } from "../src/shared/rpc";

// Real integration test: drives the installed `omp --mode rpc` binary through
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

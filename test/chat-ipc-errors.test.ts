import { expect, test } from "bun:test";
import type { IpcMain } from "electron";
import { registerChatIpc } from "../src/main/ipc/chat";
import type { SessionRegistry } from "../src/main/omp/registry";
import { CH } from "../src/shared/ipc";

// Error-wrapping coverage for the chat IPC layer (the success/forwarding paths
// live in chat-ipc.test.ts). The shared `handle` wrapper must:
//   1. surface "unknown session" when a command targets a missing session, and
//   2. coerce any thrown non-Error into a real Error so the renderer never sees
//      "[object Object]" across the IPC boundary, while passing Errors through.
// All against stubbed electron/registry seams — no omp child is spawned.

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

// Capture the rejection (if any) from invoking a handler.
async function rejection(promise: unknown): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the handler to reject, but it resolved");
}

test("session-scoped handlers reject with 'unknown session' for a missing id", async () => {
  const { ipcMain, invoke } = makeIpcMain();
  // A registry that never finds a session — every lookup misses.
  const registry = { get: () => undefined } as unknown as SessionRegistry;
  registerChatIpc(ipcMain, registry, () => null);

  const calls: Array<{ channel: string; args: unknown[] }> = [
    { channel: CH.chatPrompt, args: ["ghost", "hi"] },
    { channel: CH.chatSteer, args: ["ghost", "hi"] },
    { channel: CH.chatFollowUp, args: ["ghost", "hi"] },
    { channel: CH.chatAbort, args: ["ghost"] },
    { channel: CH.chatSetModel, args: ["ghost", "anthropic", "opus"] },
    { channel: CH.chatSetThinking, args: ["ghost", "medium"] },
    { channel: CH.chatGetState, args: ["ghost"] },
    { channel: CH.chatGetMessages, args: ["ghost"] },
    { channel: CH.chatGetSubagents, args: ["ghost"] },
  ];

  for (const { channel, args } of calls) {
    const error = await rejection(invoke(channel, ...args));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("unknown session");
  }
});

test("a thrown non-Error is coerced into a real Error across IPC", async () => {
  const { ipcMain, invoke } = makeIpcMain();
  // The live session throws a bare string (not an Error) from a command.
  const session = {
    getState() {
      throw "boom";
    },
  };
  const registry = {
    get: () => session,
  } as unknown as SessionRegistry;
  registerChatIpc(ipcMain, registry, () => null);

  const error = await rejection(invoke(CH.chatGetState, "sess-1"));
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("boom");
});

test("a thrown Error propagates with its message intact", async () => {
  const { ipcMain, invoke } = makeIpcMain();
  const session = {
    async prompt() {
      throw new Error("prompt exploded");
    },
  };
  const registry = {
    get: () => session,
  } as unknown as SessionRegistry;
  registerChatIpc(ipcMain, registry, () => null);

  const error = await rejection(invoke(CH.chatPrompt, "sess-1", "hi"));
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("prompt exploded");
});

test("chat:create surfaces a registry failure as an Error across IPC", async () => {
  const { ipcMain, invoke } = makeIpcMain();
  // registry.create rejecting with a non-Error must still cross as an Error.
  const registry = {
    create: async () => {
      throw "spawn refused";
    },
    get: () => undefined,
  } as unknown as SessionRegistry;
  registerChatIpc(ipcMain, registry, () => null);

  const error = await rejection(invoke(CH.chatCreate, { cwd: "/tmp/x" }));
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("spawn refused");
});

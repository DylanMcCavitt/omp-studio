import { EventEmitter } from "node:events";
import { expect, test } from "bun:test";
import type { BrowserWindow, IpcMain } from "electron";
import { registerTerminalIpc } from "../src/main/ipc/terminal";
import type { PtySession } from "../src/main/terminal/pty-session";
import type { TerminalRegistry } from "../src/main/terminal/registry";
import type { TerminalInfo } from "../src/shared/domain";
import {
  CH,
  type ExternalTerminalLauncherInfo,
  type ExternalTerminalLaunchResult,
} from "../src/shared/ipc";

// Terminal IPC is a capability boundary: terminal:* requests are registered from
// the shared contract, renderer arguments are handed to the main-owned registry,
// and pty data/exit are the only terminal event shapes sent back to the window.

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

type SentEvent = { channel: string; payload: unknown };

type TerminalCall =
  | { method: "create"; opts: { cwd: string; cols: number; rows: number } }
  | { method: "write"; id: string; data: string }
  | { method: "resize"; id: string; cols: number; rows: number }
  | { method: "kill"; id: string }
  | { method: "list" }
  | { method: "externalLaunchers" }
  | { method: "openExternal"; opts: { cwd: string; profile?: "ghostty" } };

class FakePtySession extends EventEmitter {
  readonly id = "term-age-829";
  readonly info: TerminalInfo = {
    id: this.id,
    cwd: "/tmp/age-829-terminal",
    shell: "/bin/zsh",
    cols: 101,
    rows: 43,
    createdAt: "2026-07-07T00:00:00.000Z",
  };

  resize(cols: number, rows: number): void {
    this.emit("resized", { cols, rows });
  }

  kill(): void {
    this.emit("killed");
  }
}

function makeIpcMain(): {
  ipcMain: IpcMain;
  invoke: (channel: string, ...args: unknown[]) => unknown;
  registeredChannels: () => string[];
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
  return {
    ipcMain: ipcMain as unknown as IpcMain,
    invoke,
    registeredChannels: () => [...handlers.keys()],
  };
}

function makeWindow(events: SentEvent[]): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        events.push({ channel, payload });
      },
    },
  } as unknown as BrowserWindow;
}

test("registers every terminal:* request channel declared in shared/ipc", () => {
  const harness = makeIpcMain();
  const calls: TerminalCall[] = [];
  const session = new FakePtySession();
  registerTerminalIpc(
    harness.ipcMain,
    {
      create: async (opts: { cwd: string; cols: number; rows: number }) => {
        calls.push({ method: "create", opts });
        return session as unknown as PtySession;
      },
      write: (id: string, data: string) => {
        calls.push({ method: "write", id, data });
      },
      get: () => session,
      list: () => {
        calls.push({ method: "list" });
        return [session.info];
      },
    } as unknown as TerminalRegistry,
    {
      list: () => [],
      open: () => ({
        id: "external-age-829",
        profile: "ghostty",
        label: "Ghostty",
        cwd: "/tmp/age-829-terminal",
        launchedAt: "2026-07-07T00:00:00.000Z",
      }),
    },
    () => null,
  );

  expect(harness.registeredChannels()).toEqual(
    Object.values(CH).filter((channel) => channel.startsWith("terminal:")),
  );
});

test("terminal handlers forward distinct renderer arguments to the registry and external launcher", async () => {
  const harness = makeIpcMain();
  const calls: TerminalCall[] = [];
  const events: SentEvent[] = [];
  const session = new FakePtySession();
  const launcherInfo: ExternalTerminalLauncherInfo = {
    profile: "ghostty",
    label: "Ghostty",
    available: true,
    kind: "mac-app",
    detectedPath: "/Applications/Ghostty.app",
  };
  const launchResult: ExternalTerminalLaunchResult = {
    id: "external-age-829",
    profile: "ghostty",
    label: "Ghostty",
    cwd: "/tmp/age-829-external",
    launchedAt: "2026-07-07T00:00:00.000Z",
  };

  session.on("resized", ({ cols, rows }) => {
    calls.push({ method: "resize", id: session.id, cols, rows });
  });
  session.on("killed", () => {
    calls.push({ method: "kill", id: session.id });
  });

  registerTerminalIpc(
    harness.ipcMain,
    {
      create: async (opts: { cwd: string; cols: number; rows: number }) => {
        calls.push({ method: "create", opts });
        return session as unknown as PtySession;
      },
      write: (id: string, data: string) => {
        calls.push({ method: "write", id, data });
      },
      get: (id: string) => (id === session.id ? session : undefined),
      list: () => {
        calls.push({ method: "list" });
        return [session.info];
      },
    } as unknown as TerminalRegistry,
    {
      list: () => {
        calls.push({ method: "externalLaunchers" });
        return [launcherInfo];
      },
      open: (opts: { cwd: string; profile?: "ghostty" }) => {
        calls.push({ method: "openExternal", opts });
        return launchResult;
      },
    },
    () => makeWindow(events),
  );

  expect(
    await harness.invoke(CH.terminalCreate, {
      cwd: "/tmp/age-829-terminal",
      cols: 101,
      rows: 43,
    }),
  ).toEqual(session.info);
  session.emit("data", "sentinel terminal bytes");
  session.emit("exit", 23);

  await harness.invoke(CH.terminalWrite, session.id, "printf sentinel\\n");
  await harness.invoke(CH.terminalResize, session.id, 132, 44);
  await harness.invoke(CH.terminalKill, session.id);
  expect(await harness.invoke(CH.terminalList)).toEqual([session.info]);
  expect(await harness.invoke(CH.terminalExternalLaunchers)).toEqual([
    launcherInfo,
  ]);
  expect(
    await harness.invoke(CH.terminalOpenExternal, {
      cwd: "/tmp/age-829-external",
      profile: "ghostty",
    }),
  ).toEqual(launchResult);

  expect(calls).toEqual([
    {
      method: "create",
      opts: { cwd: "/tmp/age-829-terminal", cols: 101, rows: 43 },
    },
    { method: "write", id: session.id, data: "printf sentinel\\n" },
    { method: "resize", id: session.id, cols: 132, rows: 44 },
    { method: "kill", id: session.id },
    { method: "list" },
    { method: "externalLaunchers" },
    {
      method: "openExternal",
      opts: { cwd: "/tmp/age-829-external", profile: "ghostty" },
    },
  ]);
  expect(events).toEqual([
    {
      channel: CH.evtTerminalData,
      payload: { id: session.id, data: "sentinel terminal bytes" },
    },
    { channel: CH.evtTerminalExit, payload: { id: session.id, code: 23 } },
  ]);
});

test("terminal handler failures cross IPC as clean Error messages", async () => {
  const harness = makeIpcMain();
  registerTerminalIpc(
    harness.ipcMain,
    {
      create: async () => {
        throw "create failed as a string";
      },
      write: () => {},
      get: () => undefined,
      list: () => [],
    } as unknown as TerminalRegistry,
    { list: () => [], open: () => null },
    () => null,
  );

  let caught: unknown;
  try {
    await harness.invoke(CH.terminalCreate, {
      cwd: "/tmp/age-829-terminal",
      cols: 80,
      rows: 24,
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe("create failed as a string");
});

test("late resize and kill for an unknown terminal id are safe no-ops", async () => {
  const harness = makeIpcMain();
  const calls: TerminalCall[] = [];
  registerTerminalIpc(
    harness.ipcMain,
    {
      create: async () => new FakePtySession() as unknown as PtySession,
      write: (id: string, data: string) => {
        calls.push({ method: "write", id, data });
      },
      get: () => undefined,
      list: () => [],
    } as unknown as TerminalRegistry,
    { list: () => [], open: () => null },
    () => null,
  );

  await harness.invoke(CH.terminalResize, "missing-age-829", 120, 30);
  await harness.invoke(CH.terminalKill, "missing-age-829");

  expect(calls).toEqual([]);
});

import { expect, test } from "bun:test";
import type { BrowserWindow, IpcMain } from "electron";
import type {
  BrowserViewManager,
  ViewBounds,
} from "../src/main/browser/view-manager";
import { registerBrowserIpc } from "../src/main/ipc/browser";
import type { BrowserViewState } from "../src/shared/domain";
import { CH } from "../src/shared/ipc";

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

test("browser IPC forwards explicit diagnostics actions through the manager", () => {
  const calls: Array<[string, ...unknown[]]> = [];
  let pushState!: (state: BrowserViewState) => void;
  const state: BrowserViewState = {
    id: "v1",
    url: "https://example.com",
    title: "Example",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  const manager = {
    onState(cb: (state: BrowserViewState) => void) {
      pushState = cb;
      return () => {};
    },
    create(opts: { url: string; bounds: ViewBounds }) {
      calls.push(["create", opts]);
      return state;
    },
    navigate(id: string, url: string) {
      calls.push(["navigate", id, url]);
    },
    goBack(id: string) {
      calls.push(["goBack", id]);
    },
    goForward(id: string) {
      calls.push(["goForward", id]);
    },
    reload(id: string) {
      calls.push(["reload", id]);
    },
    openDevTools(id: string) {
      calls.push(["openDevTools", id]);
    },
    openExternal(id: string) {
      calls.push(["openExternal", id]);
    },
    setBounds(id: string, bounds: ViewBounds) {
      calls.push(["setBounds", id, bounds]);
    },
    destroy(id: string) {
      calls.push(["destroy", id]);
    },
  } as unknown as BrowserViewManager;
  const sends: Array<[string, unknown]> = [];
  const win = {
    webContents: {
      send: (channel: string, payload: unknown) =>
        sends.push([channel, payload]),
    },
  } as unknown as BrowserWindow;
  const { ipcMain, invoke } = makeIpcMain();

  registerBrowserIpc(ipcMain, manager, () => win);

  expect(
    invoke(CH.browserCreate, {
      url: "https://example.com",
      bounds: { x: 1, y: 2, width: 3, height: 4 },
    }),
  ).toBe(state);
  invoke(CH.browserOpenDevTools, "v1");
  invoke(CH.browserOpenExternal, "v1");
  pushState(state);

  expect(calls).toEqual([
    [
      "create",
      {
        url: "https://example.com",
        bounds: { x: 1, y: 2, width: 3, height: 4 },
      },
    ],
    ["openDevTools", "v1"],
    ["openExternal", "v1"],
  ]);
  expect(sends).toEqual([[CH.evtBrowserState, state]]);
});

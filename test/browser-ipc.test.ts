import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow, IpcMain } from "electron";
import type {
  BrowserViewManager,
  ViewBounds,
} from "../src/main/browser/view-manager";
import { registerBrowserIpc } from "../src/main/ipc/browser";
import {
  setSettingsDir,
  updateSettings,
} from "../src/main/services/settings-service";
import type { BrowserViewState } from "../src/shared/domain";
import { CH } from "../src/shared/ipc";

// Each test gets an isolated settings dir; the browser capability starts at
// its real default (disabled) and is enabled explicitly where needed.
beforeEach(() => {
  setSettingsDir(mkdtempSync(join(tmpdir(), "omp-studio-browser-ipc-")));
});

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

test("browser IPC forwards explicit diagnostics actions through the manager", async () => {
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
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) =>
        sends.push([channel, payload]),
    },
  } as unknown as BrowserWindow;
  const { ipcMain, invoke } = makeIpcMain();

  registerBrowserIpc(ipcMain, manager, () => win);

  // The gate reads real settings: enable the capability for this test.
  await updateSettings({ browser: { enabled: true } });
  expect(
    await invoke(CH.browserCreate, {
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

// ---------------------------------------------------------------------------
// AGE-802: browser:create is gated on the browser capability IN MAIN; destroy
// and teardown stay available while disabled.
// ---------------------------------------------------------------------------

test("browser:create rejects when the capability is disabled (default), destroy stays available", async () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const manager = {
    onState() {
      return () => {};
    },
    create() {
      calls.push(["create"]);
      return {} as BrowserViewState;
    },
    destroy(id: string) {
      calls.push(["destroy", id]);
    },
  } as unknown as BrowserViewManager;
  const { ipcMain, invoke } = makeIpcMain();
  registerBrowserIpc(ipcMain, manager, () => null);

  // Default settings: browser.enabled is false — create must reject in main
  // WITHOUT reaching the manager.
  await expect(
    invoke(CH.browserCreate, {
      url: "https://example.com",
      bounds: { x: 0, y: 0, width: 10, height: 10 },
    }) as Promise<unknown>,
  ).rejects.toThrow(/browser capability is disabled/);
  expect(calls).toEqual([]);

  // Teardown of a pre-existing view is NOT gated: a toggle-off must never
  // strand a live view.
  await invoke(CH.browserDestroy, "v1");
  expect(calls).toEqual([["destroy", "v1"]]);
});

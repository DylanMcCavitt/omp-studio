// Bridges the renderer's `window.omp.browser` surface to the main-process
// BrowserViewManager. The embedded views have NO IPC bridge of their own — ALL
// control (create/navigate/goBack/goForward/reload/setBounds/destroy) is driven
// here, by main, on behalf of the trusted main renderer. Per-view state changes
// are pushed back to the renderer over evt:browser-state, mirroring the chat
// frame-forwarding pattern (the registration layer owns webContents.send).

import { CH } from "@shared/ipc";
import type { BrowserWindow, IpcMain } from "electron";
import type { BrowserViewManager, ViewBounds } from "../browser/view-manager";
import { loadSettings } from "../services/settings-service";
import { sendToWindow } from "./send";

export function registerBrowserIpc(
  ipcMain: IpcMain,
  manager: BrowserViewManager,
  getWindow: () => BrowserWindow | null,
): void {
  manager.onState((state) =>
    sendToWindow(getWindow, CH.evtBrowserState, state),
  );

  // The embedded browser is a gated capability (off by default). Enforced in
  // MAIN on every create — the renderer toggle is only UX. Destroy/list/
  // teardown stay available while disabled so an in-flight view can always be
  // torn down after a toggle-off.
  ipcMain.handle(
    CH.browserCreate,
    async (_event, opts: { url: string; bounds: ViewBounds }) => {
      const settings = await loadSettings();
      if (settings.browser?.enabled !== true) {
        throw new Error("browser capability is disabled");
      }
      return manager.create(opts);
    },
  );
  ipcMain.handle(CH.browserNavigate, (_event, id: string, url: string) =>
    manager.navigate(id, url),
  );
  ipcMain.handle(CH.browserGoBack, (_event, id: string) => manager.goBack(id));
  ipcMain.handle(CH.browserGoForward, (_event, id: string) =>
    manager.goForward(id),
  );
  ipcMain.handle(CH.browserReload, (_event, id: string) => manager.reload(id));
  ipcMain.handle(CH.browserOpenDevTools, (_event, id: string) =>
    manager.openDevTools(id),
  );
  ipcMain.handle(CH.browserOpenExternal, (_event, id: string) =>
    manager.openExternal(id),
  );
  ipcMain.handle(
    CH.browserSetBounds,
    (_event, id: string, bounds: ViewBounds) => manager.setBounds(id, bounds),
  );
  ipcMain.handle(CH.browserDestroy, (_event, id: string) =>
    manager.destroy(id),
  );
}

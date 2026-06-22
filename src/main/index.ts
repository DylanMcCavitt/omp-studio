import { join } from "node:path";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { registerChatIpc } from "./ipc/chat";
import { registerDataIpc } from "./ipc/data";
import { registerSettingsIpc } from "./ipc/settings";
import { SessionRegistry } from "./omp/registry";
import { setSettingsDir } from "./services/settings-service";

let mainWindow: BrowserWindow | null = null;
const registry = new SessionRegistry();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0b0d12",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
    },
  });

  const smoke = process.env.OMP_STUDIO_SMOKE === "1";
  mainWindow.on("ready-to-show", () => {
    if (!smoke) mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Production diagnostics: surface renderer crashes and error-level console
  // output to the main-process log (also used as a boot smoke-test signal).
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[renderer] process gone: ${details.reason}`);
  });
  mainWindow.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) console.error(`[renderer] ${message}`);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[omp-studio] renderer loaded");
    if (smoke) console.log("[omp-studio] smoke ok");
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (is.dev && devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.ompstudio.app");
  app.on("browser-window-created", (_event, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  setSettingsDir(app.getPath("userData"));
  registerDataIpc(ipcMain);
  registerChatIpc(ipcMain, registry, () => mainWindow);
  registerSettingsIpc(ipcMain);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  registry.disposeAll();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  registry.disposeAll();
});

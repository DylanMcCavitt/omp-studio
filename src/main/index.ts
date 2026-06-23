import { join } from "node:path";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { registerChatIpc } from "./ipc/chat";
import { registerDataIpc } from "./ipc/data";
import { registerSettingsIpc } from "./ipc/settings";
import { scoped } from "./logger";
import { SessionRegistry } from "./omp/registry";
import { loadSettings, setSettingsDir } from "./services/settings-service";

let mainWindow: BrowserWindow | null = null;
const registry = new SessionRegistry();
const log = scoped("main");

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
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
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
    log.error("renderer process gone", { reason: details.reason });
  });
  mainWindow.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) log.error(`renderer: ${message}`);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    log.info("renderer loaded");
    if (smoke) log.info("smoke ok");
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

void app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.ompstudio.app");
  app.on("browser-window-created", (_event, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  setSettingsDir(app.getPath("userData"));
  // Seed the registry with persisted open-session descriptors so a fresh boot
  // lists them for resume (chat:list) and a later resume re-persists the FULL
  // set instead of clobbering the un-resumed descriptors. No children spawn —
  // the renderer resumes them on demand (D3r).
  registry.hydrate((await loadSettings()).openSessions);
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

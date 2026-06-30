import { join } from "node:path";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { BrowserViewManager } from "./browser/view-manager";
import { registerBrowserIpc } from "./ipc/browser";
import { registerChangesIpc } from "./ipc/changes";
import { registerChatIpc } from "./ipc/chat";
import { registerDataIpc } from "./ipc/data";
import { registerFilesIpc } from "./ipc/files";
import { registerLinearIpc } from "./ipc/linear";
import { registerSettingsIpc } from "./ipc/settings";
import { registerTerminalIpc } from "./ipc/terminal";
import { scoped } from "./logger";
import { SessionRegistry } from "./omp/registry";
import { loadSettings, setSettingsDir } from "./services/settings-service";
import { ExternalTerminalLaunchers } from "./terminal/external-launchers";
import { TerminalRegistry } from "./terminal/registry";

let mainWindow: BrowserWindow | null = null;
const registry = new SessionRegistry();
const terminals = new TerminalRegistry();
const externalTerminals = new ExternalTerminalLaunchers();
const browsers = new BrowserViewManager(() => mainWindow);
const log = scoped("main");

// The project root for skills/mcp/agents discovery (feat 6a/§4.4). In a packaged
// app process.cwd() is the launch dir, not the workspace, so project-scoped
// reads fall back to the most-recently-active chat session's cwd. Returns
// undefined when no session is tracked yet (services then use process.cwd()).
function activeSessionCwd(): string | undefined {
  let best: { cwd: string; at: string } | undefined;
  for (const session of registry.list()) {
    if (!best || session.lastActiveAt > best.at) {
      best = { cwd: session.cwd, at: session.lastActiveAt };
    }
  }
  return best?.cwd;
}

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

  // Harden against in-app navigation: the privileged main renderer must never
  // leave its local bundle. Any navigation attempt is denied and routed to the
  // OS browser. (The embedded browser feature is a separate, sandboxed
  // WebContentsView, not this window.)
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
    if (is.dev && rendererUrl && url.startsWith(rendererUrl)) return;
    event.preventDefault();
    void shell.openExternal(url);
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
  registerDataIpc(ipcMain, () => activeSessionCwd());
  // FS access is scoped only to a renderer-selected workspace root validated
  // against main-owned settings. No selected workspace => safe-empty, never a
  // fallback to an unrelated active chat cwd.
  registerFilesIpc(ipcMain);
  // Read-only local git diff, scoped to the same renderer-selected, settings
  // validated workspace root as Files. No selected workspace => safe-empty.
  registerChangesIpc(ipcMain);
  registerChatIpc(ipcMain, registry, () => mainWindow);
  registerSettingsIpc(ipcMain);
  registerLinearIpc(ipcMain);
  registerTerminalIpc(ipcMain, terminals, externalTerminals, () => mainWindow);
  registerBrowserIpc(ipcMain, browsers, () => mainWindow);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  registry.disposeAll();
  terminals.disposeAll();
  browsers.destroyAll();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  registry.disposeAll();
  terminals.disposeAll();
  browsers.destroyAll();
});

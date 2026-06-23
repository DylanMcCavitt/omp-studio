import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcMain } from "electron";
import { registerFilesIpc } from "../src/main/ipc/files";
import {
  defaultSettings,
  saveSettings,
  setSettingsDir,
} from "../src/main/services/settings-service";
import type { FileEntry } from "../src/shared/domain";
import { CH } from "../src/shared/ipc";

// AGE-634 regression: the Files pane is labeled with the renderer-selected
// workspace, so main must root file IPC calls in that selected workspace (after
// validating it against main-owned settings), not in whichever chat session was
// last active.

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

let dir: string;
let workspaceRoot: string;

beforeEach(() => {
  delete process.env.OMP_STUDIO_SETTINGS_DIR;
  dir = mkdtempSync(join(tmpdir(), "omp-studio-files-ipc-"));
  workspaceRoot = join(dir, "selected-workspace");
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(join(workspaceRoot, "selected.txt"), "selected", "utf8");
  setSettingsDir(join(dir, "settings"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("files IPC roots calls in the validated selected workspace, not active session cwd", async () => {
  await saveSettings({
    ...defaultSettings(),
    workspaces: [
      {
        id: "w1",
        cwd: workspaceRoot,
        label: "Selected workspace",
        pinned: false,
        lastUsedAt: "2026-06-23T00:00:00.000Z",
      },
    ],
  });
  const { ipcMain, invoke } = makeIpcMain();
  registerFilesIpc(ipcMain);

  const selected = (await invoke(
    CH.filesReadDir,
    undefined,
    workspaceRoot,
  )) as FileEntry[];
  expect(selected.map((e) => e.name)).toEqual(["selected.txt"]);

  const noRoot = (await invoke(CH.filesReadDir)) as FileEntry[];
  expect(noRoot).toEqual([]);

  const refused = (await invoke(
    CH.filesReadDir,
    undefined,
    join(dir, "not-in-settings"),
  )) as FileEntry[];
  expect(refused).toEqual([]);
});

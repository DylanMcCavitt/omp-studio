import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcMain } from "electron";
import { registerSettingsIpc } from "../src/main/ipc/settings";
import {
  defaultSettings,
  setSettingsDir,
} from "../src/main/services/settings-service";
import { CH, type StudioSettings } from "../src/shared/ipc";

// Settings IPC is the frozen renderer<->main settings API. The channel list is
// derived from shared/ipc.ts so an added settings:* channel fails here until the
// main wrapper registers it, and update uses a distinguishable patch so a
// marshalling bug is observable through the persisted settings contract.

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

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

function channelsWithPrefix(prefix: string): string[] {
  return Object.values(CH).filter((channel) => channel.startsWith(prefix));
}

let invoke: (channel: string, ...args: unknown[]) => unknown;
let registeredChannels: () => string[];
let settingsDir: string;

beforeEach(() => {
  settingsDir = mkdtempSync(join(tmpdir(), "omp-studio-settings-ipc-"));
  setSettingsDir(settingsDir);
  const harness = makeIpcMain();
  registerSettingsIpc(harness.ipcMain);
  invoke = harness.invoke;
  registeredChannels = harness.registeredChannels;
});

test("registers every settings:* channel declared in shared/ipc", () => {
  expect(registeredChannels()).toEqual(channelsWithPrefix("settings:"));
});

test("settings:get resolves to defaults for missing and corrupt settings stores", async () => {
  expect(await invoke(CH.settingsGet)).toEqual(defaultSettings());

  writeFileSync(
    join(settingsDir, "settings.json"),
    "{ not valid json ",
    "utf8",
  );
  expect(await invoke(CH.settingsGet)).toEqual(defaultSettings());
});

test("settings:update forwards the renderer patch and settings:get reads the updated store", async () => {
  const patch: Partial<StudioSettings> = {
    theme: "dark",
    defaultModel: "provider/sentinel-model-age-829",
    liveSessionLimit: 17,
  };

  const updated = (await invoke(CH.settingsUpdate, patch)) as StudioSettings;
  expect(updated.theme).toBe("dark");
  expect(updated.defaultModel).toBe("provider/sentinel-model-age-829");
  expect(updated.liveSessionLimit).toBe(17);

  const loaded = (await invoke(CH.settingsGet)) as StudioSettings;
  expect(loaded.theme).toBe("dark");
  expect(loaded.defaultModel).toBe("provider/sentinel-model-age-829");
  expect(loaded.liveSessionLimit).toBe(17);
});

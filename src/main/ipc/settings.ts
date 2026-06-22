// Bridges the renderer's `window.omp.settings` surface to the main-owned
// settings store. `settings:get` reads (defaults on missing/corrupt);
// `settings:update` merges a known-key patch, persists atomically, and returns
// the new settings.

import type { StudioSettingsV1 } from "@shared/ipc";
import { CH } from "@shared/ipc";
import type { IpcMain } from "electron";
import { loadSettings, updateSettings } from "../services/settings-service";

export function registerSettingsIpc(ipcMain: IpcMain): void {
  ipcMain.handle(CH.settingsGet, () => loadSettings());
  ipcMain.handle(
    CH.settingsUpdate,
    (_event, patch: Partial<StudioSettingsV1>) => updateSettings(patch),
  );
}

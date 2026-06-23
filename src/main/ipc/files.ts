import type { FileContent, FileEntry } from "@shared/domain";
import { CH } from "@shared/ipc";
import type { IpcMain } from "electron";
import { createFilesService } from "../services/files";
import { loadSettings } from "../services/settings-service";

// Wire the Files FS channels to the workspace-scoped service. Renderer supplies
// its selected workspace root, and main validates that root against main-owned
// settings before the service can touch the file system. No selected/known root
// means safe-empty; file editing never falls back to an unrelated active chat.
export function registerFilesIpc(ipcMain: IpcMain): void {
  const serviceFor = async (workspaceRoot?: string | null) => {
    const root = await resolveFilesRoot(workspaceRoot);
    return createFilesService(() => root);
  };

  ipcMain.handle(
    CH.filesReadDir,
    async (
      _event,
      relPath?: string,
      workspaceRoot?: string | null,
    ): Promise<FileEntry[]> => {
      try {
        return await (await serviceFor(workspaceRoot)).readDir(relPath);
      } catch {
        return [];
      }
    },
  );

  ipcMain.handle(
    CH.filesReadFile,
    async (
      _event,
      relPath: string,
      workspaceRoot?: string | null,
    ): Promise<FileContent | null> => {
      try {
        return await (await serviceFor(workspaceRoot)).readFile(relPath);
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    CH.filesWriteFile,
    async (
      _event,
      relPath: string,
      text: string,
      workspaceRoot?: string | null,
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        return await (await serviceFor(workspaceRoot)).writeFile(relPath, text);
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );
}

async function resolveFilesRoot(
  workspaceRoot: string | null | undefined,
): Promise<string | undefined> {
  if (
    workspaceRoot === undefined ||
    workspaceRoot === null ||
    workspaceRoot === ""
  ) {
    return undefined;
  }
  if (typeof workspaceRoot !== "string") return undefined;
  try {
    const settings = await loadSettings();
    const knownRoots = new Set<string>();
    if (settings.defaultProject) knownRoots.add(settings.defaultProject);
    for (const p of settings.recentProjects ?? []) knownRoots.add(p.cwd);
    for (const w of settings.workspaces ?? []) knownRoots.add(w.cwd);
    for (const s of settings.openSessions ?? []) knownRoots.add(s.cwd);
    return knownRoots.has(workspaceRoot) ? workspaceRoot : undefined;
  } catch {
    return undefined;
  }
}

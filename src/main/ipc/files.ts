import type { FileContent, FileEntry } from "@shared/domain";
import { CH } from "@shared/ipc";
import type { IpcMain } from "electron";
import { createFilesService } from "../services/files";

// Wire the Files FS channels to the workspace-scoped service. `getRoot` resolves
// the active workspace cwd (threaded from index.ts). The service already degrades
// safely, but each handler is wrapped so an unexpected throw still returns the
// channel's safe-empty shape rather than rejecting across IPC.
export function registerFilesIpc(
  ipcMain: IpcMain,
  getRoot: () => string | undefined,
): void {
  const files = createFilesService(getRoot);

  ipcMain.handle(
    CH.filesReadDir,
    async (_event, relPath?: string): Promise<FileEntry[]> => {
      try {
        return await files.readDir(relPath);
      } catch {
        return [];
      }
    },
  );

  ipcMain.handle(
    CH.filesReadFile,
    async (_event, relPath: string): Promise<FileContent | null> => {
      try {
        return await files.readFile(relPath);
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
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        return await files.writeFile(relPath, text);
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );
}

import type { ChangesStatus, FileDiff, GitWorkspaceInfo } from "@shared/domain";
import { CH } from "@shared/ipc";
import type { IpcMain } from "electron";
import { createChangesService } from "../services/changes";
import { resolveFilesRoot } from "./files";

// Wire the Changes git channels to a workspace-scoped, read-only service.
// Renderer supplies its selected workspace root; main validates that root
// against main-owned settings (the SAME authorization Files uses) before git
// can run. No selected/known root means safe-empty; git never runs in an
// unrelated path. Every handler degrades safely and never throws.
export function registerChangesIpc(ipcMain: IpcMain): void {
  const serviceFor = async (workspaceRoot?: string | null) => {
    const root = await resolveFilesRoot(workspaceRoot);
    return createChangesService(() => root);
  };

  ipcMain.handle(
    CH.changesStatus,
    async (_event, workspaceRoot?: string | null): Promise<ChangesStatus> => {
      try {
        return await (await serviceFor(workspaceRoot)).status();
      } catch {
        return { repo: false, files: [] };
      }
    },
  );

  ipcMain.handle(
    CH.changesWorkspaceInfo,
    async (
      _event,
      workspaceRoot?: string | null,
    ): Promise<GitWorkspaceInfo> => {
      try {
        return await (await serviceFor(workspaceRoot)).workspaceInfo();
      } catch {
        return { repo: false, branch: null, worktreePath: null };
      }
    },
  );

  ipcMain.handle(
    CH.changesDiff,
    async (
      _event,
      relPath: string,
      workspaceRoot?: string | null,
    ): Promise<FileDiff | null> => {
      try {
        return await (await serviceFor(workspaceRoot)).diff(relPath);
      } catch {
        return null;
      }
    },
  );
}

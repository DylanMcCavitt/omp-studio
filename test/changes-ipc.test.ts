import { beforeEach, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcMain } from "electron";
import { registerChangesIpc } from "../src/main/ipc/changes";
import {
  setSettingsDir,
  updateSettings,
} from "../src/main/services/settings-service";
import type {
  ChangesStatus,
  FileDiff,
  GitWorkspaceInfo,
} from "../src/shared/domain";
import { CH } from "../src/shared/ipc";

// Changes IPC is the renderer's read-only git boundary. The wrapper must expose
// every changes:* channel from shared/ipc.ts, thread the selected workspace root
// and relPath into the main-owned service, and degrade to the documented empty
// shapes when a workspace is not authorized/available.

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

function git(args: string, cwd: string): void {
  execSync(`git ${args}`, { stdio: ["ignore", "ignore", "ignore"], cwd });
}

function hasGit(): boolean {
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function createChangedRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "omp-studio-changes-ipc-repo-"));
  git("init -q", dir);
  git("config user.email ipc@example.test", dir);
  git("config user.name ipc", dir);
  git("config commit.gpgsign false", dir);
  writeFileSync(join(dir, "sentinel-modified.ts"), "alpha\nbeta\n", "utf8");
  git("add sentinel-modified.ts", dir);
  git("commit -q -m base", dir);
  git("checkout -q -b age-829-ipc", dir);
  writeFileSync(join(dir, "sentinel-modified.ts"), "alpha\nBETA\n", "utf8");
  return dir;
}

let invoke: (channel: string, ...args: unknown[]) => unknown;
let registeredChannels: () => string[];

beforeEach(() => {
  setSettingsDir(
    mkdtempSync(join(tmpdir(), "omp-studio-changes-ipc-settings-")),
  );
  const harness = makeIpcMain();
  registerChangesIpc(harness.ipcMain);
  invoke = harness.invoke;
  registeredChannels = harness.registeredChannels;
});

test("registers every changes:* channel declared in shared/ipc", () => {
  expect(registeredChannels()).toEqual(
    Object.values(CH).filter((channel) => channel.startsWith("changes:")),
  );
});

const gitTest = hasGit() ? test : test.skip;

gitTest(
  "forwards workspace roots and relPaths into the read-only changes service",
  async () => {
    const repo = createChangedRepo();
    try {
      await updateSettings({
        workspaces: [
          {
            id: "workspace-age-829",
            cwd: repo,
            label: "AGE-829 Repo",
            pinned: true,
            lastUsedAt: "2026-07-07T00:00:00.000Z",
          },
        ],
      });

      const status = (await invoke(CH.changesStatus, repo)) as ChangesStatus;
      expect(status.repo).toBe(true);
      expect(status.files).toEqual([
        { relPath: "sentinel-modified.ts", status: "modified" },
      ]);

      const info = (await invoke(
        CH.changesWorkspaceInfo,
        repo,
      )) as GitWorkspaceInfo;
      expect(info).toEqual({
        repo: true,
        branch: "age-829-ipc",
        worktreePath: realpathSync(repo),
      });

      const diff = (await invoke(
        CH.changesDiff,
        "sentinel-modified.ts",
        repo,
      )) as FileDiff | null;
      expect(diff?.relPath).toBe("sentinel-modified.ts");
      expect(diff?.binary).toBe(false);
      expect(
        diff?.hunks
          .flatMap((hunk) => hunk.lines)
          .filter((line) => line.type !== "context"),
      ).toEqual([
        { type: "remove", text: "beta" },
        { type: "add", text: "BETA" },
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  },
);

test("unauthorized or unavailable workspaces degrade to safe empty changes shapes", async () => {
  const unauthorizedRoot = mkdtempSync(
    join(tmpdir(), "omp-studio-changes-ipc-unauthorized-"),
  );
  try {
    expect(await invoke(CH.changesStatus, unauthorizedRoot)).toEqual({
      repo: false,
      files: [],
    });
    expect(await invoke(CH.changesWorkspaceInfo, unauthorizedRoot)).toEqual({
      repo: false,
      branch: null,
      worktreePath: null,
    });
    expect(
      await invoke(CH.changesDiff, "sentinel-modified.ts", unauthorizedRoot),
    ).toBeNull();
  } finally {
    rmSync(unauthorizedRoot, { recursive: true, force: true });
  }
});

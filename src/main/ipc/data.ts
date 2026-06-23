import type {
  DashboardData,
  ListSessionsOptions,
  ProjectSessions,
  SessionSearchOptions,
} from "@shared/domain";
import { CH } from "@shared/ipc";
import type { IpcMain } from "electron";
import { dialog, shell } from "electron";
import {
  listAgents,
  listMcpServers,
  listModels,
  listProviders,
  listSkills,
} from "../services/config-service";
import {
  currentRepo,
  listIssues,
  listPrs,
  listRepos,
} from "../services/github";
import {
  archiveSession,
  deleteSession,
  exportSessionHtml,
  listSessions,
  readSession,
  renameSession,
  revealSession,
  searchSessions,
  unarchiveSession,
} from "../services/session-store";

async function buildDashboard(cwd?: string): Promise<DashboardData> {
  const [sessions, models, mcp, skills, agents, repo, issues, prs] =
    await Promise.all([
      listSessions().catch(() => []),
      listModels().catch(() => []),
      listMcpServers(cwd).catch(() => []),
      listSkills(cwd).catch(() => []),
      listAgents(cwd).catch(() => []),
      currentRepo().catch(() => null),
      listIssues().catch(() => []),
      listPrs().catch(() => []),
    ]);

  const byProject: ProjectSessions[] = [];
  const index = new Map<string, number>();
  for (const session of sessions) {
    const at = index.get(session.project);
    if (at === undefined) {
      index.set(session.project, byProject.length);
      byProject.push({
        project: session.project,
        cwd: session.cwd,
        count: 1,
        lastActive: session.updatedAt,
      });
    } else {
      const group = byProject[at];
      // `at` was set when this group was pushed, so it always resolves.
      if (group) {
        group.count += 1;
        if (session.updatedAt > group.lastActive) {
          group.lastActive = session.updatedAt;
        }
      }
    }
  }

  return {
    sessions: {
      total: sessions.length,
      recent: sessions.slice(0, 6),
      byProject,
    },
    models: {
      total: models.length,
      providers: new Set(models.map((m) => m.provider)).size,
      default: models[0]?.selector,
    },
    mcp,
    skills: skills.length,
    agents: agents.length,
    github: {
      repo,
      openIssues: issues.filter((i) => i.state.toUpperCase() === "OPEN").length,
      openPrs: prs.filter((p) => p.state.toUpperCase() === "OPEN").length,
    },
    generatedAt: new Date().toISOString(),
  };
}

// `activeCwd` resolves the active workspace cwd for project-scoped reads
// (skills/mcp/agents/dashboard). It falls back to the most-recently-active chat
// session's cwd (threaded from index.ts); a renderer-supplied cwd always wins.
export function registerDataIpc(
  ipcMain: IpcMain,
  activeCwd: () => string | undefined = () => undefined,
): void {
  const resolveCwd = (cwd?: string): string | undefined => cwd ?? activeCwd();

  ipcMain.handle(CH.dashboard, () => buildDashboard(activeCwd()));

  ipcMain.handle(CH.listSessions, (_event, opts?: ListSessionsOptions) =>
    listSessions(opts),
  );
  ipcMain.handle(CH.readSession, (_event, path: string) => readSession(path));
  ipcMain.handle(
    CH.searchSessions,
    (_event, query: string, opts?: SessionSearchOptions) =>
      searchSessions(query, opts),
  );

  ipcMain.handle(CH.listMcp, (_event, cwd?: string) =>
    listMcpServers(resolveCwd(cwd)),
  );
  ipcMain.handle(CH.listSkills, (_event, cwd?: string) =>
    listSkills(resolveCwd(cwd)),
  );
  ipcMain.handle(CH.listAgents, (_event, cwd?: string) =>
    listAgents(resolveCwd(cwd)),
  );
  ipcMain.handle(CH.listModels, () => listModels());
  ipcMain.handle(CH.listProviders, () => listProviders());

  ipcMain.handle(CH.pickDirectory, async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
      });
      return result.filePaths[0] ?? null;
    } catch {
      return null;
    }
  });

  ipcMain.handle(CH.openExternal, async (_event, url: string) => {
    try {
      await shell.openExternal(url);
    } catch {
      // Opening a malformed/blocked URL must not reject across IPC.
    }
  });

  ipcMain.handle(CH.ghCurrentRepo, (_event, cwd?: string) => currentRepo(cwd));
  ipcMain.handle(CH.ghListRepos, () => listRepos());
  ipcMain.handle(CH.ghListIssues, (_event, repo?: string, cwd?: string) =>
    listIssues(repo, cwd),
  );
  ipcMain.handle(CH.ghListPrs, (_event, repo?: string, cwd?: string) =>
    listPrs(repo, cwd),
  );

  // session actions (mutating; operate on JSONL files). The electron `shell`
  // capabilities are injected here so the session-store service stays
  // electron-free and unit-testable.
  ipcMain.handle(CH.sessionRename, (_event, path: string, title: string) =>
    renameSession(path, title),
  );
  ipcMain.handle(CH.sessionDelete, (_event, path: string) =>
    deleteSession(path, (p) => shell.trashItem(p)),
  );
  ipcMain.handle(
    CH.sessionArchive,
    (_event, path: string, archived: boolean) =>
      archived ? archiveSession(path) : unarchiveSession(path),
  );
  ipcMain.handle(CH.sessionReveal, (_event, path: string) =>
    revealSession(path, (p) => shell.showItemInFolder(p)),
  );
  ipcMain.handle(CH.sessionExportHtml, (_event, path: string) =>
    exportSessionHtml(path),
  );
}

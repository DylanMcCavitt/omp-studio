import type { DashboardData, ProjectSessions } from "@shared/domain";
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
import { listSessions, readSession } from "../services/session-store";

async function buildDashboard(): Promise<DashboardData> {
  const [sessions, models, mcp, skills, agents, repo, issues, prs] =
    await Promise.all([
      listSessions().catch(() => []),
      listModels().catch(() => []),
      listMcpServers().catch(() => []),
      listSkills().catch(() => []),
      listAgents().catch(() => []),
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
      group.count += 1;
      if (session.updatedAt > group.lastActive) {
        group.lastActive = session.updatedAt;
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

export function registerDataIpc(ipcMain: IpcMain): void {
  ipcMain.handle(CH.dashboard, () => buildDashboard());

  ipcMain.handle(CH.listSessions, () => listSessions());
  ipcMain.handle(CH.readSession, (_event, path: string) => readSession(path));

  ipcMain.handle(CH.listMcp, () => listMcpServers());
  ipcMain.handle(CH.listSkills, () => listSkills());
  ipcMain.handle(CH.listAgents, () => listAgents());
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

  ipcMain.handle(CH.ghCurrentRepo, () => currentRepo());
  ipcMain.handle(CH.ghListRepos, () => listRepos());
  ipcMain.handle(CH.ghListIssues, (_event, repo?: string) => listIssues(repo));
  ipcMain.handle(CH.ghListPrs, (_event, repo?: string) => listPrs(repo));
}

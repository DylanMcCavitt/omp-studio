import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcMain } from "electron";
import type { DashboardData, SessionTranscript } from "../src/shared/domain";
import { CH } from "../src/shared/ipc";

// The browse/dashboard IPC surface must GRACEFULLY DEGRADE: every read/list
// handler resolves with a safe value ([]/null/well-formed) and NEVER rejects
// across the IPC boundary, even when the backing data is absent or unreadable.
// These drive the real registerDataIpc against a captured fake ipcMain (no
// electron runtime) with PI_CODING_AGENT_DIR pointed at an isolated temp dir, so
// the filesystem-backed services degrade deterministically regardless of host.
//
// data.ts value-imports electron `dialog`/`shell`; under bun (no electron
// runtime) electron has no such named exports, so it is stubbed before the
// module loads. mock.module must register before the import, which forces a
// dynamic import here (per the ts-no-dynamic-import test-boundary exception).
// data.ts's other deps (config-service/github/session-store) never touch
// electron, so the stub is fully contained.
mock.module("electron", () => ({
  dialog: { showOpenDialog: async () => ({ filePaths: [], canceled: true }) },
  shell: {
    openExternal: async () => {},
    trashItem: async () => {},
    showItemInFolder: () => {},
  },
}));
const { registerDataIpc } = await import("../src/main/ipc/data");

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

const ORIGINAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;
let agentRoot: string;
let invoke: (channel: string, ...args: unknown[]) => unknown;

beforeEach(() => {
  agentRoot = mkdtempSync(join(tmpdir(), "omp-studio-data-ipc-"));
  process.env.PI_CODING_AGENT_DIR = agentRoot;
  const harness = makeIpcMain();
  registerDataIpc(harness.ipcMain);
  invoke = harness.invoke;
});

afterAll(() => {
  if (ORIGINAL_AGENT_DIR === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = ORIGINAL_AGENT_DIR;
  }
});

test("the dashboard handler resolves to a well-formed payload and never throws", async () => {
  const data = (await invoke(CH.dashboard)) as DashboardData;

  // An empty agent dir means no sessions: counts/arrays degrade to safe zeros.
  expect(data.sessions.total).toBe(0);
  expect(data.sessions.recent).toEqual([]);
  expect(data.sessions.byProject).toEqual([]);

  // The omp/gh-backed sections may carry host data, but must always be the
  // correct, IPC-safe shape — never undefined, never a thrown rejection.
  expect(typeof data.models.total).toBe("number");
  expect(typeof data.models.providers).toBe("number");
  expect(Array.isArray(data.mcp)).toBe(true);
  expect(typeof data.skills).toBe("number");
  expect(typeof data.agents).toBe("number");
  expect(
    data.github.repo === null || typeof data.github.repo === "object",
  ).toBe(true);
  expect(typeof data.github.openIssues).toBe("number");
  expect(typeof data.github.openPrs).toBe("number");
  expect(typeof data.generatedAt).toBe("string");
});

test("listSessions returns [] when the sessions root is missing", async () => {
  // Fresh temp agent dir, no sessions/ subtree at all.
  await expect(invoke(CH.listSessions) as Promise<unknown>).resolves.toEqual(
    [],
  );
});

test("listSessions degrades to [] when the sessions root is unreadable", async () => {
  // A FILE where the sessions directory is expected: readdir throws, and the
  // service swallows it rather than rejecting across IPC.
  await writeFile(join(agentRoot, "sessions"), "not a directory", "utf8");
  await expect(invoke(CH.listSessions) as Promise<unknown>).resolves.toEqual(
    [],
  );
});

test("readSession degrades to an empty transcript for a missing file", async () => {
  const path = join(agentRoot, "sessions", "proj", "ghost.jsonl");
  const result = (await invoke(CH.readSession, path)) as SessionTranscript;
  expect(result.messages).toEqual([]);
  expect(result.summary.messageCount).toBe(0);
  expect(result.summary.id).toBe("ghost");
});

test("readSession degrades to an empty transcript when the path is a directory", async () => {
  // readFile on a directory rejects; readSession must catch and return empty.
  const dirPath = join(agentRoot, "sessions", "proj");
  await mkdir(dirPath, { recursive: true });
  const result = (await invoke(CH.readSession, dirPath)) as SessionTranscript;
  expect(result.messages).toEqual([]);
  expect(result.summary.messageCount).toBe(0);
});

test("searchSessions returns [] with no sessions to scan and never throws", async () => {
  await expect(
    invoke(CH.searchSessions, "anything") as Promise<unknown>,
  ).resolves.toEqual([]);
});

// ---- active-workspace cwd threading (feat 6a/§4.4) -----------------------
// The data handlers thread an optional cwd into the project-scoped reads,
// falling back to the active chat session's cwd when the renderer passes none.
// mcp is used as the probe: its project root is `<cwd>/.mcp.json` and its user
// root is agentDir()/mcp.json (the isolated temp), so the assertion never
// depends on host homedir state.

type McpRow = { name: string; source: string };

async function writeMcpProject(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, ".mcp.json"),
    JSON.stringify({ mcpServers: { [name]: { type: "stdio", command: "x" } } }),
  );
}

test("listMcp falls back to the active session cwd when the renderer passes none", async () => {
  const project = mkdtempSync(join(tmpdir(), "omp-studio-data-ipc-proj-"));
  await writeMcpProject(project, "active-cwd-srv");
  const harness = makeIpcMain();
  registerDataIpc(harness.ipcMain, () => project);

  const rows = (await harness.invoke(CH.listMcp)) as McpRow[];
  const found = rows.find((s) => s.name === "active-cwd-srv");
  expect(found?.source).toBe("project");
});

test("a renderer-supplied cwd overrides the active session cwd", async () => {
  const active = mkdtempSync(join(tmpdir(), "omp-studio-data-ipc-active-"));
  const explicit = mkdtempSync(join(tmpdir(), "omp-studio-data-ipc-explicit-"));
  await writeMcpProject(active, "active-srv");
  await writeMcpProject(explicit, "explicit-srv");
  const harness = makeIpcMain();
  registerDataIpc(harness.ipcMain, () => active);

  const rows = (await harness.invoke(CH.listMcp, explicit)) as McpRow[];
  expect(rows.find((s) => s.name === "explicit-srv")).toBeDefined();
  expect(rows.find((s) => s.name === "active-srv")).toBeUndefined();
});

test("the dashboard reads project mcp under the active session cwd", async () => {
  const project = mkdtempSync(join(tmpdir(), "omp-studio-data-ipc-dash-"));
  await writeMcpProject(project, "dash-srv");
  const harness = makeIpcMain();
  registerDataIpc(harness.ipcMain, () => project);

  const data = (await harness.invoke(CH.dashboard)) as DashboardData;
  expect(data.mcp.find((s) => s.name === "dash-srv")).toBeDefined();
});

import type {
  BrowserViewState,
  ListSessionsOptions,
  SessionSearchOptions,
} from "@shared/domain";
import type {
  ChatCreateOptions,
  ChatLifecycleEvent,
  ChatRpcEvent,
  ChatUiRequestEvent,
  ChatUiRespondPayload,
  ExternalTerminalProfile,
  OmpApi,
  OpenSessionDescriptor,
  PromptOptions,
  StudioSettings,
} from "@shared/ipc";
import { CH } from "@shared/ipc";
import type { SubagentSubscriptionLevel, ThinkingLevel } from "@shared/rpc";
import { contextBridge, ipcRenderer } from "electron";

// One IPC listener per channel, fanning out to a set of renderer subscribers.
// Gap 18 fix: many onEvent/onLifecycle/onUiRequest callbacks must NOT stack
// duplicate `ipcRenderer.on` listeners (each would re-deliver every frame). We
// bind exactly one IPC listener per channel on the first subscribe and remove it
// when the last subscriber leaves, so every returned unsubscribe is real and the
// channel never double-registers.
function channelSubscription<T>(
  channel: string,
): (cb: (payload: T) => void) => () => void {
  const subscribers = new Set<(payload: T) => void>();
  const onIpc = (_e: unknown, payload: T): void => {
    for (const cb of subscribers) cb(payload);
  };
  return (cb) => {
    subscribers.add(cb);
    if (subscribers.size === 1) ipcRenderer.on(channel, onIpc);
    return () => {
      if (!subscribers.delete(cb)) return;
      if (subscribers.size === 0) ipcRenderer.removeListener(channel, onIpc);
    };
  };
}

const onRpcEvent = channelSubscription<ChatRpcEvent>(CH.evtRpc);
const onLifecycleEvent = channelSubscription<ChatLifecycleEvent>(
  CH.evtLifecycle,
);
const onUiRequestEvent = channelSubscription<ChatUiRequestEvent>(
  CH.evtUiRequest,
);
const onTerminalData = channelSubscription<{ id: string; data: string }>(
  CH.evtTerminalData,
);
const onTerminalExit = channelSubscription<{ id: string; code: number | null }>(
  CH.evtTerminalExit,
);
const onBrowserState = channelSubscription<BrowserViewState>(
  CH.evtBrowserState,
);

const api: OmpApi = {
  getDashboard: () => ipcRenderer.invoke(CH.dashboard),
  listSessions: (opts?: ListSessionsOptions) =>
    ipcRenderer.invoke(CH.listSessions, opts),
  readSession: (path: string) => ipcRenderer.invoke(CH.readSession, path),
  listMcpServers: (cwd?: string) => ipcRenderer.invoke(CH.listMcp, cwd),
  listSkills: (cwd?: string) => ipcRenderer.invoke(CH.listSkills, cwd),
  listAgents: (cwd?: string) => ipcRenderer.invoke(CH.listAgents, cwd),
  listModels: () => ipcRenderer.invoke(CH.listModels),
  listProviders: () => ipcRenderer.invoke(CH.listProviders),
  pickDirectory: () => ipcRenderer.invoke(CH.pickDirectory),
  openExternal: (url: string) => ipcRenderer.invoke(CH.openExternal, url),
  searchSessions: (query: string, opts?: SessionSearchOptions) =>
    ipcRenderer.invoke(CH.searchSessions, query, opts),

  github: {
    currentRepo: (cwd?: string) => ipcRenderer.invoke(CH.ghCurrentRepo, cwd),
    listRepos: () => ipcRenderer.invoke(CH.ghListRepos),
    listIssues: (repo?: string, cwd?: string) =>
      ipcRenderer.invoke(CH.ghListIssues, repo, cwd),
    listPullRequests: (repo?: string, cwd?: string) =>
      ipcRenderer.invoke(CH.ghListPrs, repo, cwd),
  },

  chat: {
    create: (opts: ChatCreateOptions) =>
      ipcRenderer.invoke(CH.chatCreate, opts),
    prompt: (sessionId: string, message: string, opts?: PromptOptions) =>
      ipcRenderer.invoke(CH.chatPrompt, sessionId, message, opts),
    steer: (sessionId: string, message: string) =>
      ipcRenderer.invoke(CH.chatSteer, sessionId, message),
    followUp: (sessionId: string, message: string) =>
      ipcRenderer.invoke(CH.chatFollowUp, sessionId, message),
    abort: (sessionId: string) => ipcRenderer.invoke(CH.chatAbort, sessionId),
    setModel: (sessionId: string, provider: string, modelId: string) =>
      ipcRenderer.invoke(CH.chatSetModel, sessionId, provider, modelId),
    setThinking: (sessionId: string, level: ThinkingLevel) =>
      ipcRenderer.invoke(CH.chatSetThinking, sessionId, level),
    getState: (sessionId: string) =>
      ipcRenderer.invoke(CH.chatGetState, sessionId),
    getMessages: (sessionId: string) =>
      ipcRenderer.invoke(CH.chatGetMessages, sessionId),
    getSubagents: (sessionId: string) =>
      ipcRenderer.invoke(CH.chatGetSubagents, sessionId),
    setSubagentSubscription: (
      sessionId: string,
      level: SubagentSubscriptionLevel,
    ) => ipcRenderer.invoke(CH.chatSetSubagentSubscription, sessionId, level),
    getSubagentMessages: (
      sessionId: string,
      sel: { subagentId?: string; sessionFile?: string; fromByte?: number },
    ) => ipcRenderer.invoke(CH.chatGetSubagentMessages, sessionId, sel),
    getAvailableCommands: (sessionId: string) =>
      ipcRenderer.invoke(CH.chatGetAvailableCommands, sessionId),
    dispose: (sessionId: string) =>
      ipcRenderer.invoke(CH.chatDispose, sessionId),
    onEvent: onRpcEvent,
    onLifecycle: onLifecycleEvent,
    onUiRequest: onUiRequestEvent,
    respondUiRequest: (payload: ChatUiRespondPayload) =>
      ipcRenderer.invoke(CH.chatRespondUi, payload),
    getSessionStats: (sessionId: string) =>
      ipcRenderer.invoke(CH.chatGetSessionStats, sessionId),
    compact: (sessionId: string, instructions?: string) =>
      ipcRenderer.invoke(CH.chatCompact, sessionId, instructions),
    list: () => ipcRenderer.invoke(CH.chatList),
    resume: (descriptor: OpenSessionDescriptor) =>
      ipcRenderer.invoke(CH.chatResume, descriptor),
    close: (sessionId: string) => ipcRenderer.invoke(CH.chatClose, sessionId),
  },

  linear: {
    status: () => ipcRenderer.invoke(CH.linearStatus),
    setApiKey: (key: string) => ipcRenderer.invoke(CH.linearSetApiKey, key),
    clearApiKey: () => ipcRenderer.invoke(CH.linearClearApiKey),
    listTeams: () => ipcRenderer.invoke(CH.linearListTeams),
    listProjects: (teamId?: string) =>
      ipcRenderer.invoke(CH.linearListProjects, teamId),
    listIssues: (opts?: {
      teamId?: string;
      assignedToMe?: boolean;
      limit?: number;
    }) => ipcRenderer.invoke(CH.linearListIssues, opts),
    getIssue: (id: string) => ipcRenderer.invoke(CH.linearGetIssue, id),
    createIssue: (input: {
      teamId: string;
      title: string;
      description?: string;
    }) => ipcRenderer.invoke(CH.linearCreateIssue, input),
    updateIssue: (
      id: string,
      patch: { stateId?: string; title?: string; description?: string },
    ) => ipcRenderer.invoke(CH.linearUpdateIssue, id, patch),
    createComment: (issueId: string, body: string) =>
      ipcRenderer.invoke(CH.linearCreateComment, issueId, body),
  },

  terminal: {
    create: (opts: { cwd: string; cols: number; rows: number }) =>
      ipcRenderer.invoke(CH.terminalCreate, opts),
    write: (id: string, data: string) =>
      ipcRenderer.invoke(CH.terminalWrite, id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke(CH.terminalResize, id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke(CH.terminalKill, id),
    list: () => ipcRenderer.invoke(CH.terminalList),
    externalLaunchers: () => ipcRenderer.invoke(CH.terminalExternalLaunchers),
    openExternal: (opts: { cwd: string; profile?: ExternalTerminalProfile }) =>
      ipcRenderer.invoke(CH.terminalOpenExternal, opts),
    onData: onTerminalData,
    onExit: onTerminalExit,
  },

  browser: {
    create: (opts: {
      url: string;
      bounds: { x: number; y: number; width: number; height: number };
    }) => ipcRenderer.invoke(CH.browserCreate, opts),
    navigate: (id: string, url: string) =>
      ipcRenderer.invoke(CH.browserNavigate, id, url),
    goBack: (id: string) => ipcRenderer.invoke(CH.browserGoBack, id),
    goForward: (id: string) => ipcRenderer.invoke(CH.browserGoForward, id),
    reload: (id: string) => ipcRenderer.invoke(CH.browserReload, id),
    openDevTools: (id: string) =>
      ipcRenderer.invoke(CH.browserOpenDevTools, id),
    openExternal: (id: string) =>
      ipcRenderer.invoke(CH.browserOpenExternal, id),
    setBounds: (
      id: string,
      bounds: { x: number; y: number; width: number; height: number },
    ) => ipcRenderer.invoke(CH.browserSetBounds, id, bounds),
    destroy: (id: string) => ipcRenderer.invoke(CH.browserDestroy, id),
    onState: onBrowserState,
  },

  settings: {
    get: () => ipcRenderer.invoke(CH.settingsGet),
    update: (patch: Partial<StudioSettings>) =>
      ipcRenderer.invoke(CH.settingsUpdate, patch),
  },

  session: {
    rename: (path: string, title: string) =>
      ipcRenderer.invoke(CH.sessionRename, path, title),
    delete: (path: string) => ipcRenderer.invoke(CH.sessionDelete, path),
    archive: (path: string) =>
      ipcRenderer.invoke(CH.sessionArchive, path, true),
    unarchive: (path: string) =>
      ipcRenderer.invoke(CH.sessionArchive, path, false),
    reveal: (path: string) => ipcRenderer.invoke(CH.sessionReveal, path),
    exportHtml: (path: string) =>
      ipcRenderer.invoke(CH.sessionExportHtml, path),
  },

  files: {
    readDir: (relPath?: string, workspaceRoot?: string | null) =>
      ipcRenderer.invoke(CH.filesReadDir, relPath, workspaceRoot),
    readFile: (relPath: string, workspaceRoot?: string | null) =>
      ipcRenderer.invoke(CH.filesReadFile, relPath, workspaceRoot),
    writeFile: (relPath: string, text: string, workspaceRoot?: string | null) =>
      ipcRenderer.invoke(CH.filesWriteFile, relPath, text, workspaceRoot),
  },

  changes: {
    status: (workspaceRoot?: string | null) =>
      ipcRenderer.invoke(CH.changesStatus, workspaceRoot),
    workspaceInfo: (workspaceRoot?: string | null) =>
      ipcRenderer.invoke(CH.changesWorkspaceInfo, workspaceRoot),
    diff: (relPath: string, workspaceRoot?: string | null) =>
      ipcRenderer.invoke(CH.changesDiff, relPath, workspaceRoot),
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("omp", api);
} else {
  // Fallback for non-isolated contexts (not used in production).
  (globalThis as unknown as { omp: OmpApi }).omp = api;
}

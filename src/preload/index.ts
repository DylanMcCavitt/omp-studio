import type { ListSessionsOptions, SessionSearchOptions } from "@shared/domain";
import type {
  ChatCreateOptions,
  ChatLifecycleEvent,
  ChatRpcEvent,
  ChatUiRequestEvent,
  ChatUiRespondPayload,
  OmpApi,
  OpenSessionDescriptor,
  PromptOptions,
  StudioSettingsV1,
} from "@shared/ipc";
import { CH } from "@shared/ipc";
import type { ThinkingLevel } from "@shared/rpc";
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

const api: OmpApi = {
  getDashboard: () => ipcRenderer.invoke(CH.dashboard),
  listSessions: (opts?: ListSessionsOptions) =>
    ipcRenderer.invoke(CH.listSessions, opts),
  readSession: (path: string) => ipcRenderer.invoke(CH.readSession, path),
  listMcpServers: () => ipcRenderer.invoke(CH.listMcp),
  listSkills: () => ipcRenderer.invoke(CH.listSkills),
  listAgents: () => ipcRenderer.invoke(CH.listAgents),
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

  settings: {
    get: () => ipcRenderer.invoke(CH.settingsGet),
    update: (patch: Partial<StudioSettingsV1>) =>
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
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("omp", api);
} else {
  // Fallback for non-isolated contexts (not used in production).
  (globalThis as unknown as { omp: OmpApi }).omp = api;
}

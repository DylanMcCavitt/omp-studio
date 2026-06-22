import { contextBridge, ipcRenderer } from "electron";
import { CH } from "@shared/ipc";
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
import type { SessionSearchOptions } from "@shared/domain";
import type { ThinkingLevel } from "@shared/rpc";

const api: OmpApi = {
  getDashboard: () => ipcRenderer.invoke(CH.dashboard),
  listSessions: () => ipcRenderer.invoke(CH.listSessions),
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
    currentRepo: () => ipcRenderer.invoke(CH.ghCurrentRepo),
    listRepos: () => ipcRenderer.invoke(CH.ghListRepos),
    listIssues: (repo?: string) => ipcRenderer.invoke(CH.ghListIssues, repo),
    listPullRequests: (repo?: string) => ipcRenderer.invoke(CH.ghListPrs, repo),
  },

  chat: {
    create: (opts: ChatCreateOptions) => ipcRenderer.invoke(CH.chatCreate, opts),
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
    getState: (sessionId: string) => ipcRenderer.invoke(CH.chatGetState, sessionId),
    getMessages: (sessionId: string) =>
      ipcRenderer.invoke(CH.chatGetMessages, sessionId),
    getSubagents: (sessionId: string) =>
      ipcRenderer.invoke(CH.chatGetSubagents, sessionId),
    dispose: (sessionId: string) => ipcRenderer.invoke(CH.chatDispose, sessionId),
    onEvent: (cb: (e: ChatRpcEvent) => void) => {
      const listener = (_e: unknown, payload: ChatRpcEvent) => cb(payload);
      ipcRenderer.on(CH.evtRpc, listener);
      return () => ipcRenderer.removeListener(CH.evtRpc, listener);
    },
    onLifecycle: (cb: (e: ChatLifecycleEvent) => void) => {
      const listener = (_e: unknown, payload: ChatLifecycleEvent) => cb(payload);
      ipcRenderer.on(CH.evtLifecycle, listener);
      return () => ipcRenderer.removeListener(CH.evtLifecycle, listener);
    },
    onUiRequest: (cb: (e: ChatUiRequestEvent) => void) => {
      const listener = (_e: unknown, payload: ChatUiRequestEvent) => cb(payload);
      ipcRenderer.on(CH.evtUiRequest, listener);
      return () => ipcRenderer.removeListener(CH.evtUiRequest, listener);
    },
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
    archive: (path: string) => ipcRenderer.invoke(CH.sessionArchive, path, true),
    unarchive: (path: string) =>
      ipcRenderer.invoke(CH.sessionArchive, path, false),
    reveal: (path: string) => ipcRenderer.invoke(CH.sessionReveal, path),
    exportHtml: (path: string) => ipcRenderer.invoke(CH.sessionExportHtml, path),
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("omp", api);
} else {
  // Fallback for non-isolated contexts (not used in production).
  (globalThis as unknown as { omp: OmpApi }).omp = api;
}

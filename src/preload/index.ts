import { contextBridge, ipcRenderer } from "electron";
import { CH } from "@shared/ipc";
import type {
  ChatCreateOptions,
  ChatLifecycleEvent,
  ChatRpcEvent,
  OmpApi,
  PromptOptions,
} from "@shared/ipc";
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
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("omp", api);
} else {
  // Fallback for non-isolated contexts (not used in production).
  (globalThis as unknown as { omp: OmpApi }).omp = api;
}

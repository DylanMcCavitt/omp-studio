// The IPC contract between the renderer (via the preload `window.omp` bridge)
// and the main process. Channel names live in `CH`; the typed surface lives in
// `OmpApi`. Both sides import these so the contract stays in sync.

import type {
  AgentInfo,
  DashboardData,
  GhIssue,
  GhPr,
  GhRepo,
  McpServerInfo,
  ModelInfo,
  ProviderInfo,
  SessionSearchHit,
  SessionSearchOptions,
  SessionSummary,
  SessionTranscript,
  SkillInfo,
} from "./domain";
import type {
  ApprovalMode,
  ApprovalPolicy,
  ExtensionUiRequest,
  ExtensionUiResponse,
  ImageContent,
  OmpMessage,
  RpcFrame,
  RpcState,
  SessionStats,
  SubagentInfo,
  ThinkingLevel,
} from "./rpc";

export const CH = {
  // read-only data services
  dashboard: "data:dashboard",
  listSessions: "data:sessions:list",
  readSession: "data:sessions:read",
  listMcp: "data:mcp:list",
  listSkills: "data:skills:list",
  listAgents: "data:agents:list",
  listModels: "data:models:list",
  listProviders: "data:providers:list",
  pickDirectory: "data:pickDirectory",
  openExternal: "data:openExternal",
  searchSessions: "data:searchSessions",
  // github
  ghCurrentRepo: "gh:currentRepo",
  ghListRepos: "gh:repos",
  ghListIssues: "gh:issues",
  ghListPrs: "gh:prs",
  // session actions (mutating; operate on JSONL files)
  sessionRename: "data:sessions:rename",
  sessionDelete: "data:sessions:delete",
  sessionArchive: "data:sessions:archive",
  sessionReveal: "data:sessions:reveal",
  sessionExportHtml: "data:sessions:exportHtml",
  // settings store
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  // chat / rpc bridge (request/response)
  chatCreate: "chat:create",
  chatPrompt: "chat:prompt",
  chatSteer: "chat:steer",
  chatFollowUp: "chat:followUp",
  chatAbort: "chat:abort",
  chatSetModel: "chat:setModel",
  chatSetThinking: "chat:setThinking",
  chatGetState: "chat:getState",
  chatGetMessages: "chat:getMessages",
  chatGetSubagents: "chat:getSubagents",
  chatDispose: "chat:dispose",
  chatList: "chat:list",
  chatResume: "chat:resume",
  chatClose: "chat:close",
  chatRespondUi: "chat:uiRespond",
  chatGetSessionStats: "chat:getSessionStats",
  chatCompact: "chat:compact",
  // chat / rpc bridge (events main -> renderer)
  evtRpc: "evt:rpc",
  evtLifecycle: "evt:lifecycle",
  evtUiRequest: "evt:ui-request",
} as const;

export type ChannelName = (typeof CH)[keyof typeof CH];

// ---------------------------------------------------------------------------
// Chat option payloads
// ---------------------------------------------------------------------------

export interface ChatCreateOptions {
  /** working directory the omp rpc session runs in */
  cwd: string;
  /** optional model selector, e.g. "anthropic/claude-opus-4-8" */
  model?: string;
  thinkingLevel?: ThinkingLevel;
  /** per-session approval policy applied to the rpc-ui child */
  approvalPolicy?: ApprovalPolicy;
}

export interface ChatCreateResult {
  sessionId: string;
  state: RpcState;
}

export interface PromptOptions {
  images?: ImageContent[];
  /** required when the session is already streaming */
  streamingBehavior?: "steer" | "followUp";
}

/** A bridge session lifecycle status pushed over `evt:lifecycle`. */
export type ChatLifecycleStatus =
  | "spawning"
  | "ready"
  | "exited"
  | "error";

export interface ChatLifecycleEvent {
  sessionId: string;
  status: ChatLifecycleStatus;
  detail?: string;
}

export interface ChatRpcEvent {
  sessionId: string;
  frame: RpcFrame;
}

// ---------------------------------------------------------------------------
// UI-request events (`evt:ui-request` / `chat:uiRespond`)
// ---------------------------------------------------------------------------

export interface ChatUiRequestEvent {
  sessionId: string;
  request: ExtensionUiRequest;
  responseRequired: boolean;
}

export interface ChatUiRespondPayload {
  sessionId: string;
  requestId: string;
  response: ExtensionUiResponse;
}

// ---------------------------------------------------------------------------
// Settings & open-session descriptors (main-owned, persisted to userData)
// ---------------------------------------------------------------------------

export type ThemeMode = "system" | "dark" | "light";

export interface RecentProject {
  cwd: string;
  label: string;
  lastUsedAt: string;
}

export interface OpenSessionDescriptor {
  studioSessionId: string;
  cwd: string;
  createdAt: string;
  lastActiveAt: string;
  title: string | null;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  approvalPolicy: ApprovalPolicy;
  sessionFile?: string;
  ompSessionId?: string;
  status: "open" | "hibernated" | "closed";
}

export interface StudioSettingsV1 {
  version: 1;
  theme: ThemeMode;
  defaultProject: string | null;
  defaultModel: string | null;
  defaultThinkingLevel: ThinkingLevel;
  defaultApprovalMode: ApprovalMode;
  defaultAutoApprove: boolean;
  liveSessionLimit: number;
  recentProjects: RecentProject[];
  openSessions: OpenSessionDescriptor[];
}

// ---------------------------------------------------------------------------
// The bridge exposed to the renderer as `window.omp`
// ---------------------------------------------------------------------------

export interface OmpApi {
  getDashboard(): Promise<DashboardData>;
  listSessions(): Promise<SessionSummary[]>;
  readSession(path: string): Promise<SessionTranscript>;
  searchSessions(
    query: string,
    opts?: SessionSearchOptions,
  ): Promise<SessionSearchHit[]>;
  listMcpServers(): Promise<McpServerInfo[]>;
  listSkills(): Promise<SkillInfo[]>;
  listAgents(): Promise<AgentInfo[]>;
  listModels(): Promise<ModelInfo[]>;
  listProviders(): Promise<ProviderInfo[]>;
  pickDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<void>;

  github: {
    currentRepo(): Promise<GhRepo | null>;
    listRepos(): Promise<GhRepo[]>;
    listIssues(repo?: string): Promise<GhIssue[]>;
    listPullRequests(repo?: string): Promise<GhPr[]>;
  };

  chat: {
    create(opts: ChatCreateOptions): Promise<ChatCreateResult>;
    prompt(
      sessionId: string,
      message: string,
      opts?: PromptOptions,
    ): Promise<void>;
    steer(sessionId: string, message: string): Promise<void>;
    followUp(sessionId: string, message: string): Promise<void>;
    abort(sessionId: string): Promise<void>;
    setModel(
      sessionId: string,
      provider: string,
      modelId: string,
    ): Promise<void>;
    setThinking(sessionId: string, level: ThinkingLevel): Promise<void>;
    getState(sessionId: string): Promise<RpcState>;
    getMessages(sessionId: string): Promise<OmpMessage[]>;
    getSubagents(sessionId: string): Promise<SubagentInfo[]>;
    dispose(sessionId: string): Promise<void>;
    onEvent(cb: (e: ChatRpcEvent) => void): () => void;
    onLifecycle(cb: (e: ChatLifecycleEvent) => void): () => void;
    onUiRequest(cb: (e: ChatUiRequestEvent) => void): () => void;
    respondUiRequest(payload: ChatUiRespondPayload): Promise<void>;
    getSessionStats(sessionId: string): Promise<SessionStats>;
    compact(sessionId: string, instructions?: string): Promise<void>;
    list(): Promise<OpenSessionDescriptor[]>;
    resume(descriptor: OpenSessionDescriptor): Promise<ChatCreateResult>;
    close(sessionId: string): Promise<void>;
  };

  settings: {
    get(): Promise<StudioSettingsV1>;
    update(patch: Partial<StudioSettingsV1>): Promise<StudioSettingsV1>;
  };

  session: {
    rename(path: string, title: string): Promise<void>;
    delete(path: string): Promise<void>;
    archive(path: string): Promise<void>;
    unarchive(path: string): Promise<void>;
    reveal(path: string): Promise<void>;
    exportHtml(path: string): Promise<string>;
  };
}

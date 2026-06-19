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
  SessionSummary,
  SessionTranscript,
  SkillInfo,
} from "./domain";
import type {
  RpcFrame,
  RpcState,
  SubagentInfo,
  ThinkingLevel,
  OmpMessage,
  ImageContent,
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
  // github
  ghCurrentRepo: "gh:currentRepo",
  ghListRepos: "gh:repos",
  ghListIssues: "gh:issues",
  ghListPrs: "gh:prs",
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
  // chat / rpc bridge (events main -> renderer)
  evtRpc: "evt:rpc",
  evtLifecycle: "evt:lifecycle",
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
// The bridge exposed to the renderer as `window.omp`
// ---------------------------------------------------------------------------

export interface OmpApi {
  getDashboard(): Promise<DashboardData>;
  listSessions(): Promise<SessionSummary[]>;
  readSession(path: string): Promise<SessionTranscript>;
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
  };
}

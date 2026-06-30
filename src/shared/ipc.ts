// The IPC contract between the renderer (via the preload `window.omp` bridge)
// and the main process. Channel names live in `CH`; the typed surface lives in
// `OmpApi`. Both sides import these so the contract stays in sync.

import type {
  AgentInfo,
  BrowserViewState,
  ChangesStatus,
  DashboardData,
  FileContent,
  FileDiff,
  FileEntry,
  GhIssue,
  GhPr,
  GhRepo,
  GitWorkspaceInfo,
  LinearIssue,
  LinearProjectInfo,
  LinearStatusInfo,
  LinearTeam,
  ListSessionsOptions,
  McpServerInfo,
  ModelInfo,
  ProviderInfo,
  SessionSearchHit,
  SessionSearchOptions,
  SessionSummary,
  SessionTranscript,
  SkillInfo,
  TerminalInfo,
} from "./domain";
import type {
  ApprovalMode,
  ApprovalPolicy,
  AvailableSlashCommand,
  ExtensionUiRequest,
  ExtensionUiResponse,
  ImageContent,
  OmpMessage,
  RpcFrame,
  RpcState,
  SessionStats,
  SubagentInfo,
  SubagentMessagesResult,
  SubagentSubscriptionLevel,
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
  // chat / rpc bridge — subagent drill-in + commands palette
  // (req/resp; live frames reuse evt:rpc)
  chatSetSubagentSubscription: "chat:setSubagentSubscription",
  chatGetSubagentMessages: "chat:getSubagentMessages",
  chatGetAvailableCommands: "chat:getAvailableCommands",
  // chat / rpc bridge (events main -> renderer)
  evtRpc: "evt:rpc",
  evtLifecycle: "evt:lifecycle",
  evtUiRequest: "evt:ui-request",
  // feature 2 — Linear integration (req/resp; HTTP happens in main only)
  linearStatus: "linear:status",
  linearSetApiKey: "linear:setApiKey",
  linearClearApiKey: "linear:clearApiKey",
  linearListTeams: "linear:teams",
  linearListProjects: "linear:projects",
  linearListIssues: "linear:issues",
  linearGetIssue: "linear:issue",
  // feature 2 — optional Linear CRUD (gated behind settings.linear.writesEnabled)
  linearCreateIssue: "linear:createIssue",
  linearUpdateIssue: "linear:updateIssue",
  linearCreateComment: "linear:createComment",
  // feature 7 — terminal (req/resp + high-frequency data/exit events)
  terminalCreate: "terminal:create",
  terminalWrite: "terminal:write",
  terminalResize: "terminal:resize",
  terminalKill: "terminal:kill",
  terminalList: "terminal:list",
  evtTerminalData: "evt:terminal-data",
  evtTerminalExit: "evt:terminal-exit",
  // feature 8 — embedded browser (req/resp + view-state events)
  browserCreate: "browser:create",
  browserNavigate: "browser:navigate",
  browserGoBack: "browser:goBack",
  browserGoForward: "browser:goForward",
  browserReload: "browser:reload",
  browserOpenDevTools: "browser:openDevTools",
  browserOpenExternal: "browser:openExternal",
  browserSetBounds: "browser:setBounds",
  browserDestroy: "browser:destroy",
  evtBrowserState: "evt:browser-state",
  // feature 4 — files (req/resp; FS access scoped to the active workspace cwd)
  filesReadDir: "files:readDir",
  filesReadFile: "files:readFile",
  filesWriteFile: "files:writeFile",
  // feature 9 — changes (req/resp; read-only git diff scoped to active workspace cwd)
  changesStatus: "changes:status",
  changesWorkspaceInfo: "changes:workspaceInfo",
  changesDiff: "changes:diff",
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
export type ChatLifecycleStatus = "spawning" | "ready" | "exited" | "error";

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
// Settings V2 — additive bump (version: 2). Every new field is optional so a
// persisted V1 file (and any partial `update` patch) stays valid. The Linear
// API key NEVER lives here; `linear` holds non-secret metadata only.
// ---------------------------------------------------------------------------

/**
 * Curated per-workspace color keys (AGE-671). The renderer maps each key to a
 * swatch value; main only needs the key set to validate persisted data without
 * importing renderer-only presentation.
 */
export const WORKSPACE_COLOR_KEYS = [
  "slate",
  "red",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;

export type WorkspaceColorKey = (typeof WORKSPACE_COLOR_KEYS)[number];

/** A first-class project workspace (feature 1; supersedes RecentProject). */
export interface Workspace {
  /** Stable uuid; survives label/prefs across an explicit cwd edit. */
  id: string;
  cwd: string;
  /** Display label; defaults to the project basename, user-overridable. */
  label: string;
  pinned: boolean;
  lastUsedAt: string;
  /** Optional curated color key for at-a-glance distinction; absent = no color. */
  color?: WorkspaceColorKey;
}

/** Persisted shell layout (feature 5; resizable splits + nav/rail prefs). */
export interface LayoutSettings {
  sidebarWidthPct?: number;
  chatRailWidthPct?: number;
  chatRailCollapsed?: boolean;
  /** Ordered route ids for the sidebar nav. */
  navOrder?: string[];
  /** Route ids hidden into the sidebar overflow. */
  navHidden?: string[];
  /** Chat right-rail panels: order + per-panel visibility. */
  chatRailPanels?: { id: string; visible: boolean }[];
  /** Right icon-rail: the last-open destination route id (null/absent = collapsed). */
  rightPanelId?: string | null;
  /** Right icon-rail expandable panel width (% of the shell). */
  rightPanelWidthPct?: number;
}

/** Misc renderer UI preferences (features 3 & 6). */
export interface UiPrefs {
  /** Persisted collapse state keyed by each Collapsible `persistKey`. */
  collapsed?: Record<string, boolean>;
  /** Pinned command names for the Commands palette. */
  pinnedCommands?: string[];
}

export interface BrowserBookmark {
  url: string;
  title: string;
  createdAt: string;
}

export interface BrowserHistoryEntry {
  url: string;
  title: string;
  lastVisitedAt: string;
}

export interface StudioSettingsV2 extends Omit<StudioSettingsV1, "version"> {
  version: 2;
  /** Feature 1 — workspaces (synthesised from recentProjects on migrate). */
  workspaces?: Workspace[];
  /** Feature 5 — persisted resizable shell layout. */
  layout?: LayoutSettings;
  /** Features 3 & 6 — collapse state + pinned commands. */
  ui?: UiPrefs;
  /** Feature 2 — NON-SECRET Linear metadata only (key lives in the OS keychain). */
  linear?: { writesEnabled: boolean; defaultTeamId?: string | null };
  /** Feature 7 — terminal capability (off by default). */
  terminal?: { enabled: boolean; maxConcurrent: number };
  /** Feature 8 — embedded browser capability (off by default). */
  browser?: {
    enabled: boolean;
    bookmarks?: BrowserBookmark[];
    history?: BrowserHistoryEntry[];
  };
}

/**
 * Canonical settings shape. Points at the current schema version (V2) so new
 * code imports `StudioSettings`; the versioned aliases remain for `migrate()`.
 */
export type StudioSettings = StudioSettingsV2;

// ---------------------------------------------------------------------------
// The bridge exposed to the renderer as `window.omp`
// ---------------------------------------------------------------------------

export interface OmpApi {
  getDashboard(): Promise<DashboardData>;
  listSessions(opts?: ListSessionsOptions): Promise<SessionSummary[]>;
  readSession(path: string): Promise<SessionTranscript>;
  searchSessions(
    query: string,
    opts?: SessionSearchOptions,
  ): Promise<SessionSearchHit[]>;
  listMcpServers(cwd?: string): Promise<McpServerInfo[]>;
  listSkills(cwd?: string): Promise<SkillInfo[]>;
  listAgents(cwd?: string): Promise<AgentInfo[]>;
  listModels(): Promise<ModelInfo[]>;
  listProviders(): Promise<ProviderInfo[]>;
  pickDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<void>;

  github: {
    currentRepo(cwd?: string): Promise<GhRepo | null>;
    listRepos(): Promise<GhRepo[]>;
    listIssues(repo?: string, cwd?: string): Promise<GhIssue[]>;
    listPullRequests(repo?: string, cwd?: string): Promise<GhPr[]>;
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
    setSubagentSubscription(
      sessionId: string,
      level: SubagentSubscriptionLevel,
    ): Promise<void>;
    getSubagentMessages(
      sessionId: string,
      sel: { subagentId?: string; sessionFile?: string; fromByte?: number },
    ): Promise<SubagentMessagesResult>;
    getAvailableCommands(sessionId: string): Promise<AvailableSlashCommand[]>;
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

  linear: {
    status(): Promise<LinearStatusInfo>;
    /** Validate the key by probing `viewer{}`, then persist to the OS keychain. */
    setApiKey(key: string): Promise<LinearStatusInfo>;
    clearApiKey(): Promise<void>;
    listTeams(): Promise<LinearTeam[]>;
    listProjects(teamId?: string): Promise<LinearProjectInfo[]>;
    listIssues(opts?: {
      teamId?: string;
      assignedToMe?: boolean;
      limit?: number;
    }): Promise<LinearIssue[]>;
    getIssue(id: string): Promise<LinearIssue | null>;
    // Optional CRUD — present only when settings.linear.writesEnabled is true.
    createIssue?(input: {
      teamId: string;
      title: string;
      description?: string;
    }): Promise<LinearIssue | null>;
    updateIssue?(
      id: string,
      patch: { stateId?: string; title?: string; description?: string },
    ): Promise<LinearIssue | null>;
    createComment?(issueId: string, body: string): Promise<boolean>;
  };

  terminal: {
    create(opts: {
      cwd: string;
      cols: number;
      rows: number;
    }): Promise<TerminalInfo>;
    write(id: string, data: string): Promise<void>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    kill(id: string): Promise<void>;
    list(): Promise<TerminalInfo[]>;
    onData(cb: (e: { id: string; data: string }) => void): () => void;
    onExit(cb: (e: { id: string; code: number | null }) => void): () => void;
  };

  browser: {
    create(opts: {
      url: string;
      bounds: { x: number; y: number; width: number; height: number };
    }): Promise<BrowserViewState>;
    navigate(id: string, url: string): Promise<void>;
    goBack(id: string): Promise<void>;
    goForward(id: string): Promise<void>;
    reload(id: string): Promise<void>;
    openDevTools(id: string): Promise<void>;
    openExternal(id: string): Promise<void>;
    setBounds(
      id: string,
      bounds: { x: number; y: number; width: number; height: number },
    ): Promise<void>;
    destroy(id: string): Promise<void>;
    onState(cb: (e: BrowserViewState) => void): () => void;
  };

  settings: {
    get(): Promise<StudioSettings>;
    update(patch: Partial<StudioSettings>): Promise<StudioSettings>;
  };

  session: {
    rename(path: string, title: string): Promise<void>;
    delete(path: string): Promise<void>;
    archive(path: string): Promise<void>;
    unarchive(path: string): Promise<void>;
    reveal(path: string): Promise<void>;
    exportHtml(path: string): Promise<string>;
  };

  files: {
    /** Shallow listing of `relPath` under `workspaceRoot` (root when omitted). */
    readDir(
      relPath?: string,
      workspaceRoot?: string | null,
    ): Promise<FileEntry[]>;
    /** Read a workspace-relative file as text; `null` when missing/unreadable. */
    readFile(
      relPath: string,
      workspaceRoot?: string | null,
    ): Promise<FileContent | null>;
    /** Atomically write text to a workspace-relative file. */
    writeFile(
      relPath: string,
      text: string,
      workspaceRoot?: string | null,
    ): Promise<{ ok: boolean; error?: string }>;
  };

  changes: {
    /** Workspace uncommitted status; `repo: false` when not a git workspace. */
    status(workspaceRoot?: string | null): Promise<ChangesStatus>;
    /** Branch + worktree metadata for workspace chrome. */
    workspaceInfo(workspaceRoot?: string | null): Promise<GitWorkspaceInfo>;
    /** Unified diff for one workspace-relative file; `null` when unavailable. */
    diff(
      relPath: string,
      workspaceRoot?: string | null,
    ): Promise<FileDiff | null>;
  };
}

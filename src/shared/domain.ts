// App-level domain types shared between the main process (data services) and
// the renderer (views). These describe the read-only data surfaced in
// dashboards and browsers, sourced from omp on-disk state + CLI + `gh`.

import type { AvailableModel, OmpMessage } from "./rpc";

export type { AvailableModel } from "./rpc";

// ---------------------------------------------------------------------------
// Sessions (parsed from ~/.omp/agent/sessions/<slug>/<ts>_<uuid>.jsonl)
// ---------------------------------------------------------------------------

export interface SessionSummary {
  /** session uuid */
  id: string;
  /** absolute path to the .jsonl session file */
  path: string;
  /** project slug (the directory name under sessions/) */
  project: string;
  /** working directory the session ran in (from the session header) */
  cwd: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  model?: string;
  sizeBytes: number;
  /** true when the session has been archived out of the default listing */
  archived?: boolean;
}

export interface SessionTranscript {
  summary: SessionSummary;
  messages: OmpMessage[];
}

export interface ProjectSessions {
  project: string;
  cwd: string;
  count: number;
  lastActive: string;
}

export interface SessionSearchOptions {
  /** maximum number of hits to return */
  limit?: number;
  /** include archived sessions in the scan */
  includeArchived?: boolean;
}

export interface ListSessionsOptions {
  /** include archived sessions (from the archive root) in the result */
  includeArchived?: boolean;
}

export interface SessionSearchHit {
  session: SessionSummary;
  messageIndex: number;
  role: "user" | "assistant" | "toolResult";
  snippet: string;
  ranges: Array<{ start: number; end: number }>;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// MCP servers (from ~/.omp/agent/mcp.json + project .mcp.json)
// ---------------------------------------------------------------------------

export interface McpServerInfo {
  name: string;
  /** "http" | "sse" | "stdio" | ... */
  type: string;
  url?: string;
  command?: string;
  args?: string[];
  authType?: string;
  enabled: boolean;
  source: "user" | "project";
  toolCount?: number;
}

// ---------------------------------------------------------------------------
// Skills (discovered markdown skills with frontmatter)
// ---------------------------------------------------------------------------

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  source: "builtin" | "user" | "project" | "claude" | "managed";
}

// ---------------------------------------------------------------------------
// Bundled / discovered task agents (omp agents unpack --json + frontmatter)
// ---------------------------------------------------------------------------

export interface AgentInfo {
  name: string;
  description: string;
  model?: string;
  spawns?: string;
  source: "builtin" | "user" | "project";
  /** read-only agents have no edit/write/exec tools */
  readOnly?: boolean;
  path?: string;
}

// ---------------------------------------------------------------------------
// Providers (auth status per provider)
// ---------------------------------------------------------------------------

export type ProviderAuthStatus =
  | "authenticated"
  | "unauthenticated"
  | "not_required"
  | "unknown";

export interface ProviderInfo {
  id: string;
  name: string;
  /** legacy truthiness flag, retained for back-compat; prefer `authStatus` */
  authenticated: boolean;
  authStatus: ProviderAuthStatus;
  authSource?: "usage" | "token" | "local" | "none" | "error";
  modelCount: number;
}

export type ModelInfo = AvailableModel;

// ---------------------------------------------------------------------------
// GitHub (via `gh` CLI)
// ---------------------------------------------------------------------------

export interface GhRepo {
  nameWithOwner: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  url: string;
  defaultBranch?: string;
  stargazerCount?: number;
  updatedAt?: string;
  primaryLanguage?: string | null;
}

export interface GhIssue {
  number: number;
  title: string;
  state: string;
  url: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  comments?: number;
}

export interface GhPr {
  number: number;
  title: string;
  state: string;
  url: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  labels: string[];
  headRefName?: string;
  baseRefName?: string;
}

// ---------------------------------------------------------------------------
// OMP stats (local `omp stats --json`; permissive because CLI fields may grow)
// ---------------------------------------------------------------------------

export interface OmpStatsAggregate {
  totalRequests?: number;
  successfulRequests?: number;
  failedRequests?: number;
  errorRate?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCacheReadTokens?: number;
  totalCacheWriteTokens?: number;
  cacheRate?: number;
  totalCost?: number;
  avgDuration?: number;
  avgTtft?: number;
  avgTokensPerSecond?: number;
  firstTimestamp?: number;
  lastTimestamp?: number;
  [key: string]: unknown;
}

export interface OmpStatsBreakdown extends OmpStatsAggregate {
  provider?: string;
  model?: string;
  folder?: string;
  agentType?: string;
  name?: string;
  timestamp?: number;
}

export interface OmpStatsSnapshot {
  overall?: OmpStatsAggregate;
  byModel?: OmpStatsBreakdown[];
  byFolder?: OmpStatsBreakdown[];
  byAgentType?: OmpStatsBreakdown[];
  timeSeries?: OmpStatsBreakdown[];
  modelSeries?: OmpStatsBreakdown[];
  modelPerformanceSeries?: OmpStatsBreakdown[];
  costSeries?: OmpStatsBreakdown[];
  generatedAt: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Dashboard aggregate
// ---------------------------------------------------------------------------

export interface DashboardData {
  sessions: {
    total: number;
    recent: SessionSummary[];
    byProject: ProjectSessions[];
  };
  models: {
    total: number;
    providers: number;
    default?: string;
  };
  mcp: McpServerInfo[];
  skills: number;
  agents: number;
  github: {
    repo: GhRepo | null;
    openIssues: number;
    openPrs: number;
  };
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Linear (feature 2) — issue tracking integration. All Linear HTTP happens in
// the main process; the renderer only ever sees these mapped domain shapes.
// ---------------------------------------------------------------------------

export type LinearAuthStatus = "authenticated" | "unauthenticated" | "error";

export interface LinearViewer {
  id: string;
  name: string;
  email?: string;
  organization?: string;
}

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
}

export interface LinearProjectInfo {
  id: string;
  name: string;
  state?: string;
  url?: string;
  progress?: number;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  state: { name: string; type: string };
  priority?: number;
  assignee?: { name: string } | null;
  team?: { key: string } | null;
  project?: { name: string } | null;
  updatedAt: string;
  createdAt: string;
}

export interface LinearStatusInfo {
  status: LinearAuthStatus;
  viewer?: LinearViewer;
  writesEnabled: boolean;
  /** True when the current key is backed by encrypted on-disk storage. */
  persisted: boolean;
}

// ---------------------------------------------------------------------------
// Terminal (feature 7) — one entry per live pty session.
// ---------------------------------------------------------------------------

export interface TerminalInfo {
  id: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Embedded browser (feature 8) — state of an isolated WebContentsView.
// ---------------------------------------------------------------------------

export interface BrowserViewState {
  id: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  /** Latest visible navigation error, if the main process blocked/failed a load. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Files (feature 4) — workspace file tree + editor. All FS access happens in
// the main process, path-contained under the active workspace cwd; the renderer
// only ever sees these shapes. `readDir` returns a shallow (one-level) listing
// for lazy tree expansion; every `path` is workspace-relative (POSIX-style).
// ---------------------------------------------------------------------------

export interface FileEntry {
  /** Base name of the entry (no directory component). */
  name: string;
  /** Workspace-relative path to the entry. */
  path: string;
  kind: "file" | "dir";
  /** Byte size for files; omitted for directories. */
  size?: number;
  /** True for dotfiles / OS-hidden entries. */
  isHidden?: boolean;
}

export interface FileContent {
  /** Workspace-relative path that was read. */
  path: string;
  /** Decoded UTF-8 text; empty when `binary` or `tooLarge`. */
  text: string;
  /** True when the file exceeded the read cap and `text` holds only a prefix. */
  truncated: boolean;
  /** True when the file is larger than the hard size limit and was not read. */
  tooLarge: boolean;
  /** True when the file looks binary (NUL bytes) and was not decoded. */
  binary: boolean;
}
// ---------------------------------------------------------------------------
// Changes (feature 9) — read-only local git diff for the active workspace. All
// git access happens in the main process, scoped to the active workspace cwd;
// the renderer only ever sees these mapped shapes.
// ---------------------------------------------------------------------------

export type ChangeStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked";

/** One locally changed file (staged + unstaged combined) under the workspace. */
export interface ChangedFile {
  /** Workspace-relative path (POSIX-style). */
  relPath: string;
  status: ChangeStatus;
}

/** Status result: a clean repo returns `repo: true` with an empty file list. */
export interface ChangesStatus {
  /** False when the workspace is not a git repo or `git` is unavailable. */
  repo: boolean;
  files: ChangedFile[];
}

/** Active git identity for the selected workspace chrome. */
export interface GitWorkspaceInfo {
  /** False when the workspace is not a git repo or `git` is unavailable. */
  repo: boolean;
  /** Current branch name; null for detached HEAD or unavailable metadata. */
  branch: string | null;
  /** Git worktree root path as reported by git; null when unavailable. */
  worktreePath: string | null;
}

export type DiffLineType = "context" | "add" | "remove";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

/**
 * Parsed unified diff for a single file; `binary` is true (with empty `hunks`)
 * when git reports a binary change.
 */
export interface FileDiff {
  relPath: string;
  binary: boolean;
  hunks: DiffHunk[];
}

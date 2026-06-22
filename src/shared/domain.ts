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
  source: "builtin" | "user" | "project";
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

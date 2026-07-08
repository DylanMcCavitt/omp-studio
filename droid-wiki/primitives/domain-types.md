# Domain types

`src/shared/domain.ts` holds the app-level read-only domain types shared
between the main process (the data services under `src/main/services`) and the
renderer (the views). These describe the read-only data surfaced in dashboards
and browsers, sourced from `omp` on-disk state, the `omp` CLI, and `gh`. Every
service maps a host source into one of these types and degrades gracefully
(returning `null` or `[]` across IPC) when a source is missing, so the
renderer never has to handle a thrown error from a data fetch.

The services that produce these objects are documented in
[`../systems/data-services.md`](../systems/data-services.md). This page is the
type-level reference. `AvailableModel` is re-exported from `src/shared/rpc.ts`
as `ModelInfo`.

## Sessions

Parsed from `~/.omp/agent/sessions/<slug>/<ts>_<uuid>.jsonl`.

| Type | Fields | Notes |
| --- | --- | --- |
| `SessionSummary` | `id`, `path`, `project`, `cwd`, `title`, `createdAt`, `updatedAt`, `messageCount`, `model?`, `sizeBytes`, `archived?` | One session file. `path` is the absolute `.jsonl` path; `project` is the directory slug; `cwd` comes from the session header. |
| `SessionTranscript` | `summary: SessionSummary`, `messages: OmpMessage[]` | A summary plus its parsed messages. |
| `ProjectSessions` | `project`, `cwd`, `count`, `lastActive` | Per-project aggregate for the dashboard. |
| `SessionSearchHit` | `session`, `messageIndex`, `role`, `snippet`, `ranges`, `updatedAt` | One matched message inside a session. `role` is `"user" | "assistant" | "toolResult"`; `ranges` are snippet highlight offsets. |
| `SessionSearchOptions` | `limit?`, `includeArchived?` | Options for `searchSessions`. |
| `ListSessionsOptions` | `includeArchived?` | Options for `listSessions`. |

## MCP servers

From `~/.omp/agent/mcp.json` plus a project `./.mcp.json`.

| Type | Fields |
| --- | --- |
| `McpServerInfo` | `name`, `type` (`"http"` / `"sse"` / `"stdio"` / ...), `url?`, `command?`, `args?`, `authType?`, `enabled`, `source` (`"user"` / `"project"`), `toolCount?` |

## Skills

Discovered markdown skills with frontmatter.

| Type | Fields |
| --- | --- |
| `SkillInfo` | `name`, `description`, `path`, `source` (`"builtin"` / `"user"` / `"project"` / `"claude"` / `"managed"`) |

The `source` covers the bundled workflow-kit, user and project `.agents` /
`.agent` / `.claude` skill dirs, and `~/.omp/agent/managed-skills`.

## Agents

Bundled and discovered task agents from `omp agents unpack --json` plus
frontmatter.

| Type | Fields |
| --- | --- |
| `AgentInfo` | `name`, `description`, `model?`, `spawns?`, `source` (`"builtin"` / `"user"` / `"project"`), `readOnly?`, `path?` |

`readOnly` marks agents with no edit/write/exec tools.

## Providers and models

| Type | Fields | Notes |
| --- | --- | --- |
| `ProviderAuthStatus` | `"authenticated" | "unauthenticated" | "not_required" | "unknown"` | Per-provider auth state. |
| `ProviderInfo` | `id`, `name`, `authenticated`, `authStatus`, `authSource?` (`"usage" | "token" | "local" | "none" | "error"`), `modelCount` | Grouped from the model catalog. `authenticated` is a legacy truthiness flag retained for back-compat; prefer `authStatus`. |
| `ModelInfo` | alias for `AvailableModel` | Re-exported from `src/shared/rpc.ts`. |

## GitHub

Via the `gh` CLI.

| Type | Fields |
| --- | --- |
| `GhRepo` | `nameWithOwner`, `name`, `description`, `isPrivate`, `url`, `defaultBranch?`, `stargazerCount?`, `updatedAt?`, `primaryLanguage?` |
| `GhIssue` | `number`, `title`, `state`, `url`, `author`, `createdAt`, `updatedAt`, `labels`, `comments?` |
| `GhPr` | `number`, `title`, `state`, `url`, `author`, `createdAt`, `updatedAt`, `isDraft`, `labels`, `headRefName?`, `baseRefName?` |

## OMP stats

Local `omp stats --json`. Permissive because CLI fields may grow.

| Type | Role |
| --- | --- |
| `OmpStatsAggregate` | Totals: `totalRequests?`, `successfulRequests?`, `failedRequests?`, `errorRate?`, `totalInputTokens?`, `totalOutputTokens?`, `totalCacheReadTokens?`, `totalCacheWriteTokens?`, `cacheRate?`, `totalCost?`, `avgDuration?`, `avgTtft?`, `avgTokensPerSecond?`, `firstTimestamp?`, `lastTimestamp?`. Open index. |
| `OmpStatsBreakdown` | `OmpStatsAggregate` plus grouping keys `provider?`, `model?`, `folder?`, `agentType?`, `name?`, `timestamp?`. |
| `OmpStatsSnapshot` | `overall?`, `byModel?`, `byFolder?`, `byAgentType?`, `timeSeries?`, `modelSeries?`, `modelPerformanceSeries?`, `costSeries?` (each `OmpStatsBreakdown[]`), `generatedAt`. Open index. |

## Dashboard aggregate

| Type | Fields |
| --- | --- |
| `DashboardData` | `sessions: { total, recent: SessionSummary[], byProject: ProjectSessions[] }`, `models: { total, providers, default? }`, `mcp: McpServerInfo[]`, `skills`, `agents`, `github: { repo: GhRepo | null, openIssues, openPrs }`, `generatedAt` |

An aggregate of the data services, built for the dashboard view.

## Linear

Issue-tracking integration. All Linear HTTP runs in the main process; the
renderer only sees these mapped shapes. The API key never crosses IPC and never
lives in settings (see [`../systems/secret-store.md`](../systems/secret-store.md)).

| Type | Fields |
| --- | --- |
| `LinearAuthStatus` | `"authenticated" | "unauthenticated" | "error"` |
| `LinearViewer` | `id`, `name`, `email?`, `organization?` |
| `LinearTeam` | `id`, `key`, `name` |
| `LinearProjectInfo` | `id`, `name`, `state?`, `url?`, `progress?` |
| `LinearIssue` | `id`, `identifier`, `title`, `url`, `state: { name, type }`, `priority?`, `assignee?: { name } | null`, `team?: { key } | null`, `project?: { name } | null`, `updatedAt`, `createdAt` |
| `LinearStatusInfo` | `status: LinearAuthStatus`, `viewer?`, `writesEnabled` |

## Terminal

One entry per live pty session.

| Type | Fields |
| --- | --- |
| `TerminalInfo` | `id`, `cwd`, `shell`, `cols`, `rows`, `createdAt` |

## Embedded browser

State of an isolated `WebContentsView`.

| Type | Fields |
| --- | --- |
| `BrowserViewState` | `id`, `url`, `title`, `canGoBack`, `canGoForward`, `loading`, `error?` |

`error` holds the latest visible navigation error, if the main process blocked
or failed a load.

## Files

Workspace file tree and editor. All filesystem access happens in the main
process, path-contained under the active workspace cwd; the renderer only sees
these shapes. `readDir` returns a shallow (one-level) listing for lazy tree
expansion; every `path` is workspace-relative (POSIX-style).

| Type | Fields | Notes |
| --- | --- | --- |
| `FileEntry` | `name`, `path`, `kind` (`"file"` / `"dir"`), `size?`, `isHidden?` | `name` is the base name; `path` is workspace-relative; `size` (bytes) is omitted for dirs; `isHidden` flags dotfiles and OS-hidden entries. |
| `FileContent` | `path`, `text`, `truncated`, `tooLarge`, `binary` | `text` is decoded UTF-8, empty when `binary` or `tooLarge`. |

`truncated` means the file exceeded the read cap and `text` holds only a
prefix; `tooLarge` means the file was larger than the hard size limit and was
not read; `binary` means NUL bytes were detected and the file was not decoded.

## Changes

Read-only local git diff for the active workspace. All git access happens in
the main process, scoped to the active workspace cwd.

| Type | Fields | Notes |
| --- | --- | --- |
| `ChangeStatus` | `"modified" | "added" | "deleted" | "renamed" | "untracked"` | The status of one changed file. |
| `ChangedFile` | `relPath`, `status` | One locally changed file (staged and unstaged combined). |
| `ChangesStatus` | `repo: boolean`, `files: ChangedFile[]` | `repo` is false when the workspace is not a git repo or `git` is unavailable; a clean repo returns `repo: true` with an empty file list. |
| `GitWorkspaceInfo` | `repo: boolean`, `branch: string | null`, `worktreePath: string | null` | Active git identity for the workspace chrome. `branch` is null for detached HEAD or unavailable metadata. |
| `DiffLineType` | `"context" | "add" | "remove"` | |
| `DiffLine` | `type: DiffLineType`, `text` | One diff line. |
| `DiffHunk` | `oldStart`, `newStart`, `lines: DiffLine[]` | One hunk. |
| `FileDiff` | `relPath`, `binary`, `hunks: DiffHunk[]` | Parsed unified diff for one file; `binary` is true (with empty `hunks`) when git reports a binary change. |

## Key types

| Type | File | One-line meaning |
| --- | --- | --- |
| `SessionSummary` / `SessionTranscript` / `ProjectSessions` | `src/shared/domain.ts` | Session listing, transcript, and per-project aggregate. |
| `SessionSearchHit` / `SessionSearchOptions` / `ListSessionsOptions` | `src/shared/domain.ts` | Session search hits and options. |
| `McpServerInfo` | `src/shared/domain.ts` | One MCP server from `mcp.json`. |
| `SkillInfo` | `src/shared/domain.ts` | One discovered skill. |
| `AgentInfo` | `src/shared/domain.ts` | One bundled or discovered task agent. |
| `ProviderInfo` / `ProviderAuthStatus` / `ModelInfo` | `src/shared/domain.ts` | Provider auth status and model catalog. |
| `GhRepo` / `GhIssue` / `GhPr` | `src/shared/domain.ts` | GitHub repo, issue, and PR shapes from `gh`. |
| `OmpStatsSnapshot` / `OmpStatsAggregate` / `OmpStatsBreakdown` | `src/shared/domain.ts` | `omp stats` snapshot, totals, and breakdowns. |
| `DashboardData` | `src/shared/domain.ts` | The dashboard aggregate. |
| `LinearStatusInfo` / `LinearViewer` / `LinearTeam` / `LinearProjectInfo` / `LinearIssue` | `src/shared/domain.ts` | Linear integration shapes. |
| `TerminalInfo` | `src/shared/domain.ts` | One live pty session. |
| `BrowserViewState` | `src/shared/domain.ts` | State of one embedded browser view. |
| `FileEntry` / `FileContent` | `src/shared/domain.ts` | Workspace file tree entries and file reads. |
| `ChangedFile` / `ChangesStatus` / `GitWorkspaceInfo` / `FileDiff` / `DiffHunk` / `DiffLine` | `src/shared/domain.ts` | Read-only git diff shapes. |

## Related pages

- [`../systems/data-services.md`](../systems/data-services.md): the services
  that produce these objects.
- [`../systems/session-store.md`](../systems/session-store.md): the session
  store that produces `SessionSummary` and `SessionTranscript`.
- [`../systems/secret-store.md`](../systems/secret-store.md): the OS keychain
  store backing the Linear API key.
- [IPC contract](ipc-contract.md): the `data:*`, `gh:*`, `linear:*`,
  `terminal:*`, `browser:*`, `files:*`, and `changes:*` channels that carry
  these types.
- [RPC protocol types](rpc-protocol.md): `AvailableModel`, re-exported here
  as `ModelInfo`, and `OmpMessage`, used by `SessionTranscript`.

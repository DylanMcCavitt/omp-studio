# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Expands OMP Studio from read-only browsers into an interactive v2 cockpit.

### Added

- First-class project **workspaces** (feature 1): a sidebar `WorkspaceSwitcher`
  (Menu popover — pinned, recents, then Add/Manage), an `AddWorkspaceDialog`
  (directory pick + optional label override), and a Settings **Workspaces**
  panel (pin, set-default, edit label, re-point cwd, remove). Selecting a
  workspace points new chats at its cwd and bumps recency; live sessions are
  untouched and selecting/adding spawns nothing. Persists to
  `settings.workspaces` (`{id,cwd,label,pinned,lastUsedAt}`) over the existing
  `settings:*` channels — no new IPC.
- **Subagent drill-in** (feature 4). `SubagentTree` becomes a real per-session
  workflow tree (nested by `parentToolCallId`/`index`) with a live progress
  ticker, and a new `SubagentInspector` opens any node to follow its transcript
  and live progress/event feed. The session reducer now consumes the nested
  `subagent_lifecycle`/`subagent_progress`/`subagent_event` frames (which
  already stream at the `"events"` level the bridge subscribes on `ready`); a
  live subagent's transcript is tailed incrementally via the new
  `chat.getSubagentMessages` channel (`{entries, messages, nextByte, reset}`),
  falling back to `readSession` once it completes. Adds typed subagent
  refinements to `shared/rpc.ts` (`AgentProgress`, `SubagentSnapshot`, the
  `SubagentLifecycle`/`Progress`/`Event` frames, `SubagentMessagesResult`,
  `SubagentSubscriptionLevel`) and an optional `chat.setSubagentSubscription`
  cost-control knob.
- The Skills view becomes **Skills & Commands** (feature 6): three Collapsible
  sections share one search box — the unchanged disk-skills grid, the active
  session's live slash commands (merged with an on-open
  `chat.getAvailableCommands` snapshot, with pin → `settings.ui.pinnedCommands`
  and a "Use in chat" that routes to Chat with `/name ` prefilled), and a static
  read-only **TUI-only commands** reference (`tan`/`omfg`/`tree`) badged "TUI
  only — not available in Studio". The Session-commands section shows an explicit
  empty state when no session is loaded. Adds `lib/tui-commands.ts`, a
  `pendingComposerText` seed on `store/app.ts` adopted once by the composer, and a
  `togglePinnedCommand` settings action; `commandInsertText`/`filterCommands` are
  reused from the shared slash-command helpers.
- **Linear integration** (feature 2). A new `Linear` view and store browse your
  teams, projects, and issues, with a Dashboard panel and a Settings
  Integrations card to connect/disconnect. All Linear HTTP runs in the main
  process (`services/linear.ts`: GraphQL over Node's global `fetch` against
  `api.linear.app`, 10 s timeout, graceful-degrade to `null`/`[]`), so the
  renderer never touches the network or the API key, and the renderer CSP is
  unchanged. The key is stored as OS-keychain ciphertext via Electron
  `safeStorage` (`services/secret-store.ts`) — never in settings JSON, no
  `keytar` dependency. Reads are the v2 default; optional issue/comment CRUD is
  gated behind `settings.linear.writesEnabled` (off by default). Adds the
  `linear:*` channels and `Linear*` domain types.
- A **draggable / rearrangeable shell layout** (feature 5). The sidebar|main
  and chat transcript|right-rail splits are now resizable via
  `react-resizable-panels` (`ResizeHandle` with double-click-to-reset);
  controlled sizes come from `settings.layout` (`sidebarWidthPct`,
  `chatRailWidthPct`), never the library's `autoSaveId`/localStorage. The chat
  right rail collapses to an icon strip (`chatRailCollapsed`) and its panels
  (Model/Thinking/Usage/Plan/Subagents) are reorderable (hand-rolled header
  drag handle), collapsible (`Panel collapsible`), and hideable from a "⋯
  Customize" menu (`chatRailPanels`). Sidebar nav entries reorder via drag and
  hide into a "More" overflow (`navOrder`/`navHidden`), preserving the
  WorkspaceSwitcher header and the Chat StartPanel WorkspaceSelect. Layout
  writes funnel through a new debounced `setLayout` (~250 ms trailing,
  coalescing drags) on the existing `settings:*` channels; Settings → Appearance
  gains a **Reset layout** action (`resetLayout`). Adds `components/layout/`
  (`ResizeHandle`, `usePersistedPanelLayout`, `useDragReorder`) and `lib/layout.ts`.
- An opt-in embedded **terminal** (feature 7). A `Terminal` view renders
  `xterm.js` wired to a real pty shell spawned in the main process via
  `node-pty` (`terminal/registry.ts` `TerminalRegistry` + `pty-session.ts`,
  mirroring `SessionRegistry`): cross-platform login-shell resolution, a
  concurrency cap, pty output coalesced over `evt:terminal-data`, and disposal on
  quit. Off by default (`settings.terminal.enabled`); `node-pty` loads lazily so
  a missing native addon never breaks startup. Adds the `terminal:*` channels +
  `evt:terminal-data`/`evt:terminal-exit` and a `TerminalInfo` domain type.
- An **embedded browser panel** (feature 8, renderer surface). A `Browser` view
  renders only the chrome (`BrowserChrome`: back/forward/reload, an editable
  address bar for free-text navigation, and a `Combobox` history dropdown) plus
  an empty placeholder `div`; the actual page is the main-owned, sandboxed
  `WebContentsView` overlaid on that rect, so the privileged renderer window
  never loads remote content (its CSP stays `'self'`). `useBrowserBounds`
  streams the placeholder's rect to `browser.setBounds` on layout/resize/scroll
  (ResizeObserver + window listeners), and `store/browser.ts` reduces the
  `browser.onState` pushes (url/title/loading/can-go-*) into nav state + a
  deduped visited-URL history behind one global subscription, forwarding
  create/navigate/back/forward/reload/destroy to `window.omp.browser.*`. Off by
  default (`settings.browser.enabled`): when disabled, an honest enable gate
  states that it loads untrusted remote content in a separate sandboxed view —
  it is explicitly **not** called a "secure" browser. The view is destroyed on
  unmount. Uses the existing `browser:*` channels — no new IPC.
- Live Playwright `_electron` end-to-end flows (`e2e/live.spec.ts`) gated behind
  `STUDIO_E2E_LIVE=1` (mirroring `RPC_LIVE=1`): a real chat turn, the D1 tool
  approval approve/deny/input-select round-trips, D3 restart-and-resume, and D2
  two-session concurrency. They are skipped by default so `npm run test:e2e` and
  CI stay non-live, and run against the installed `omp` only when the flag is set.

### Changed

- **Settings schema bumped to V2** (additive). `settings-service.migrate()`
  upgrades a V1 file by filling defaults; every new field is optional
  (`workspaces`, `layout`, `ui`, `linear`, `terminal`, `browser`) so a V1 file
  and partial patches stay valid. Secure defaults: `terminal.enabled`,
  `browser.enabled`, and `linear.writesEnabled` are all `false`. `mergeKnown()`
  continues to drop token-shaped/unknown keys, and `linear` persists non-secret
  metadata only (`writesEnabled`, `defaultTeamId`) — the Linear API key never
  enters settings JSON.
- Skill discovery now mirrors omp's own roots. `listSkills(cwd?)` walks up from
  the active workspace (capped at 5 ancestors) collecting `.agents/skills` and
  `.agent/skills`, adds the user `~/.agents`, `~/.agent`, and `~/.claude` skill
  dirs plus the project `<cwd>/.claude/skills`, and scans the managed/auto-learn
  dir at the exact `<agentDir>/managed-skills` path (no broad `agentDir()` scan,
  so sessions/blobs/SQLite noise stays out). Per-root depth rises 1→2 and skills
  are tagged `claude`/`managed`. The skills/MCP/agents reads and the dashboard
  now thread the active workspace cwd (falling back to the most-recently-active
  chat session's cwd) instead of the wrong `process.cwd()` project root.
- Renderer project handling cuts over from `recentProjects` to
  `settings.workspaces`. `lib/recent-projects.ts` is replaced by
  `lib/workspaces.ts` (`projectLabel`, `upsertWorkspace`, `pinWorkspace`,
  `sortWorkspaces`); the Chat start panel's directory picker becomes a
  `WorkspaceSelect` combobox, Settings' `ProjectsPanel` becomes
  `WorkspacesPanel`, and the settings store gains
  `recordWorkspace`/`addWorkspace`/`removeWorkspace`/`updateWorkspace` wrappers
  over the pessimistic `update`.
- Real tool approvals now render with the rich approval dialog. omp surfaces an
  `always-ask` tool approval as an Approve/Deny `select` (not a `confirm`), so
  the studio detects that shape and routes it to `ApprovalRequestDialog` — Deny
  default-focus, danger styling, and session-scoped "Always allow" — mapping the
  chosen affordance back to the select's `{value}` response. Generic (non
  approval) selects keep the plain `SelectRequestDialog`.

## [0.1.0] - 2026-06-19

Initial release.

### Added

- Dashboard aggregating recent sessions, model and provider counts, MCP servers,
  skills, bundled agents, and the current GitHub repository at a glance.
- Live agent chat backed by a per-session `omp --mode rpc` child process, with
  streaming assistant text, thinking blocks, tool-call rendering, steering, and
  follow-ups.
- Sessions browser that reads on-disk session transcripts from `~/.omp/agent`.
- Skills browser scanning project, user, and bundled skill markdown.
- MCP servers browser sourced from user and project MCP configuration.
- Bundled agents browser populated from `omp agents unpack`.
- Models and providers browser sourced from `omp models --json`.
- GitHub browser for the current repository, issues, pull requests, and owned
  repositories via the `gh` CLI.

[Unreleased]: https://github.com/DylanMcCavitt/omp-studio/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DylanMcCavitt/omp-studio/releases/tag/v0.1.0

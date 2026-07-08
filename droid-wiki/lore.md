# Lore

OMP Studio is a young codebase. The first commit landed 2026-06-19 and the
history runs ~145 commits, all from one author, across less than three weeks. Even
so, the git log and `CHANGELOG.md` show a clear two-era story: a focused
read-only v1 shipped on day one, then a large unreleased v2 expansion that
turned the app into an interactive cockpit. Dates below come from git commit
timestamps and the CHANGELOG.

## Era 1: Initial release (Jun 2026)

### 2026-06-19, the 0.1.0 release

The very first commit (`feat: OMP Studio — desktop cockpit for the Oh My Pi
harness`, 2026-06-19) landed as a working 0.1.0. The `CHANGELOG.md` entry for
`[0.1.0] - 2026-06-19` lists what shipped that day:

- A dashboard aggregating recent sessions, model and provider counts, MCP
  servers, skills, bundled agents, and the current GitHub repository.
- Live agent chat backed by a per-session `omp --mode rpc` child process, with
  streaming assistant text, thinking blocks, tool-call rendering, steering, and
  follow-ups.
- A sessions browser reading on-disk transcripts from `~/.omp/agent`.
- Skills, MCP, bundled agents, models/providers, and GitHub browsers, each
  sourced from `omp` or `gh`.

So the core shape of the app, a main process driving the real `omp` binary over
RPC, plus read-only browsers for everything `omp` knows about, existed on day
one. The second commit the same day (`docs: point Oh My Pi links to upstream
repo`) was a docs fix.

### 2026-06-22, the v1 hardening wave

Three days later, 2026-06-22 brought a burst of AGE-tracked work that filled out
v1 across 30+ commits (PRs #1 through #34). This is when the app got its shared
contract and IPC baseline (AGE-573), Biome lint and format (AGE-572), a
packaged-app boot smoke gate (AGE-575), the main-owned persistent settings store
(AGE-583), real provider-auth detection (AGE-581), the RPC UI bridge with
approval policy (AGE-582, AGE-585), the Playwright `_electron` e2e harness
(AGE-577), renderer sandboxing (AGE-602), transcript search (AGE-576), session
resume and hibernation (AGE-588), the renderer multi-session store
(AGE-591), CSS-variable theming (AGE-584), image input (AGE-596), the
slash-command palette (AGE-594), accessibility and keyboard shortcuts
(AGE-601), and node-side test coverage (AGE-604). By the end of 2026-06-22 the
v1 feature set was in place and gated by CI.

## Era 2: The v2 expansion (Jun to Jul 2026)

The big expansion is unreleased (it lives under `[Unreleased]` in
`CHANGELOG.md`) and turns the read-only browser app into an interactive
cockpit. The work is tracked under the Linear team `dmcc`, project `OMP Studio`,
with most issues in the AGE-571 through AGE-816 range (125 distinct `AGE-###`
identifiers appear across commit subjects).

### 2026-06-23, the v2 feature drop

A single day, 2026-06-23, holds the bulk of the v2 expansion, spread across
PRs #35 through #58. On that day the app gained:

- Additive `shared/rpc.ts` and `shared/domain.ts` types for subagents, commands,
  Linear, Terminal, and Browser (AGE-609, AGE-611).
- A single nav/route/view registry replacing the old triple (AGE-610).
- UI primitives: Collapsible, Popover, Menu, Combobox, and Panel extensions
  (AGE-612).
- Routing omp's select-shaped tool approvals to the rich `ApprovalRequestDialog`
  (the renderer-side fix that pairs with the main bridge).
- The additive shared IPC contract with `StudioSettingsV2` and preload
  forwarders (AGE-613).
- The subagent drill-in bridge: `getSubagentMessages` live cursor and
  `setSubagentSubscription` (AGE-617).
- The Linear GraphQL service plus `safeStorage` secret store and `linear:*` IPC
  (AGE-614).
- Skill discovery fixed to mirror omp's own roots and to thread the workspace
  cwd (AGE-619).
- The settings v1-to-v2 runtime cutover: `migrate()`, secure defaults, and
  `mergeKnown()` (AGE-620).
- The `get_available_commands` snapshot bridge (AGE-618).
- The subagent tree, inspector, and `TranscriptView` extract (AGE-625).
- First-class workspaces: switcher, add dialog, manage panel, chat select
  (AGE-626).
- The Skills and Commands view (AGE-621).
- The Linear renderer surface: view, store, connect card, settings and
  dashboard panels (AGE-623).
- The terminal backend with `node-pty` `PtySession` and `TerminalRegistry`
  (AGE-615).
- The main browser backend: sandboxed `WebContentsView` manager and `browser:*`
  IPC (AGE-616), wired into bootstrap with `will-navigate` hardening.
- The draggable, rearrangeable layout: resizable splits, navrail reorder/hide,
  rail customize (AGE-627).
- The terminal panel with xterm and an honest first-run gate (AGE-622).
- The embedded browser panel: chrome, bounds reporting, nav-state store
  (AGE-624).
- The hermetic smoke suite extended to the v2 routes (AGE-629).
- Updated `ARCHITECTURE.md`, `README.md`, and `CHANGELOG.md` for v2.

### 2026-06-23, the visual identity and release tooling

Also on 2026-06-23, three cross-cutting changes landed that reshaped the whole
app:

- **Visual identity refresh (AGE-658)**: the surface ramp moved to neutral
  graphite (dropping the old navy/blue cast) and the accent moved to iris/violet.
  Because the renderer is fully token-driven, only the CSS-variable values in
  `src/renderer/src/styles.css` changed, with no per-component edits.
- **UI/UX polish sweep (AGE-654)**: a renderer-wide pass toward an IDE-grade
  dark interface, including WCAG-AA legibility for muted copy, a single title
  per surface, an ambient workspace titlebar, a polished right rail, per-view
  polish, and a new Playwright UI-flow e2e.
- **Real versioned releases (AGE-659)**: `npm run release` now bumps the
  version, stamps the CHANGELOG, and tags `vX.Y.Z`; the Release workflow
  verifies the tag matches `package.json`, builds and smoke-tests installers on
  macOS, Linux, and Windows, and cuts one GitHub Release with notes from the
  matching CHANGELOG section.

### 2026-07-01 to 2026-07-02, the pane model and split panes

July opened with a structural change to the shell. On 2026-07-01, AGE-801
introduced the pane model (`src/renderer/src/store/panes.ts`), a cold split-tree
of pane ids separated from the hot per-session transcript slices. The same day
brought transcript memoization and virtualization (AGE-799), serialized settings
writes (AGE-800), RPC child crash and hung-spawn handling (AGE-797), terminal
and browser gate enforcement (AGE-802), contained session paths and external
opens (AGE-798), a searchable collapsible model catalog (AGE-775), restyled
agent cards (AGE-701), drag-agents-into-composer (AGE-772), and external
terminal copy clarity (AGE-763).

On 2026-07-02 the pane model paid off with AGE-777, opening chats and subagents
in up to eight split panes, plus drag-rearrange split panes with edge docking
(AGE-806), a left sidebar anchored on the open worktree/branch (AGE-807), a
collapsible left sidebar with persisted state and Cmd/Ctrl+B (AGE-814),
preserved pane split weights (AGE-813), a text overflow pass (AGE-816), a
button system refresh (AGE-815), the right panel becoming a px-width overlay
sheet (AGE-812), routed dropped agents (AGE-779), and a kept-on-screen model
picker (AGE-778).

### 2026-07-02 to 2026-07-07, CI, governance, and proof tooling

This stretch is mostly about the project's process hardening. The Factory
Droid CI workflows (`droid.yml` and `droid-review.yml`) landed on 2026-07-02
and were removed again four days later (AGE-837, 2026-07-06) — the shortest-
lived subsystem in the repo so far. AGE-795 removed a stale Symphony label
from the OMP Studio workflow (2026-07-03) and AGE-796 documented the issue
worktree bootstrap (2026-07-03). Then a governance wave: AGENTS.md with
Cursor Cloud setup notes (2026-07-05, the repo's only Cursor-Agent-co-authored
commit), `CONTRIBUTING.md`, `SECURITY.md`, `CODEOWNERS`, and issue-template
config (AGE-833, 2026-07-06), the executors doctrine in the agent contract
(AGE-834), the `.cursor/environment.json` install hook (AGE-836), and the
read-only `npm run sync-check` drift radar (AGE-835, `scripts/sync-check.mjs`).

The feature tail: AGE-774 added the MessageScroller chat navigation trail
(2026-07-06), and AGE-838 added the reusable demo-recording harness
(`npm run demo`, `e2e/demo/`, 2026-07-07, the latest commit at the time of
writing) so PRs can attach hermetic mp4 proof of UI behavior.

## Longest-standing features

A few features have been here since the first commit and have weathered the most
changes:

- **The dashboard** (`src/renderer/src/views/Dashboard.tsx`) appeared in the
  2026-06-19 release and has been touched 11 times in the last 90 days, most
  often to add new data sources and to thread the workspace cwd.
- **The RPC chat bridge** (`src/main/omp/rpc-session.ts` and
  `src/renderer/src/store/chat.ts`) is the original core. `chat.ts` is the
  most-changed store file (18 touches in 90 days) as it absorbed subagent
  telemetry, the pane model, and transcript virtualization.
- **The read-only browsers** (Skills, MCP, Agents, Models/Providers, GitHub) all
  date to 2026-06-19 or 2026-06-22 and still follow the same pattern: a
  `src/main/services/*` reader that degrades gracefully to `null` or `[]`
  across IPC when a source is missing.

## Deprecated and replaced features

- **`recentProjects` to `workspaces`**: the v1 `lib/recent-projects.ts` log was
  replaced by `settings.workspaces`. The cutover landed on 2026-06-23 in
  AGE-626, which deleted `src/renderer/src/lib/recent-projects.ts` and added
  `src/renderer/src/lib/workspaces.ts` (`projectLabel`, `upsertWorkspace`,
  `pinWorkspace`, `sortWorkspaces`). The CHANGELOG notes this appears to have
  been driven by a need to pin, label, and re-point project roots rather than
  just remember them.
- **Directory picker to `WorkspaceSelect`**: the Chat start panel's old
  directory picker became a `WorkspaceSelect` combobox, and Settings'
  `ProjectsPanel` became `WorkspacesPanel`, both in the same AGE-626 cutover.
- **v1 settings schema to v2**: the settings schema was bumped from v1 to v2 as
  an additive change. `settings-service.migrate()` upgrades a v1 file by filling
  defaults; every new field (`workspaces`, `layout`, `ui`, `linear`,
  `terminal`, `browser`) is optional, so a v1 file and partial patches stay
  valid.
- **Factory Droid CI integration**: `.github/workflows/droid.yml` (`@droid`
  mentions) and `droid-review.yml` (auto-review on non-draft PRs) were added
  on 2026-07-02 and removed on 2026-07-06 (AGE-837). Review now routes through
  `.github/CODEOWNERS` instead.

## Major rewrites

- **Settings schema v1 to v2** (AGE-620, 2026-06-23): the runtime cutover in
  `src/main/services/settings-service.ts`, paired with secure defaults
  (`terminal.enabled`, `browser.enabled`, `linear.writesEnabled` all `false`).
- **Renderer project handling** (AGE-626, 2026-06-23): the renderer stopped
  reading `recentProjects` and started reading `settings.workspaces`; the
  settings store gained `recordWorkspace`, `addWorkspace`, `removeWorkspace`,
  and `updateWorkspace` wrappers over the pessimistic `update`.
- **Shell cutover to the pane model** (AGE-801, 2026-07-01): the shell moved
  from a single center view to a split-tree `PaneLayout` of up to eight panes
  (chat, file, or subagent). The hot/cold split keeps pane ids cold in
  `src/renderer/src/store/panes.ts` while each transcript pane subscribes to its
  own hot session slice. AGE-777 (2026-07-02) then made those panes draggable
  and dockable.

## Growth trajectory

| Month | Commits |
|---|---|
| Jun 2026 | 110 |
| Jul 2026 | 35 (partial month, through 2026-07-07) |

The repo went from 54 `.ts`/`.tsx` files in the first commit to 222 in
`src/` today, roughly a 4x growth in source files over two weeks. The Linear
`AGE-###` tracking is dense: 125 distinct issue identifiers appear across
commit subjects, all under team `dmcc` and project `OMP Studio`. The
production-readiness push appears to be organized under epic AGE-655 (referenced
in the survey context as the production-readiness epic), with the v2 expansion
issues spanning AGE-571 through AGE-816.

# Features

The features section covers the user-visible capabilities of OMP Studio, the
Electron desktop cockpit for the `omp` coding-agent harness. The app does not
reimplement any agent logic; it drives the real `omp` binary over its RPC
protocol, reads `omp`'s on-disk state, and shells out to the GitHub CLI. Several
features span the renderer and the main process; their main-process backends are
documented under [`../systems/index.md`](../systems/index.md) and cross-linked
from each page. The architecture that situates these in the process model is in
[`../overview/architecture.md`](../overview/architecture.md).

## Chat

The core surface. Each open chat is one real `omp --mode rpc` child driven over
a newline-delimited JSON stdio protocol, streamed into a reconciled transcript
with a composer, tool-call rendering, a subagent tree and inspector, UI-request
prompts, and model/thinking controls.

- [Chat overview](chat/index.md)
- [Composer](chat/composer.md)
- [Transcript](chat/transcript.md)
- [Session management](chat/session-management.md)
- [Subagent drill-in](chat/subagent-drill-in.md)
- [Approvals](chat/approvals.md)

## Browsers and integrations

- [Dashboard](dashboard.md) — the project overview: agent stats, recent
  sessions, workspace context, aggregated from read-only data services.
- [Sessions browser](sessions-browser.md) — browses on-disk session transcripts,
  resumes hibernated sessions, and is the target of global search's
  transcript hits.
- [Skills and commands](skills-and-commands.md) — the Skills & Commands panel:
  discovered skills, the slash-command palette, pinned favorites, and "Use in
  chat".
- [MCP servers](mcp-servers.md) — the MCP panel: configured servers from
  `mcp.json`, their tools, and connection status.
- [Agents](agents.md) — the Agents panel: bundled, user, and project agents as
  draggable cards that drop into the composer to spawn that agent.
- [Models and providers](models-and-providers.md) — the Models panel: providers
  and models from `omp models`, with the active model and thinking-level
  controls.
- [GitHub](github.md) — the GitHub panel: repos, PRs, and issues via the `gh`
  CLI, read-only by default.
- [Linear](linear.md) — the Linear panel: teams, issues, and projects over the
  Linear GraphQL API, with the API key in the OS keychain and writes off by
  default.

## Embedded tools

- [Terminal](terminal.md) — an embedded real pty shell (xterm.js + node-pty),
  off by default; agent frames never write to pty input.
- [Browser](browser.md) — a sandboxed embedded `WebContentsView` per tab, own
  WebContents, http(s)-only navigation, ephemeral in-memory session by default.

## Workspace and shell

- [Workspaces](workspaces.md) — first-class project roots: the sidebar
  switcher, add dialog, and Settings panel all operating on one persisted
  `settings.workspaces` list.
- [Shell layout](shell-layout.md) — the draggable, rearrangeable shell: the
  sidebar | center pane tree | right icon rail, resizable splits, up to eight
  panes, and the debounced layout persistence.
- [Global search](global-search.md) — the `Cmd/Ctrl+Shift+F` overlay that
  searches routes, open live sessions, and historical transcripts into one list.
- [Navigation and shortcuts](navigation.md) — the 12 destinations, the nav
  registry, the `Cmd/Ctrl+K` navigation palette, and the single global shortcut
  manager.

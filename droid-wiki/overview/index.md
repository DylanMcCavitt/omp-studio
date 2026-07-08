# OMP Studio overview

OMP Studio is an Electron desktop cockpit for the [Oh My Pi (`omp`)](https://github.com/can1357/oh-my-pi)
coding-agent harness. It does not reimplement any agent logic. It drives the real
`omp` binary over its RPC protocol, reads `omp`'s on-disk state, and shells out
to the GitHub CLI, so you can run, inspect, and manage agent work without living
in a terminal. The app is pre-1.0, under heavy iteration; the UI, internal APIs,
and on-disk/settings formats are not yet stable.

The app is a single desktop product (one deployable unit) with a clear
three-process architecture. The renderer is a React 18 SPA that never touches
Node or Electron directly; it calls a typed `window.omp` bridge exposed by the
preload, which forwards to `ipcMain` handlers in the main process. The main
process owns the `omp` RPC child processes and all data services, and is the only
process that touches the filesystem, spawns child processes, or makes network
calls. See [Architecture](architecture.md) for the full process model and data
flows.

## What it does

- **Live agent chat** over the `omp` RPC protocol: streaming assistant text,
  thinking blocks, live tool-call rendering, steering, and follow-ups, each
  session backed by its own `omp` child process.
- **Dashboard** aggregating recent sessions, model and provider counts, MCP
  servers, skills, bundled agents, and the current GitHub repository.
- **Browsers** for sessions, skills and commands, MCP servers, bundled agents,
  models/providers, GitHub, and Linear.
- **Subagent drill-in**: expand a session's subagent workflow tree and open any
  node in an inspector to follow its live progress, tool calls, and transcript.
- **Workspaces**: first-class project workspaces with a sidebar switcher,
  add/manage dialogs, and pinning. Selecting a workspace points new chats at its
  directory.
- **Files and changes**: a workspace-scoped file tree with a CodeMirror 6 editor,
  plus a read-only local git diff view.
- **Opt-in embedded terminal** (`node-pty` + xterm.js) and **opt-in embedded
  browser** (a sandboxed `WebContentsView`), both off by default.
- **Draggable layout**: resizable sidebar and chat panels, reorderable rail
  panels and nav items, and up to 8 split center panes, persisted across
  launches.

## Who uses it

Developers who run the `omp` coding-agent harness and want a native window for
chat, dashboards, and the surrounding context (`omp` sessions, skills, MCP,
agents, models, GitHub, Linear) instead of working purely in a terminal. It
targets macOS, Linux, and Windows.

## Quick links

- [Architecture](architecture.md) — process model, RPC protocol bridge, data
  services, the shared type contract, and the IPC channel map.
- [Getting started](getting-started.md) — prerequisites, install, build, test,
  run.
- [Glossary](glossary.md) — project-specific terms.
- [By the numbers](../by-the-numbers.md) — codebase statistics snapshot.
- [Lore](../lore.md) — timeline and history.

For the authoritative long-form architecture doc, see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) in the repo.

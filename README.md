# OMP Studio

A sleek desktop cockpit for the [Oh My Pi (`omp`)](https://github.com/can1357/oh-my-pi)
coding-agent harness — live agent chat, dashboards, and browsers for everything
`omp` knows about, in one native window.

OMP Studio wraps the `omp` command-line harness in an Electron desktop app. It
drives real agent turns over the `omp --mode rpc` protocol, reads your local
`~/.omp/agent` state, and surfaces your GitHub context through the `gh` CLI — so
you can run, inspect, and manage agent work without living in a terminal.

## Features

- **Dashboard** — a single pane that aggregates recent sessions, model and
  provider counts, configured MCP servers, available skills, bundled agents, and
  the current GitHub repository.
- **Live agent chat** — full agent turns over the `omp` RPC protocol, with
  streaming assistant text, thinking blocks, live tool-call rendering, steering,
  and follow-ups, each session backed by its own `omp` child process.
- **Workspaces** — first-class project workspaces with a sidebar switcher, an
  add-workspace dialog, and pinning. Selecting a workspace points new chats at
  its directory; live sessions keep their own working directory.
- **Subagent drill-in** — expand a session's subagent workflow tree and open any
  node in an inspector to follow its live progress, tool calls, and transcript.
- **Sessions browser** — browse and replay past session transcripts read
  directly from the on-disk `omp` session log.
- **Skills & Commands** — discover project, user, and bundled skills, browse the
  active session's available slash commands (pin favorites, drop them into a
  chat), and view a reference of TUI-only commands.
- **MCP servers** — inspect the Model Context Protocol servers configured for
  your user and project.
- **Bundled agents** — explore the task agents shipped with `omp`, including
  their models and spawn relationships.
- **Models / Providers** — review the model catalog and which providers are
  authenticated.
- **GitHub** — view the current repository, its issues and pull requests, and
  your owned repositories.
- **Linear** — connect a Linear API key (stored in the OS keychain, never in
  settings) to browse your teams, projects, and issues; the key and all HTTP
  stay in the main process.
- **Terminal** — an opt-in embedded terminal running a real shell in the active
  workspace via `node-pty` (off by default).
- **Browser** — an opt-in embedded web browser rendered in a separate, sandboxed
  view isolated from the privileged app window (off by default).
- **Draggable layout** — resizable sidebar and chat panels, with reorderable,
  collapsible, and hideable rail panels and nav items, persisted across launches.

## Requirements

- **Node.js >= 20**
- **`omp`** installed and authenticated (the harness OMP Studio drives). Verify
  with `omp --version`.
- **`gh`** (GitHub CLI) installed and authenticated for the GitHub features.
  Verify with `gh auth status`.
- **macOS, Linux, or Windows.**

OMP Studio probes the common install locations for `omp` and `gh` (Homebrew,
`~/.bun/bin`, `~/.local/bin`) so it works even when launched as a packaged app
with a minimal `PATH`. Set the `OMP_BINARY` environment variable to override the
`omp` binary location.

## Quick start

```sh
npm install
npm run dev
```

`npm run dev` launches the app in development mode with hot-reloading renderer
and main processes via electron-vite.

## Build

```sh
# Type-check both the node and web TypeScript projects
npm run typecheck

# Bundle main, preload, and renderer into out/
npm run build

# Build distributable installers into release/ (dmg / AppImage / nsis)
npm run dist
```

`npm run dist:mac` targets macOS only. Distributable packaging uses
electron-builder and downloads platform Electron binaries, so it runs locally
or in the release workflow rather than in CI.

## Testing

```sh
# RPC bridge integration test (handshake only; live model turn needs RPC_LIVE=1)
npm run test:rpc

# Electron end-to-end smoke against the built app (launch / render / navigation)
npm run build && npm run test:e2e
```

`npm run test:e2e` uses Playwright's `_electron` API to launch the bundled app
from `out/main/index.js`, so the app must be built first. The smoke suite
(`e2e/smoke.spec.ts`) is **non-live and hermetic**: it never starts a chat, and
it launches the app with `omp`/`gh` pointed at a nonexistent binary and the
agent-state dir at an empty temp dir, so the data services hit their
graceful-degrade path and no `omp`/`gh` child is spawned. The result is
identical whether or not `omp`/`gh` are installed. It asserts the window title,
the sidebar navigation, the Dashboard, and that every browse view (Sessions,
Skills, MCP, Agents, GitHub, Settings) navigates without a renderer crash.

Electron needs a display server even for a smoke launch, so on headless Linux CI
wrap the command with xvfb:

```sh
xvfb-run -a npm run test:e2e
```

Live, paid end-to-end scenarios (a real chat turn, D1 approval approve/deny and
input/select round-trips, D3 restart/resume, and D2 two-session concurrency) live
in `e2e/live.spec.ts` and are gated behind `STUDIO_E2E_LIVE=1` (mirroring
`RPC_LIVE=1`). They are **skipped by default** — `npm run test:e2e` and CI never
spawn a paid turn. Unlike the smoke, they launch against the **installed** `omp`
(no hermetic `OMP_BINARY`/`GH_BINARY` overrides), isolate the studio's settings in
a temp `--user-data-dir`, run each chat in a throwaway project dir, and keep
prompts tiny. Run them locally with a configured `omp`:

```sh
npm run build && STUDIO_E2E_LIVE=1 npm run test:e2e
```

## Architecture

OMP Studio follows the standard Electron three-process split. The renderer never
touches Node or Electron directly; it calls a typed `window.omp` bridge that the
preload script exposes, which forwards to `ipcMain` handlers in the main process.
The main process owns the `omp` RPC child processes and all data services.

```mermaid
flowchart LR
  subgraph Renderer["Renderer (React)"]
    UI["Views and components"]
    API["window.omp (OmpApi)"]
  end
  subgraph Preload["Preload"]
    Bridge["contextBridge -> ipcRenderer"]
  end
  subgraph Main["Main process"]
    IPC["ipcMain handlers"]
    Data["Data services"]
    RPC["RPC session bridge"]
  end
  subgraph External["External"]
    OMP["omp --mode rpc"]
    State["~/.omp/agent state"]
    GH["gh CLI"]
  end

  UI --> API
  API --> Bridge
  Bridge -->|invoke / on| IPC
  IPC --> Data
  IPC --> RPC
  RPC <-->|JSONL stdio| OMP
  Data --> State
  Data --> GH
  RPC -->|evt:rpc / evt:lifecycle| Bridge
```

For the full process model, RPC protocol bridge, data sources, shared type
contract, IPC channel map, and security notes, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project layout

```text
omp-studio/
├─ src/
│  ├─ main/                 Electron main process
│  │  ├─ index.ts           App bootstrap, window, IPC registration
│  │  ├─ paths.ts           Binary + omp state path resolution
│  │  ├─ omp/               RPC session bridge + registry
│  │  ├─ services/          Read-only data services (sessions, mcp, ...)
│  │  └─ ipc/               chat.ts + data.ts ipcMain handlers
│  ├─ preload/
│  │  └─ index.ts           Exposes the typed window.omp bridge
│  ├─ renderer/
│  │  ├─ index.html
│  │  └─ src/               React app (views, components, store, lib)
│  └─ shared/               Frozen cross-process contract
│     ├─ ipc.ts             Channel map (CH) + OmpApi surface
│     ├─ rpc.ts             omp RPC protocol + message types
│     └─ domain.ts          App-level domain types
├─ docs/ARCHITECTURE.md
├─ electron.vite.config.ts
└─ package.json
```

## How chat works (RPC)

Each chat is backed by its own `omp --mode rpc --cwd <dir>` child process,
spawned and tracked by the session registry in the main process. The bridge
writes newline-delimited JSON commands (`prompt`, `steer`, `follow_up`, `abort`,
`get_state`, ...) to the child's stdin and reads JSONL frames from its stdout.
The first frame is `{"type":"ready"}`; subsequent frames are either command
responses (echoing the command `id`) or unsolicited event frames
(`message_update`, `tool_execution_*`, `agent_end`, and so on).

A `prompt` is acknowledged immediately; the turn completes later with an
`agent_end` frame. The bridge forwards every frame to the renderer over the
`evt:rpc` channel and reports session lifecycle changes over `evt:lifecycle`, so
the chat view renders streaming output as it arrives. The bridge also
auto-responds to `extension_ui_request` frames so `omp` never blocks waiting on
UI that the desktop app does not present. When the renderer disposes a session,
the bridge closes stdin and the `omp` process exits cleanly.

## Contributing

Contributions are welcome. Before opening a pull request:

1. Run `npm run typecheck` and ensure it passes.
2. Run `npm run build` to confirm the app bundles.
3. Run `npm run test:rpc` for the RPC bridge tests.
4. Run `npm run build && npm run test:e2e` for the Electron smoke suite.

Keep changes focused, follow the existing TypeScript and component conventions,
and update [CHANGELOG.md](CHANGELOG.md) under `## [Unreleased]`. Issue and pull
request templates are provided under `.github/`.

## License

[MIT](LICENSE) © 2026 Dylan McCavitt.

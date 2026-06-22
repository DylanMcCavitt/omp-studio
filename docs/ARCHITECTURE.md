# Architecture

OMP Studio is an Electron desktop client for the Oh My Pi (`omp`) coding-agent
harness. It does not reimplement any agent logic: it drives the real `omp`
binary over its RPC protocol, reads `omp`'s on-disk state, and shells out to the
GitHub CLI. This document describes how the pieces fit together.

## Process model

The app uses the standard Electron three-process model, plus the external
processes it controls.

```mermaid
flowchart TB
  subgraph R["Renderer process (Chromium + React)"]
    Views["Views: Dashboard, Chat, Sessions, Skills, Mcp, Agents, GitHub, Settings"]
    Store["Zustand store"]
    Omp["window.omp (OmpApi)"]
  end
  subgraph P["Preload (isolated bridge)"]
    CB["contextBridge.exposeInMainWorld('omp')"]
  end
  subgraph M["Main process (Node)"]
    Boot["index.ts bootstrap"]
    ChatIpc["ipc/chat.ts"]
    DataIpc["ipc/data.ts"]
    Registry["omp/registry.ts (SessionRegistry)"]
    Session["omp/rpc-session.ts"]
    Services["services/*"]
  end
  subgraph X["External processes & state"]
    Child["omp --mode rpc child"]
    Models["omp models / omp agents"]
    Disk["~/.omp/agent (JSONL, mcp.json)"]
    Gh["gh CLI"]
  end

  Views --> Omp --> CB
  CB -->|ipcRenderer.invoke| ChatIpc
  CB -->|ipcRenderer.invoke| DataIpc
  CB -->|ipcRenderer.on| ChatIpc
  ChatIpc --> Registry --> Session <-->|stdin/stdout JSONL| Child
  DataIpc --> Services
  Services --> Models
  Services --> Disk
  Services --> Gh
  Boot --> ChatIpc
  Boot --> DataIpc
```

- **Renderer** — a React 18 application. It is sandboxed from Node and Electron
  and communicates with the backend exclusively through the typed `window.omp`
  object. Routing between views is driven by a Zustand store.
- **Preload** — `src/preload/index.ts`. Runs with context isolation and exposes
  a single frozen `OmpApi` implementation on `window.omp`. Every method is a thin
  forwarder to `ipcRenderer.invoke` (request/response) or `ipcRenderer.on`
  (event subscriptions), keyed by the channel constants in `CH`.
- **Main** — `src/main/index.ts` creates the `BrowserWindow`, registers the data
  and chat IPC handlers, and owns the `SessionRegistry`. It is the only process
  that touches the filesystem, spawns child processes, or talks to `gh`.
- **External** — the `omp` binary (run as a long-lived `--mode rpc` child for
  chat, and one-shot for `omp models` / `omp agents unpack`), the on-disk `omp`
  agent state, and the `gh` CLI.

`src/main/paths.ts` centralizes process boundaries with the host: `ompBinary()`
and `ghBinary()` probe common install locations (and honor the `OMP_BINARY`
override) so packaged apps with a minimal `PATH` still find their tools;
`agentDir()`, `sessionsDir()`, and `mcpConfigPath()` resolve the `omp` state
locations (honoring `PI_CODING_AGENT_DIR`); and `augmentedEnv()` builds a `PATH`
for spawned subprocesses.

## The RPC protocol bridge

Chat is the one area where the main process holds long-lived state. Each chat
session corresponds to a dedicated `omp --mode rpc --cwd <dir>` child process,
created and tracked by `SessionRegistry` (`src/main/omp/registry.ts`) and driven
by a session wrapper (`src/main/omp/rpc-session.ts`).

The protocol is newline-delimited JSON (JSONL) over the child's stdio:

- **Startup.** The bridge spawns the child and waits for the first stdout frame,
  `{"type":"ready"}`, before reporting the session ready.
- **Commands (bridge → child, on stdin).** Each command is one JSON object with
  an optional `id`, for example `prompt` `{message, images?, streamingBehavior?}`,
  `steer`, `follow_up`, `abort`, `get_state`, `get_messages`, `set_model`
  `{provider, modelId}`, `set_thinking_level` `{level}`, and `get_subagents`.
- **Responses (child → bridge, on stdout).** A frame with `type:"response"`
  echoes the originating command `id` and carries `success` plus `data` or
  `error`. The bridge matches responses to pending commands by `id`.
- **Events (child → bridge, on stdout).** Frames without an `id` stream agent
  activity: `agent_start`, `agent_end`, `turn_start`/`turn_end`,
  `message_start`/`message_update`/`message_end`, `tool_execution_start`/
  `update`/`end`, `subagent_lifecycle`/`progress`/`event`,
  `available_commands_update`, and others. `message_update` carries both
  incremental `assistantMessageEvent` deltas and a full `message` snapshot.
- **A `prompt` is asynchronous.** It is acknowledged immediately with
  `success:true`; the turn finishes later with an `agent_end` event. While a turn
  is streaming, a further `prompt` must specify `streamingBehavior` of `"steer"`
  or `"followUp"`.
- **Auto-responding to UI requests.** `extension_ui_request` frames would
  otherwise block the agent waiting on interactive UI the desktop app does not
  surface. The bridge replies on stdin with `{type:"extension_ui_response", id,
  ...}` using safe defaults (`{confirmed:false}` for confirms, `{cancelled:true}`
  for selects/inputs/editors) and ignores fire-and-forget UI frames
  (`notify`, `setStatus`, `setWidget`, `setTitle`).
- **Teardown.** Disposing a session closes the child's stdin, on which `omp`
  exits 0. `SessionRegistry.disposeAll()` runs on `window-all-closed` and
  `before-quit` so no orphan processes survive the app.

Every frame the bridge reads is forwarded to the renderer verbatim over the
`evt:rpc` channel (wrapped as `{sessionId, frame}`), and session lifecycle
transitions (`spawning`, `ready`, `exited`, `error`) are pushed over
`evt:lifecycle`. The renderer reconstructs streaming chat state from this frame
stream.

### Chat prompt round-trip

```mermaid
sequenceDiagram
  participant V as Chat view (renderer)
  participant W as window.omp (preload)
  participant I as ipc/chat.ts (main)
  participant S as RPC session
  participant O as omp child

  V->>W: chat.prompt(sessionId, text)
  W->>I: invoke("chat:prompt", ...)
  I->>S: prompt(text)
  S->>O: stdin {id, type:"prompt", message}
  O-->>S: stdout {id, type:"response", success:true}
  S-->>I: resolves
  I-->>W: invoke resolves
  W-->>V: prompt() resolves (ack)

  loop streaming turn
    O-->>S: stdout event frame (message_update, tool_execution_*)
    S-->>I: frame
    I-->>W: send "evt:rpc" {sessionId, frame}
    W-->>V: onEvent(frame) -> update UI
  end

  O-->>S: stdout {type:"agent_end"}
  S-->>I: frame
  I-->>W: send "evt:rpc" {sessionId, frame}
  W-->>V: onEvent(agent_end) -> turn complete
```

## Data services and their sources

The read-only browsers are backed by services under `src/main/services`, invoked
through `ipc/data.ts`. Each service maps a host source into a domain type from
`src/shared/domain.ts` and degrades gracefully (returning `null`/`[]` rather than
throwing across IPC) when a source is missing.

| Service | Source | Domain output |
| --- | --- | --- |
| Dashboard | aggregate of the services below | `DashboardData` |
| Sessions | `~/.omp/agent/sessions/<slug>/<ts>_<uuid>.jsonl` | `SessionSummary[]`, `SessionTranscript` |
| MCP servers | `~/.omp/agent/mcp.json` + project `./.mcp.json` | `McpServerInfo[]` |
| Skills | `./.agents/skills/*/SKILL.md`, `~/.agents/skills/*/SKILL.md`, workflow-kit skills | `SkillInfo[]` |
| Agents | `omp agents unpack --json` (temp dir) + user/project `*.md` | `AgentInfo[]` |
| Models | `omp models --json` (parsed from the first `{`) | `ModelInfo[]` |
| Providers | grouped from the model catalog | `ProviderInfo[]` |
| GitHub | `gh repo/issue/pr/repo list --json ...` | `GhRepo`, `GhIssue[]`, `GhPr[]` |

Session JSONL is line-oriented: the first line is a `{type:"session", ...}`
header, followed by `{type:"message", message:OmpMessage}` records and metadata
records such as `model_change` and `thinking_level_change`. Model output from
`omp models --json` is preceded by extension warnings on stdout, so the parser
seeks the first `{` before decoding. Agent discovery unpacks bundled agents to a
temporary directory, reads their `---` frontmatter (`name`, `description`,
`model`, `spawns`), and cleans the directory up.

## The shared type contract

`src/shared` is the single source of truth shared by all three processes and is
treated as frozen:

- **`rpc.ts`** — the `omp` RPC protocol surface: `ThinkingLevel`, the
  message/content-block model (`OmpMessage`, `ContentBlock`, `TextBlock`,
  `ThinkingBlock`, `ToolCallBlock`), `RpcState`, `RpcFrame` and its refinements
  (`MessageUpdateFrame`, `ToolExecutionFrame`, `AgentEndFrame`), `AvailableModel`,
  `SubagentInfo`, and todo types.
- **`domain.ts`** — app-level read-only types surfaced in the browsers:
  `SessionSummary`, `SessionTranscript`, `McpServerInfo`, `SkillInfo`,
  `AgentInfo`, `ProviderInfo`, `ModelInfo`, the GitHub types, and the
  `DashboardData` aggregate.
- **`ipc.ts`** — the channel map `CH` and the `OmpApi` interface that the preload
  implements and the renderer consumes, plus the chat payload types
  (`ChatCreateOptions`, `PromptOptions`, `ChatRpcEvent`, `ChatLifecycleEvent`).

Because the preload, main handlers, and renderer all import the same definitions,
the IPC surface stays in lockstep and is checked by `npm run typecheck` (separate
`tsconfig.node.json` and `tsconfig.web.json` projects). Path aliases:
`@shared/*` resolves to `src/shared/*` in every process, and `@/*` resolves to
`src/renderer/src/*` in the renderer only.

## IPC channel map (`CH`)

All channel names are defined once in `src/shared/ipc.ts` as `CH`. They divide
into request/response channels (handled with `ipcMain.handle` /
`ipcRenderer.invoke`) and event channels (main → renderer pushes).

**Read-only data (`data:*`)**

| `CH` key | Channel | Purpose |
| --- | --- | --- |
| `dashboard` | `data:dashboard` | Aggregate dashboard payload |
| `listSessions` | `data:sessions:list` | Session summaries |
| `readSession` | `data:sessions:read` | One session transcript |
| `listMcp` | `data:mcp:list` | MCP servers |
| `listSkills` | `data:skills:list` | Skills |
| `listAgents` | `data:agents:list` | Bundled/discovered agents |
| `listModels` | `data:models:list` | Model catalog |
| `listProviders` | `data:providers:list` | Providers + auth status |
| `pickDirectory` | `data:pickDirectory` | Native directory picker |
| `openExternal` | `data:openExternal` | Open a URL in the OS browser |
| `searchSessions` | `data:searchSessions` | Transcript search hits |

**GitHub (`gh:*`)**

| `CH` key | Channel | Purpose |
| --- | --- | --- |
| `ghCurrentRepo` | `gh:currentRepo` | Current repository (or null) |
| `ghListRepos` | `gh:repos` | Owned repositories |
| `ghListIssues` | `gh:issues` | Issues |
| `ghListPrs` | `gh:prs` | Pull requests |

**Chat request/response (`chat:*`)**

| `CH` key | Channel | Purpose |
| --- | --- | --- |
| `chatCreate` | `chat:create` | Spawn an `omp` RPC session |
| `chatPrompt` | `chat:prompt` | Send a prompt |
| `chatSteer` | `chat:steer` | Steer the active turn |
| `chatFollowUp` | `chat:followUp` | Queue a follow-up |
| `chatAbort` | `chat:abort` | Abort the active turn |
| `chatSetModel` | `chat:setModel` | Change model |
| `chatSetThinking` | `chat:setThinking` | Change thinking level |
| `chatGetState` | `chat:getState` | Fetch session state |
| `chatGetMessages` | `chat:getMessages` | Fetch session messages |
| `chatGetSubagents` | `chat:getSubagents` | List subagents |
| `chatDispose` | `chat:dispose` | Tear down the session |
| `chatList` | `chat:list` | List open-session descriptors |
| `chatResume` | `chat:resume` | Resume a session from its JSONL path |
| `chatClose` | `chat:close` | Dispose the live child (keeps transcript) |
| `chatRespondUi` | `chat:uiRespond` | Renderer reply to a UI request |
| `chatGetSessionStats` | `chat:getSessionStats` | Token/cost/context stats |
| `chatCompact` | `chat:compact` | Compact the transcript |

**Session actions (`data:sessions:*`, mutating)**

| `CH` key | Channel | Purpose |
| --- | --- | --- |
| `sessionRename` | `data:sessions:rename` | Rename a session title |
| `sessionDelete` | `data:sessions:delete` | Move a session to the OS trash |
| `sessionArchive` | `data:sessions:archive` | Archive / unarchive a session |
| `sessionReveal` | `data:sessions:reveal` | Reveal the JSONL file in the host |
| `sessionExportHtml` | `data:sessions:exportHtml` | Export a session to HTML |

**Settings (`settings:*`)**

| `CH` key | Channel | Purpose |
| --- | --- | --- |
| `settingsGet` | `settings:get` | Read persisted studio settings |
| `settingsUpdate` | `settings:update` | Merge a settings patch |

**Events (main → renderer)**

| `CH` key | Channel | Payload |
| --- | --- | --- |
| `evtRpc` | `evt:rpc` | `{sessionId, frame}` — forwarded RPC frames |
| `evtLifecycle` | `evt:lifecycle` | `{sessionId, status, detail?}` |
| `evtUiRequest` | `evt:ui-request` | `{sessionId, request, responseRequired}` |

## Security notes

- **Context isolation is on.** The `BrowserWindow` is created with
  `contextIsolation: true`, so the renderer's JavaScript context is separated
  from the preload and Electron internals. The preload uses
  `contextBridge.exposeInMainWorld` to publish only the curated `OmpApi`; the
  renderer has no access to `ipcRenderer`, `require`, or Node built-ins.
- **No remote content.** The renderer only ever loads the local bundle (the dev
  server URL in development, the built `index.html` in production). External
  navigations are denied via `setWindowOpenHandler`, which routes URLs to the OS
  browser through `shell.openExternal` instead of opening them in-app.
- **Content Security Policy.** `index.html` ships a restrictive CSP:
  `default-src 'self'`, `script-src 'self'` (no inline or remote scripts),
  `connect-src 'self'`, with `img-src` limited to `self`, `data:`, and `https:`.
- **The renderer cannot reach the host directly.** Filesystem access, subprocess
  spawning (`omp`, `gh`), and shell commands all live in the main process behind
  the typed IPC surface. Data services never throw across the IPC boundary;
  missing tools or unauthenticated CLIs degrade to empty/null results.
- **Child-process hygiene.** RPC sessions are tracked in `SessionRegistry` and
  disposed on window close and quit, so no `omp` child outlives the app.

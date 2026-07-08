# RPC bridge

The RPC bridge is the main-process subsystem that spawns and drives a real
`omp` child for each chat. Every chat session is a dedicated
`omp --mode rpc-ui --cwd <dir>` child process, created and tracked by
`SessionRegistry` (`src/main/omp/registry.ts`) and driven by a per-session
wrapper, `OmpRpcSession` (`src/main/omp/rpc-session.ts`), over newline-delimited
JSON on the child's stdio. The bridge writes commands to stdin, parses JSONL
frames from stdout, matches responses to pending commands by `id`, forwards
every event frame to the renderer, and tears the child down on close. OMP Studio
implements no agent logic itself; the bridge is a thin, typed adapter onto the
`omp` RPC protocol described in [`../primitives/rpc-protocol.md`](../primitives/rpc-protocol.md). The process model and the chat prompt round-trip sequence diagram are summarized in [`../overview/architecture.md`](../overview/architecture.md).

## Directory layout

```text
src/main/omp/
  registry.ts     SessionRegistry — spawns/tracks live + hibernated sessions, persists descriptors
  rpc-session.ts  OmpRpcSession — the per-child JSONL stdio bridge wrapper
src/main/ipc/
  chat.ts         registerChatIpc — the chat:* ipcMain handlers in front of the registry
src/shared/
  rpc.ts          RpcFrame and the protocol type refinements (events, subagents, UI requests)
  ipc.ts          CH channel map + ChatCreateOptions / PromptOptions / ChatRpcEvent / ChatLifecycleEvent
src/main/
  index.ts        constructs the registry, hydrates it on boot, disposes it on quit
```

## Key abstractions

| Abstraction | File | Role |
| --- | --- | --- |
| `SessionRegistry` | `src/main/omp/registry.ts` | Owns the set of live `OmpRpcSession` children plus the persisted descriptor of every open chat (live or hibernated), keyed by an opaque studio session id. Spawns, resumes, hibernates, disposes, and persists descriptors. |
| `OmpRpcSession` | `src/main/omp/rpc-session.ts` | The per-child bridge wrapper. Spawns the `omp` child, buffers and parses stdout JSONL, writes commands to stdin, matches `response` frames to pending commands by `id`, emits `frame` / `lifecycle` / `ui-request` / `exit` events, and tears the child down on `dispose()`. |
| Command / response model | `src/main/omp/rpc-session.ts`, `src/shared/rpc.ts` | Every stdin command carries a synthetic `id` (`req_<n>`). The child replies with a `type:"response"` frame echoing that `id` with `success` plus `data` or `error`. The bridge resolves or rejects the awaiting promise on the match. |
| The `ready` handshake | `src/main/omp/rpc-session.ts` | The first stdout frame must be `{"type":"ready"}`. `markReady()` resolves `whenReady()`, emits a `lifecycle:"ready"` event, and immediately sends `set_subagent_subscription {level:"events"}` (and `set_thinking_level` when an initial level was requested). |
| Subagent subscription | `src/main/omp/rpc-session.ts` | On by default. `markReady()` sends `set_subagent_subscription {level:"events"}` so subagent telemetry streams for every session with no further request. |
| `OpenSessionDescriptor` | `src/shared/ipc.ts` | The persisted shape of one open chat: studio id, cwd, timestamps, title, model/thinking/approval prefs, the resume token (`sessionFile` or `ompSessionId`), and `status` (`open` / `hibernated` / `closed`). |

## How it works

### Spawn and the ready handshake

`SessionRegistry.create()` builds an `OmpRpcSession`, which spawns:

```text
omp --mode rpc-ui --cwd <dir> [--model <selector>] [--resume <token>] \
    --approval-mode <always-ask|write|yolo> [--auto-approve]
```

The child's stdio is three pipes. The bridge reads stdout line by line,
drains stderr to the scoped logger, and swallows stdin EPIPE on close. A
spawn-to-ready deadline (`DEFAULT_READY_TIMEOUT_MS`, 30s, `unref`'d) kills the
child and rejects `whenReady()` if `omp` never emits `ready`, so a hung binary
or broken install fails fast instead of hanging the renderer's `chat:create`
IPC forever. `SessionRegistry.startSession()` awaits `whenReady()` and then
calls `getState()` to capture the initial `RpcState` (model, tools, session
file, session id) before registering the record and persisting.

### Protocol lifecycle

```mermaid
sequenceDiagram
  participant R as Renderer (chat store)
  participant I as ipc/chat.ts
  participant G as SessionRegistry
  participant S as OmpRpcSession
  participant O as omp child

  R->>I: chat:create({cwd, model, ...})
  I->>G: create(opts)
  G->>S: new OmpRpcSession(spawn)
  S->>O: spawn omp --mode rpc-ui --cwd
  O-->>S: stdout {"type":"ready"}
  S->>S: markReady() — clear ready timer, resolve whenReady
  S->>O: stdin set_subagent_subscription {level:"events"}
  S->>O: stdin get_state {id}
  O-->>S: stdout {id, type:"response", success:true, data:RpcState}
  S-->>G: state resolved
  G->>G: register(id, session, descriptor); persist()
  I->>I: forward(id, session) — wire frame/lifecycle/ui-request sends
  I-->>R: {sessionId, state} (chat:create resolves)

  R->>I: chat:prompt(sessionId, text)
  I->>S: prompt(text)
  S->>O: stdin {id, type:"prompt", message}
  O-->>S: stdout {id, type:"response", success:true}  (immediate ack)
  S-->>I: prompt() resolves
  I-->>R: prompt() resolves (ack)

  loop streaming turn
    O-->>S: stdout event frame (message_update, tool_execution_*, ...)
    S-->>I: "frame" event
    I-->>R: send evt:rpc {sessionId, frame}
  end

  O-->>S: stdout {"type":"agent_end"}
  S-->>I: "frame" event (agent_end)
  I-->>R: send evt:rpc {sessionId, frame:agent_end}
  S->>G: onTurnEnd(id) — refresh lastActiveAt; persist()

  Note over R,S: Teardown (close / hibernate / dispose / quit)
  R->>I: chat:close(sessionId)
  I->>G: hibernate(id)
  G->>S: dispose()
  S->>S: removeAllListeners() BEFORE kill (load-bearing)
  S->>O: stdin.end(); child.kill(SIGTERM)
  O-->>O: stdin closed -> omp exits 0
  Note over S: SIGKILL escalation after 2s grace if still alive
```

### Commands the bridge writes to stdin

Every command is written as one JSON object terminated by `\n`. The bridge
assigns a synthetic `id` (`req_<n>`); `omp` echoes it back on the matching
`response` frame.

| Command | Method on `OmpRpcSession` | Payload | Deadline |
| --- | --- | --- | --- |
| `prompt` | `prompt(message, opts?)` | `message`, optional `images`, optional `streamingBehavior` | Unbounded (resolves at turn end) |
| `steer` | `steer(message)` | `message` | Unbounded |
| `follow_up` | `followUp(message)` | `message` | Unbounded |
| `compact` | `compact(customInstructions?)` | optional summary steering | Unbounded |
| `abort` | `abort()` | none | 15s |
| `get_state` | `getState()` | none | 15s |
| `get_messages` | `getMessages()` | none | 15s |
| `get_subagents` | `getSubagents()` | none | 15s |
| `get_subagent_messages` | `getSubagentMessages(sel)` | `subagentId?`, `sessionFile?`, `fromByte?` | 15s (degrades on older omp) |
| `get_available_commands` | `getAvailableCommands()` | none | 15s (degrades on older omp) |
| `get_session_stats` | `getSessionStats()` | none | 15s (degrades on older omp) |
| `set_model` | `setModel(provider, modelId)` | `provider`, `modelId` | 15s |
| `set_thinking_level` | `setThinking(level)` | `level` | 15s (also auto-sent at `ready`) |
| `set_subagent_subscription` | `setSubagentSubscription(level)` | `level` (`off`/`progress`/`events`) | 15s (auto-sent at `ready`; degrades on older omp) |
| `extension_ui_response` | `respondUi(id, response)` | the UI response payload | n/a (writes the reply to a UI request) |

The four unbounded commands (`prompt`, `steer`, `follow_up`, `compact`) resolve
at the end of an agent turn or a compaction, so they carry no per-command
deadline; a long turn is normal operation, not a hang. Every other command
carries a 15s deadline (`DEFAULT_COMMAND_TIMEOUT_MS`, `unref`'d) so a lost
response can never hang a caller. Optional commands that an older `omp` build
does not implement degrade silently: `omp` replies with an id-less
`{success:false, error:"Unknown command: ..."}` failure, which the bridge
matches by command name (see below) and the method swallows via
`isUnknownCommand`, returning a safe empty result.

### Response matching

`dispatch()` routes each parsed stdout line:

- `type:"response"` with a string `id` — looked up in the `pending` map,
  deadline cleared, and the awaiting promise resolved with `frame.data` or
  rejected with `frame.error`.
- `type:"response"` with `id === undefined` and `success === false` — an
  unknown-command (or parse) failure the child could not correlate. The bridge
  rejects the earliest in-flight pending request whose `command` matches
  `frame.command`, so callers like `getSessionStats` degrade instead of
  hanging on a command the installed `omp` does not implement.
- `type:"extension_ui_request"` — routed to `handleExtensionUi()`.
- `type:"ready"` — `markReady()`.
- `type:"auto_compaction_start"` / `auto_compaction_end` — flip the
  `compacting` flag exposed by `isCompacting()`.
- Everything else — emitted as a `frame` event and forwarded to the renderer.

### Event frames the bridge reads

`RpcFrame` (`src/shared/rpc.ts`) is intentionally loose: `type: string` plus an
open index. The bridge forwards every non-response, non-ui-request frame
verbatim; the renderer's `session-reducer.ts` shapes them. The known `type`
values carried over the wire:

- `ready` (handshake)
- `agent_start`, `agent_end`, `turn_start`, `turn_end`
- `message_start`, `message_update`, `message_end`
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`, `todo_auto_clear`
- `subagent_lifecycle`, `subagent_progress`, `subagent_event`
- `available_commands_update`
- `extension_ui_request`

`message_update` carries an `assistantMessageEvent` whose `type` is a delta kind
(`text_delta`, `thinking_delta`, `toolcall_delta`, ...). `tool_execution_*`
frames carry `toolCallId`, `toolName`, `arguments`, and (on `end`) a `result`.
`agent_end` may carry the final `messages` snapshot. These refinements are
typed in `src/shared/rpc.ts` (`MessageUpdateFrame`, `ToolExecutionFrame`,
`AgentEndFrame`, the subagent frames) but the bridge treats them all as
`RpcFrame` and forwards without interpretation.

### Extension UI requests

`extension_ui_request` frames would otherwise block the agent waiting on
interactive UI. The bridge splits them by method:

- **Response-required methods** (`confirm`, `select`, `input`, `editor`,
  `cancel`) are forwarded to the renderer over `evt:ui-request` with
  `responseRequired: true`, tracked in `pendingUi` with a fail-closed timeout
  (the request's own `timeout` when present, else 5 minutes,
  `DEFAULT_UI_REQUEST_TIMEOUT_MS`). The renderer answers through
  `chat:uiRespond` -> `OmpRpcSession.respondUi()`, which writes an
  `extension_ui_response` frame back to the child. If the host stays silent past
  the deadline, `timeoutUi()` writes the safe default itself so `omp` never
  blocks: `{confirmed:false, timedOut:true}` for `confirm`, and
  `{cancelled:true, timedOut:true}` for `select` / `input` / `editor` /
  `cancel`.
- **Hint methods** (`notify`, `setStatus`, `setWidget`, `setTitle`,
  `set_editor_text`, `open_url`) are forwarded with `responseRequired: false`
  and no tracked timeout. They are fire-and-forget: the renderer renders the
  hint (or the explicit open-url action) and the bridge never writes a reply.
  `respondUi()` is a no-op for these ids.

The split is defined by `RESPONSE_REQUIRED_UI_METHODS` in
`src/main/omp/rpc-session.ts`. The full method set and the
`ExtensionUiRequest` / `ExtensionUiResponse` shapes live in
`src/shared/rpc.ts`.

### Async prompt semantics

A `prompt` is acknowledged immediately: `omp` replies with a
`{id, type:"response", success:true}` frame as soon as it accepts the message,
so `chat:prompt` resolves right away. The actual turn then streams as
unsolicited event frames (`message_update`, `tool_execution_*`, ...) and
finishes with an `agent_end` frame. While a session is already streaming, a
further `prompt` must declare its intent via `PromptOptions.streamingBehavior`
(`"steer"` or `"followUp"`) so `omp` knows whether to redirect the in-flight
turn or queue a follow-up; the bridge passes `streamingBehavior` straight
through to the `prompt` command. `steer` and `follow_up` are the dedicated
commands for those mid-turn interventions. `abort` cancels the running turn.

### Frame forwarding to the renderer

`registerChatIpc` (`src/main/ipc/chat.ts`) wires each created or resumed session
once via its `forward(id, session)` helper. Every send goes through
`sendToWindow`, which drops the event silently if the `WebContents` is destroyed
(child stdio can outlive a closed/reloaded window):

- **`evt:rpc`** — `{sessionId, frame}` for every event frame the bridge emits.
- **`evt:lifecycle`** — `{sessionId, status, detail}` where `status` is
  `ready`, `exited`, or `error` (the bridge itself never emits `spawning`;
  that status is the renderer's pre-ready state, set optimistically in
  `src/renderer/src/store/chat.ts` while `chat:create` is in flight).
- **`evt:ui-request`** — `{sessionId, request, responseRequired}` for every
  extension UI request, both response-required and hint.

How the renderer consumes this stream and reduces it into per-session render
state is covered in [`../features/chat/index.md`](../features/chat/index.md).

### Teardown

`OmpRpcSession.dispose()` is the deliberate teardown path, and its ordering is
load-bearing: `removeAllListeners()` runs **before** the child is killed, so the
`exit` event the kill produces never reaches the registry's self-exit listener
(which would otherwise mark the record hibernated and re-persist). The steps:

1. Flag `disposed` / `terminated`; clear the ready timer.
2. If still in the spawn-to-ready window, reject `whenReady()` with
   `"session disposed"` so the awaiting `create` / `resume` unwinds.
3. Reject all pending commands and clear all pending UI requests (timers
   stopped, no fail-closed frames written; the child is about to die).
4. `stdin.end()` then `child.kill()` (SIGTERM).
5. If the child is still alive after the kill grace
   (`DEFAULT_KILL_GRACE_MS`, 2s, `unref`'d), escalate to `SIGKILL` so a
   `before-quit` can never leave an `omp` child behind.

On stdin close, `omp` exits 0; the bridge's `exit` handler calls
`settleTermination("exited", ...)`, which emits a final `lifecycle:"exited"`
event, rejects any remaining pending work, and clears pending UI. The tests in
`test/rpc-bridge.test.ts` confirm both the natural-exit (`lifecycle:"exited"`)
and the fail-closed UI timeout behavior.

## Subagent telemetry

Subagent streaming is on by default. At `markReady()` the bridge sends
`set_subagent_subscription {level:"events"}`, so the three subagent frame
types arrive as unsolicited events for every session with no per-session
request. The subscription level can be changed later with
`setSubagentSubscription(level)` (`off` / `progress` / `events`), useful for
cost control, e.g. dropping a background session to `off` while it is not
visible. The command degrades silently on an `omp` build that predates the
setter.

The three frame types (typed in `src/shared/rpc.ts`):

| Frame | Payload | Carries |
| --- | --- | --- |
| `subagent_lifecycle` | `SubagentLifecyclePayload` | A subagent `started` / `completed` / `failed` / `aborted`, its `agent` name and `agentSource` (`bundled` / `user` / `project`), `index`, `sessionFile`, and `parentToolCallId`. |
| `subagent_progress` | `SubagentProgressPayload` | A periodic `AgentProgress` snapshot: running tool, recent tool history, token/request counters, `status`, `task`. |
| `subagent_event` | `SubagentEventPayload` | A raw `RpcFrame` emitted by the named subagent, forwarded verbatim so the renderer can attribute child events. |

For the drill-in transcript, `getSubagentMessages(sel)` is an on-demand,
paginated read against a subagent's JSONL transcript. It returns a
`SubagentMessagesResult` cursor: `{sessionFile, fromByte, nextByte, reset,
entries, messages}`. A consumer passes `fromByte` to resume incremental
tailing; on `reset === true` (session-file rotation) it clears its cursor and
restarts from `nextByte`. Both `entries` (raw `FileEntry` records) and parsed
`messages` (`OmpMessage[]`) are returned. The command degrades to an empty
cursor on an `omp` build without it. The IPC handler in `src/main/ipc/chat.ts`
runs any renderer-supplied `sessionFile` through `containedSessionFile()` so a
hostile or corrupt path can never escape the sessions root before it reaches
the child. The on-disk transcript format itself is documented in
[`session-store.md`](session-store.md).

## Integration points

- **IPC front end.** `registerChatIpc` (`src/main/ipc/chat.ts`) is the only
  entry point the renderer can reach. Each `chat:*` handler is a thin
  `ipcMain.handle` wrapper that looks up the live `OmpRpcSession` via
  `registry.get(id)` (throwing `"unknown session"` when the id is hibernated or
  gone) and delegates to the matching session method. The handler layer is
  documented in [`ipc-layer.md`](ipc-layer.md).
- **Registry persistence.** `SessionRegistry` is authoritative for the
  open-session set. `persist()` writes the current `descriptors()` through the
  transactional `updateSettings` API in
  `src/main/services/settings-service.ts`, merging by id inside the settings
  write mutex so a racing renderer `settings:update` can never be clobbered.
  Persistence fires on `create`, turn-end (`agent_end`), `hibernate`, `dispose`,
  and self-exit. The persisted `openSessions` field is documented in
  [`settings-service.md`](settings-service.md).
- **Boot hydrate.** In `src/main/index.ts`, `app.whenReady()` calls
  `registry.hydrate((await loadSettings()).openSessions)` before any chat
  handler is registered. `hydrate()` seeds each persisted descriptor as a
  hibernated record (no live child, no listeners), so `chat:list` surfaces the
  full open set on a fresh boot and a later `resume` re-persists the whole set
  instead of clobbering the un-resumed descriptors. No children spawn at boot;
  the renderer resumes them on demand.
- **Resume.** `registry.resume(descriptor)` resolves a resume token
  (`sessionFile` when the transcript exists on disk, else `ompSessionId`,
  throwing a clear error when neither can drive a resume), spawns the child with
  `--resume <token>`, and keeps the studio session id stable across resume
  while refreshing `sessionFile` / `ompSessionId` from live state. A
  `hibernate()` or `dispose()` landing while a resume awaits `ready` flags a
  cancellation token that wins after the await; completing the resume anyway
  would resurrect a chat the user just closed. A resume targeting an
  already-live chat disposes the previous child before replacing the record.
- **Self-exit reconciliation.** `register()` attaches an `exit` listener that
  fires only for a child that dies on its own (crash, `omp` self-exit). Because
  `OmpRpcSession.dispose()` removes all listeners before killing, deliberate
  teardown never reaches this listener. On a genuine self-exit, the record is
  marked hibernated and re-persisted so the UI does not keep showing a dead
  chat as `open`.
- **Renderer consumption.** The renderer holds one global bridge subscription
  that routes `evt:rpc` frames to per-session slices and reduces them through
  the pure `reduceSession` reducer. That flow is covered in
  [`../features/chat/index.md`](../features/chat/index.md) and not repeated
  here.
- **Disposal on quit.** `src/main/index.ts` calls `registry.disposeAll()` on
  both `window-all-closed` and `before-quit`. `disposeAll()` disposes every live
  child (including any still in the spawn-to-ready `inFlight` set) but retains
  the descriptor records, marked hibernated, so the workspace survives an app
  restart. On macOS `window-all-closed` does not quit the app, so a reopened
  window can still list and resume these chats.

## Entry points for modification

- **Add a new command.** Add a typed method on `OmpRpcSession` that calls
  `this.send({ type: "...", ... })`, decide whether it is turn-length (add its
  `type` to `UNBOUNDED_COMMANDS`) or request/response (gets the 15s deadline),
  and degrade via `isUnknownCommand` if the command may be absent on older
  `omp` builds. Add the `chat:*` channel to `CH` and the `OmpApi.chat` surface
  in `src/shared/ipc.ts`, then a handler in `src/main/ipc/chat.ts` and a
  forwarder in `src/preload/index.ts`. Add any payload/response type to
  `src/shared/rpc.ts`.
- **Add a new event frame type.** Nothing in the bridge needs to change for a
  forwarded-only frame: `dispatch()` emits every non-response, non-ui-request
  frame as a `frame` event and `forward()` sends it over `evt:rpc`. Add a typed
  refinement in `src/shared/rpc.ts` and a reducer branch in
  `src/renderer/src/store/session-reducer.ts`. Only add bridge logic if the
  frame needs main-side state (the way `auto_compaction_*` flips `compacting`).
- **Change teardown.** Edit `OmpRpcSession.dispose()` and keep the
  `removeAllListeners()`-before-kill ordering intact, or the registry's
  self-exit listener will fire for deliberate teardown. Tune
  `DEFAULT_KILL_GRACE_MS` for the SIGTERM-to-SIGKILL grace. Registry-level
  teardown (hibernate vs. full dispose vs. `disposeAll`) lives in
  `SessionRegistry`.
- **Change the ready-time setup.** Edit `markReady()`. This is where the
  default subagent subscription and the initial thinking level are pushed.
- **Change persistence.** `SessionRegistry.persist()` and the `SessionStore`
  seam (defaulted to `updateSettings`) are the persistence boundary; the
  `hydrate()` path and the `OpenSessionDescriptor` shape in
  `src/shared/ipc.ts` govern what survives a restart.

## Key source files

| File | Purpose |
| --- | --- |
| `src/main/omp/rpc-session.ts` | `OmpRpcSession`: spawn, JSONL stdio, ready handshake, command/response matching, UI-request handling, teardown. |
| `src/main/omp/registry.ts` | `SessionRegistry`: live + hibernated record map, create/resume/hibernate/dispose, hydrate, persist, self-exit reconciliation. |
| `src/main/ipc/chat.ts` | `registerChatIpc`: the `chat:*` `ipcMain.handle` handlers and the `evt:rpc` / `evt:lifecycle` / `evt:ui-request` forwarders. |
| `src/shared/rpc.ts` | `RpcFrame` and refinements, `RpcState`, the message model, subagent telemetry types, `ExtensionUiRequest` / `ExtensionUiResponse`. |
| `src/shared/ipc.ts` | `CH` channel map, `ChatCreateOptions`, `PromptOptions`, `ChatRpcEvent`, `ChatLifecycleEvent`, `OpenSessionDescriptor`. |
| `src/main/index.ts` | Constructs the registry, hydrates it on boot, registers chat IPC, disposes on `window-all-closed` / `before-quit`. |
| `test/rpc-bridge.test.ts` | Integration + fake-child tests for the handshake, streaming turn, UI-request answering, and fail-closed timeout. |
| `test/registry.test.ts` | `SessionRegistry` create/resume/hibernate/dispose/list/persist behavior with an injectable factory and store. |
| `test/registry-exit.test.ts` | Self-exit reconciliation and the dispose-before-kill ordering guarantee. |
| `test/rpc-session-ui.test.ts` | `extension_ui_request` response-required vs. hint forwarding and `respondUi` correlation. |

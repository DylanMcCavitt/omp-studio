# Chat

Live chat is the core of OMP Studio. Each open chat is one real `omp --mode rpc-ui`
child process driven over a newline-delimited JSON stdio protocol. The app does
not reimplement any agent logic; it streams frames from the child, reduces them
into render state, and writes commands back. This page covers the renderer-side
shape of that pipeline. The protocol itself, the `SessionRegistry`, and the
`OmpRpcSession` bridge live in [`../systems/rpc-bridge.md`](../../systems/rpc-bridge.md);
the on-disk transcript reading/search/actions live in
[`../systems/session-store.md`](../../systems/session-store.md).

## Purpose

Give the user one native window that can host many concurrent `omp` chats, each
streaming in real time, with a composer, a reconciled transcript, live
subagents, tool approvals, and a usage panel. The renderer must stay cheap no
matter how many sessions are open, so the chat feature is built around a
normalized multi-session store with a single global subscription and a pure
reducer that is the only place session state is shaped.

## Directory layout

```
src/renderer/src/
├── views/Chat.tsx                 # the chat workspace + per-session surface
├── store/
│   ├── chat.ts                    # multi-session store: openSessions + ONE subscription
│   ├── session-reducer.ts         # pure reducer: the single source of truth for shape
│   └── approvals.ts               # per-session approval policy + always-allow allowlist
├── components/chat/
│   ├── Composer.tsx               # active-chat composer shell (send/steer/stop)
│   ├── PromptComposer.tsx         # reusable textarea + attachments + overlay seam
│   ├── MessageList.tsx            # virtualized transcript column
│   ├── MessageScroller.tsx        # right-edge message navigation trail
│   ├── MessageBubble.tsx          # one message -> content blocks
│   ├── ToolCallCard.tsx           # one tool call + its result
│   ├── Markdown.tsx               # react-markdown + rehype-highlight renderer
│   ├── ThinkingBlock.tsx          # collapsible reasoning block
│   ├── TodoPanel.tsx              # plan phases + status-iconed tasks
│   ├── SystemCardBubble.tsx       # inline slash-command system cards
│   ├── ModelControl.tsx           # composer model picker chip
│   ├── ThinkingControl.tsx        # header thinking-level picker
│   ├── ImageAttachmentStrip.tsx   # pending image thumbnails
│   ├── SlashCommandPalette.tsx    # composer-anchored slash palette
│   ├── AgentDropChooser.tsx       # dropped-agent routing chooser
│   ├── SubagentTree.tsx           # per-session subagent hierarchy
│   ├── SubagentInspector.tsx      # drill-in transcript + live feed
│   ├── SessionList.tsx            # left-rail session index
│   ├── SessionStatsPanel.tsx      # usage panel + header context chip
│   ├── CompactDialog.tsx          # manual context-compaction modal
│   ├── ChatPanelDock.tsx          # left-rail Usage / Plan / Subagents dock
│   ├── UiRequestLayer.tsx         # the active session's UI-request pipeline
│   └── ui-request/                # approval/select/input/editor dialogs + logic
├── components/transcript/
│   ├── TranscriptView.tsx         # shared transcript renderer (sessions + inspector)
│   └── ActivityRail.tsx           # right-column run timeline of tool steps
└── lib/
    ├── slash-commands.ts          # pure filter/insert helpers for the palette
    ├── images.ts                  # image attachment reading + validation
    └── model-options.ts           # settings default-model combobox options
```

## Key abstractions

| Abstraction | File | One line |
| --- | --- | --- |
| `LiveSessionState` | `src/renderer/src/store/session-reducer.ts` | Everything the UI needs to render one chat session; the value in `openSessions[id]`. |
| `reduceSession` | `src/renderer/src/store/session-reducer.ts` | Pure reducer that turns one `RpcFrame` (or studio control frame) into the next `LiveSessionState`. |
| `ChatStatus` | `src/renderer/src/store/session-reducer.ts` | High-level lifecycle: `idle`, `spawning`, `streaming`, `error`, `exited`. |
| `studioFrame` | `src/renderer/src/store/session-reducer.ts` | Builders for studio-internal control frames the store synthesises (state/messages/subagents/userMessage/uiRequest/stats/uiResolved). |
| `normalizeMessageContent` | `src/renderer/src/store/session-reducer.ts` | Coerces a message's `content` to `ContentBlock[]` at every ingestion boundary. |
| `useSession` / `useActiveSession` | `src/renderer/src/store/chat.ts` | Pane-scoped vs global session-slice selectors. |
| `OpenSessionDescriptor` | `src/shared/ipc.ts` | Persisted descriptor for an open chat (live or hibernated); the durable resume token is `sessionFile`. |
| `RpcFrame` | `src/shared/rpc.ts` | One newline-delimited protocol object from the omp child. |

## How it works

Each chat maps to one `OmpRpcSession` child owned by the `SessionRegistry` in
main. The bridge reads JSONL frames from the child's stdout and forwards every
non-response frame to the renderer over `evt:rpc` as `{sessionId, frame}`.
Lifecycle transitions (`ready` / `exited` / `error`) come over `evt:lifecycle`,
and `extension_ui_request` frames come over `evt:ui-request`. The renderer-side
handling of those three streams is the chat store.

The store holds every live session's render state in a normalized `openSessions`
map keyed by studio session id. It registers ONE global subscription to the
three event streams in `ensureSubscribed()` and routes each frame to its
session. All state shaping flows through the pure `reduceSession` reducer, so
the store owns only side effects (subscriptions, IPC fetches, optimistic
appends) and feeds their results back as frames. The reducer imports only types,
so it is unit-tested under `bun test` (`test/session-reducer.test.ts`) without
React or the DOM.

Studio data that does not arrive as a wire frame (authoritative `get_state` /
`get_messages` / `get_subagents` snapshots, optimistic user messages, the
per-session UI-request queue) is pushed through the same reducer via the
`studioFrame.*` builders. The `studio/` prefix never collides with a real omp
frame `type`, so there is exactly one code path that mutates a slice.

```mermaid
flowchart LR
  Child["omp --mode rpc-ui child"]
  Bridge["rpc-session.ts bridge"]
  IPC["evt:rpc / evt:lifecycle / evt:ui-request"]
  Store["store/chat.ts (ONE subscription)"]
  Reducer["session-reducer.ts reduceSession"]
  Slice["openSessions[id]: LiveSessionState"]
  Panes["Chat panes + SessionList"]

  Child -->|stdout JSONL frames| Bridge
  Bridge -->|forwards| IPC
  IPC --> Store
  Store -->|reduceSession(frame)| Reducer
  Reducer --> Slice
  Slice -->|useSession(id)| Panes
  Store -.->|get_state / get_messages / get_subagents snapshots| Reducer
  Store -.->|studioFrame.userMessage (optimistic)| Reducer
```

### Hot/cold split

The pane model (`store/panes.ts`, documented in
[`../shell-layout.md`](../shell-layout.md)) holds only ids (cold): a chat pane
carries a `sessionId` and an optional pin. Each transcript pane subscribes to
its own session slice through `useSession(sessionId, selector)` (hot), so two
panes rendering different sessions never alias each other's state. Global,
single-session chrome (the sidebar dock, layout chrome, palettes) reads the
active session through `useActiveSession(selector)`. A null id selects over
`undefined`, and the no-session case returns a shared constant to avoid render
loops.

### Signal frames fetch fresh snapshots

Most frames carry the data the reducer needs. A few are signal-only
(`agent_end` / `turn_end`, `todo_reminder` / `todo_auto_clear`,
`subagent_lifecycle`), so the store reacts to them by fetching an authoritative
snapshot and feeding it back through `studioFrame.state` /
`studioFrame.subagents`. Stats settle at turn end, so `refreshStats` runs once
per turn boundary rather than on a poll.

## Integration points

- **RPC bridge**: frames reach the store over the three event channels exposed
  by `window.omp.chat` (`onEvent`, `onLifecycle`, `onUiRequest`). See
  [`../systems/rpc-bridge.md`](../../systems/rpc-bridge.md) and
  [`../../primitives/rpc-protocol.md`](../../primitives/rpc-protocol.md).
- **Shell layout**: the chat surface is a center pane; the Usage / Plan /
  Subagents widgets live in the left-rail dock. See
  [`../shell-layout.md`](../shell-layout.md).
- **Settings**: `openSessions` is persisted by the settings service, and
  hibernated sessions are restored on boot. See
  [`../systems/settings-service.md`](../../systems/settings-service.md).
- **Process model**: the per-chat child is one external process controlled by
  main. See [`../../overview/architecture.md`](../../overview/architecture.md).

## Entry points for modification

- Add a new frame `type` to the transcript or lifecycle: extend `reduceSession`
  in `src/renderer/src/store/session-reducer.ts` (and add a `studioFrame.*`
  builder only if the store synthesises it).
- Add a new composer affordance: layer it onto `PromptComposer` in
  `src/renderer/src/components/chat/PromptComposer.tsx` via the
  `renderControls` / `renderOverlay` / `renderActions` seams, then wire it from
  `Composer.tsx`.
- Add a new UI-request method: extend `logic.ts` and the dialog set in
  `src/renderer/src/components/chat/ui-request/`, then route it from
  `UiRequestLayer.tsx`.
- Add a session-list row affordance: edit `SessionList.tsx` or
  `src/renderer/src/components/session/SessionActionsMenu.tsx`.

## Sub-pages

- [`composer.md`](composer.md) — the prompt composer, attachments, slash
  palette, model and thinking controls, agent drop chooser.
- [`transcript.md`](transcript.md) — message rendering, content blocks, tool
  call cards, thinking, markdown, todos, system cards, the activity rail.
- [`subagent-drill-in.md`](subagent-drill-in.md) — the subagent tree and
  inspector, live progress, incremental transcript tailing.
- [`approvals.md`](approvals.md) — tool approvals and extension UI requests,
  the dialog set, the always-allow allowlist.
- [`session-management.md`](session-management.md) — session lifecycle, the
  session list, resume/hibernate, stats, compaction.

## Key source files

| File | Purpose |
| --- | --- |
| `src/renderer/src/views/Chat.tsx` | The chat workspace; routes a session to the transcript + composer or the subagent inspector. |
| `src/renderer/src/store/chat.ts` | Multi-session store: `openSessions`, the single global subscription, all IPC side effects. |
| `src/renderer/src/store/session-reducer.ts` | Pure reducer: the single source of truth for `LiveSessionState` shape and transitions. |
| `src/renderer/src/store/approvals.ts` | Per-session approval policy and always-allow allowlist (renderer-only UI state). |
| `src/shared/rpc.ts` | The RPC frame and message types the reducer consumes. |
| `src/shared/ipc.ts` | `ChatCreateOptions`, `PromptOptions`, `OpenSessionDescriptor`, the `OmpApi.chat` surface. |
| `src/main/omp/rpc-session.ts` | The bridge session that forwards frames to the renderer. |
| `src/main/omp/registry.ts` | The `SessionRegistry` that owns the live child set and persisted descriptors. |

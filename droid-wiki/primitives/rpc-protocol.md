# RPC protocol types

`src/shared/rpc.ts` mirrors the `omp` `--mode rpc` protocol surface that OMP
Studio drives. These types are a pragmatic subset of the full `omp` protocol,
loose where the wire format is loose: frames carry arbitrary extra fields, so
several interfaces carry an open index signature (`[key: string]: unknown`)
rather than enumerating every field `omp` may emit. The bridge forwards frames
verbatim and the renderer's `src/renderer/src/store/session-reducer.ts` shapes
only the fields it knows.

The reference for protocol behavior (the ready handshake, command and response
matching, frame forwarding, teardown) is
[`../systems/rpc-bridge.md`](../systems/rpc-bridge.md). This page is the
type-level reference.

## Thinking level

```ts
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
```

Set per session at spawn time or later through `set_thinking_level`. The bridge
also pushes the initial level at the `ready` handshake.

## Approval policy

```ts
export type ApprovalMode = "always-ask" | "write" | "yolo";
export interface ApprovalPolicy { mode: ApprovalMode; autoApprove: boolean; }
```

The per-session approval contract applied to the `rpc-ui` child. Carried on
`ChatCreateOptions.approvalPolicy` in `src/shared/ipc.ts` and mapped to the
`--approval-mode` / `--auto-approve` spawn flags.

## Extension UI requests

`extension_ui_request` frames would otherwise block the agent waiting on
interactive UI. The bridge splits them by method (response-required vs. hint)
and auto-answers the response-required ones with safe defaults when the host is
silent. See [`../systems/rpc-bridge.md`](../systems/rpc-bridge.md) for the
behavior; the types live here.

```ts
export type ExtensionUiMethod =
  | "select" | "confirm" | "input" | "editor" | "cancel"
  | "notify" | "setStatus" | "setWidget" | "setTitle"
  | "set_editor_text" | "open_url";
```

`ExtensionUiRequest` is `{ type: "extension_ui_request"; id: string; method:
ExtensionUiMethod; title?: string; message?: string; timeout?: number; ... }`
(open index). `ExtensionUiResponse` is a union of `{ confirmed: boolean }`,
`{ value: string }`, or `{ cancelled: true; timedOut?: boolean }`.

## Message and content-block model

These match the on-disk session JSONL `message` records and the live frames.

```ts
export type ContentBlock =
  | TextBlock      // { type: "text"; text: string }
  | ThinkingBlock  // { type: "thinking"; thinking: string; thinkingSignature?: string }
  | ToolCallBlock  // { type: "toolCall"; id: string; name: string; arguments: unknown }
  | ImageBlock     // { type: "image"; image?: string; data?: string; mimeType?: string }
  | { type: string; [key: string]: unknown };
```

`OmpMessage` is the union of the three role-tagged message records:

| Type | Role | Notes |
| --- | --- | --- |
| `UserMessage` | `"user"` | `content: string | ContentBlock[]`; carries an optional renderer-only `optimisticId` that authoritative JSONL snapshots omit. |
| `AssistantMessage` | `"assistant"` | `content: string | ContentBlock[]`. |
| `ToolResultMessage` | `"toolResult"` | Carries `toolCallId`, `toolName`, `content`, optional `details`, and `isError`. |

`ImageContent` (`{ type: "image"; data: string; mimeType: string }` with
base64 data and no `data:` prefix) is the payload shape for images attached to
a prompt through `PromptOptions.images` in `src/shared/ipc.ts`.

## Models

| Type | Source | Notes |
| --- | --- | --- |
| `ModelCost` | `get_state` / `omp models --json` | `input?`, `output?`, `cacheRead?`, `cacheWrite?` cost fields. |
| `RpcModel` | `get_state` | The active model: `provider`, `id`, optional `name`, `baseUrl`, `reasoning`, `contextWindow`, `maxTokens`, `cost`. Open index. |
| `AvailableModel` | `omp models --json` | A selectable model: `provider`, `id`, `selector`, `name`, plus optional `contextWindow`, `maxTokens`, `reasoning`, `thinking`, `input`, `cost`. Re-exported as `ModelInfo` from `src/shared/domain.ts`. |

## Todos

| Type | Fields |
| --- | --- |
| `TodoStatus` | `"pending" | "in_progress" | "completed" | "dropped"` |
| `TodoTask` | `id`, `content`, `status` |
| `TodoPhase` | `id`, `name`, `tasks: TodoTask[]` |

## Session state (`get_state`)

`RpcState` is the shape returned by the `get_state` command and captured at
session ready. It is the primary snapshot of a live session.

| Field | Type | Notes |
| --- | --- | --- |
| `model` | `RpcModel` | Active model. |
| `thinkingLevel` | `ThinkingLevel` | Current thinking level. |
| `isStreaming` | `boolean` | Whether a turn is in flight. |
| `isCompacting` | `boolean` | Whether auto-compaction is running. |
| `steeringMode` | `"all" | "one-at-a-time"` | How `steer` applies. |
| `followUpMode` | `"all" | "one-at-a-time"` | How `follow_up` applies. |
| `interruptMode` | `"immediate" | "wait"` | How `abort` interrupts. |
| `sessionFile` | `string?` | Path to the JSONL transcript. |
| `sessionId` | `string?` | `omp`'s own session id. |
| `sessionName` | `string?` | Human session title. |
| `autoCompactionEnabled` | `boolean` | Whether auto-compaction is on. |
| `messageCount` | `number` | Messages so far. |
| `queuedMessageCount` | `number` | Messages queued behind a streaming turn. |
| `todoPhases` | `TodoPhase[]` | The todo board. |
| `systemPrompt` | `string[]?` | Active system prompt lines. |
| `dumpTools` | `DumpTool[]?` | Tools available to the agent. |
| `contextUsage` | `ContextUsage?` | `{ tokens, contextWindow, percent }`. |

`DumpTool` is `{ name: string; description?: string; parameters?: unknown }`
and `ContextUsage` is `{ tokens: number; contextWindow: number; percent: number }`.

## Session stats

```ts
export interface SessionStats {
  tokens?: number; cost?: number; contextUsage?: ContextUsage;
  [key: string]: unknown;
}
```

Permissive: `omp` may report extra fields the renderer does not model.

## Event frames

`RpcFrame` is the loose base type every stdout line is parsed into:
`{ type: string; [key: string]: unknown }`. The bridge treats every
non-response, non-ui-request frame as a `RpcFrame` and forwards it verbatim.
The known `type` values carried over the wire:

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

Three refinements carry typed payloads the renderer reads directly:

| Refinement | `type` | Typed fields |
| --- | --- | --- |
| `MessageUpdateFrame` | `"message_update"` | `assistantMessageEvent: AssistantMessageEvent` (with `type` delta kind `text_delta` / `thinking_delta` / `toolcall_delta` / ... and `delta?`), optional `message: AssistantMessage`. |
| `ToolExecutionFrame` | `"tool_execution_start" | "tool_execution_update" | "tool_execution_end"` | `toolCallId?`, `toolName?`, `arguments?`, `result?: { content?: ContentBlock[]; isError?: boolean }`. |
| `AgentEndFrame` | `"agent_end"` | Optional `messages: OmpMessage[]` final snapshot. |

`AssistantDeltaKind` is `"text_delta" | "thinking_delta" | "toolcall_delta" | string`
and `AssistantMessageEvent` is `{ type: AssistantDeltaKind; delta?: string; ... }`.

## Subagent telemetry

Subagent streaming is on by default. At the `ready` handshake the bridge sends
`set_subagent_subscription { level: "events" }`, so the three subagent frame
types arrive as unsolicited events for every session. The subscription level
can be changed later with `set_subagent_subscription`.

```ts
export type SubagentSubscriptionLevel = "off" | "progress" | "events";
export type AgentSource = "bundled" | "user" | "project";
```

`AgentSource` is the provenance of a subagent's agent definition, reported on
every subagent frame: `bundled` (shipped with `omp`), `user` (user config dir),
or `project` (repo-local `.agents`).

| Type | Role |
| --- | --- |
| `AgentProgress` | Live progress snapshot for one subagent: `index`, `id`, `agent`, `agentSource`, `status` (`pending` / `running` / `completed` / `failed` / `aborted`), `task`, optional `assignment` / `description` / `lastIntent` / `currentTool` / `currentToolArgs` / `currentToolStartMs`, `recentTools` (`{ tool, args, endMs }[]`), `recentOutput: string[]`, `toolCount`, `requests`, `tokens`. Open index. |
| `SubagentLifecyclePayload` | Payload of `subagent_lifecycle`: `id`, `agent`, `agentSource`, `description?`, `status` (`started` / `completed` / `failed` / `aborted`), `sessionFile?`, `parentToolCallId?`, `index`, `detached?`. |
| `SubagentProgressPayload` | Payload of `subagent_progress`: `index`, `agent`, `agentSource`, `task`, `assignment?`, `parentToolCallId?`, `sessionFile?`, `progress: AgentProgress`, `detached?`. |
| `SubagentEventPayload` | Payload of `subagent_event`: `id`, `event: RpcFrame` (a raw frame from the named subagent, forwarded verbatim). |
| `SubagentLifecycleFrame` | `RpcFrame` refinement with `type: "subagent_lifecycle"` and `payload: SubagentLifecyclePayload`. |
| `SubagentProgressFrame` | `RpcFrame` refinement with `type: "subagent_progress"` and `payload: SubagentProgressPayload`. |
| `SubagentEventFrame` | `RpcFrame` refinement with `type: "subagent_event"` and `payload: SubagentEventPayload`. |
| `SubagentInfo` | Legacy lightweight subagent shape (`id`, optional `agentType` / `label` / `status` / `sessionFile` / `parentId`, open index). Returned by `get_subagents` on older `omp` builds. |
| `SubagentSnapshot` | Richer superset of `SubagentInfo` the live roster reduces from frames: `id`, `index`, `agent`, `agentSource`, `description?`, `status`, `task?`, `assignment?`, `sessionFile?`, `lastUpdate`, `progress?`, `parentToolCallId?`. |
| `SubagentMessagesResult` | Paginated live transcript cursor from `get_subagent_messages`: `{ sessionFile, fromByte, nextByte, reset, entries: FileEntry[], messages: OmpMessage[] }`. `nextByte` resumes incremental tailing; on `reset === true` (file rotation) the consumer clears its cursor and restarts from `nextByte`. |
| `FileEntry` | A raw record from a session JSONL file (tagged by `type`, loose-tailed). Used here for subagent transcript entries. The name is reused in `src/shared/domain.ts` for the workspace file tree with different fields; see [Domain types](domain-types.md). |

## Commands palette

The Commands palette is fed by `available_commands_update` frames and the
`get_available_commands` command.

```ts
export type AvailableCommandSource =
  | "builtin" | "skill" | "extension" | "custom" | "mcp_prompt" | "file";
```

| Type | Role |
| --- | --- |
| `AvailableCommand` | Legacy shape: `name`, optional `description`, open index. |
| `AvailableSlashCommand` | Precise palette item: `name`, optional `aliases`, `description`, `input?: { hint? }`, `subcommands?: { name; description?; usage? }[]`, `source: AvailableCommandSource`. |

## Key types

| Type | File | One-line meaning |
| --- | --- | --- |
| `ThinkingLevel` | `src/shared/rpc.ts` | Per-session reasoning depth (`off` through `xhigh`). |
| `ApprovalMode` / `ApprovalPolicy` | `src/shared/rpc.ts` | Per-session tool-approval contract for the `rpc-ui` child. |
| `ExtensionUiMethod` / `ExtensionUiRequest` / `ExtensionUiResponse` | `src/shared/rpc.ts` | The `extension_ui_request` / `extension_ui_response` surface. |
| `ContentBlock` / `OmpMessage` | `src/shared/rpc.ts` | The message and content-block model for live frames and JSONL. |
| `RpcModel` / `AvailableModel` / `ModelCost` | `src/shared/rpc.ts` | Active and selectable model descriptors. |
| `TodoTask` / `TodoPhase` | `src/shared/rpc.ts` | The todo board carried on `RpcState`. |
| `RpcState` | `src/shared/rpc.ts` | The `get_state` snapshot of a live session. |
| `SessionStats` | `src/shared/rpc.ts` | Permissive token/cost stats from `get_session_stats`. |
| `RpcFrame` | `src/shared/rpc.ts` | Loose base type for every stdout frame. |
| `MessageUpdateFrame` / `ToolExecutionFrame` / `AgentEndFrame` | `src/shared/rpc.ts` | Typed refinements of `RpcFrame` the renderer reads. |
| `SubagentSubscriptionLevel` / `AgentProgress` / `SubagentSnapshot` | `src/shared/rpc.ts` | Subagent telemetry shapes. |
| `SubagentLifecycleFrame` / `SubagentProgressFrame` / `SubagentEventFrame` | `src/shared/rpc.ts` | The three subagent frame refinements. |
| `SubagentMessagesResult` | `src/shared/rpc.ts` | Paginated subagent transcript cursor. |
| `AvailableSlashCommand` / `AvailableCommandSource` | `src/shared/rpc.ts` | Commands palette item and its origin. |

## Related pages

- [`../systems/rpc-bridge.md`](../systems/rpc-bridge.md): the bridge that
  produces the frames typed here.
- [`../features/chat/index.md`](../features/chat/index.md): the renderer store
  that reduces these frames into per-session state.
- [IPC contract](ipc-contract.md): the `chat:*` channels that carry these
  payloads across IPC.
- [Domain types](domain-types.md): `AvailableModel` is re-exported there as
  `ModelInfo`.

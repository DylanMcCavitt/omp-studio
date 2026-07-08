# Data models

The data models that flow between the main process and the renderer, and
between the OMP RPC bridge and the on-disk session store. This page is the
summary reference: it names each core model, lists its key fields, and points
to the producer and the exhaustive type list. The full field-by-field type
definitions live in `src/shared/rpc.ts` and `src/shared/domain.ts` and are
documented in [`../primitives/rpc-protocol.md`](../primitives/rpc-protocol.md)
and [`../primitives/domain-types.md`](../primitives/domain-types.md).

```mermaid
flowchart LR
  OMP["omp --mode rpc"] -->|JSONL frames| Bridge["RPC bridge\nsrc/main/omp"]
  Bridge -->|RpcState, OmpMessage[]| Chat["chat store\nrenderer"]
  Bridge -->|SubagentSnapshot| Chat
  Disk["~/.omp/agent JSONL"] -->|SessionSummary, SessionTranscript| Store["session store\nsrc/main/services"]
  Services["data services"] -->|DashboardData| Views["views"]
  Store --> Services
```

## The omp message model

The unit of chat data, shared between live RPC frames and the on-disk session
JSONL. Defined in `src/shared/rpc.ts`.

| Type | Fields | Source |
| --- | --- | --- |
| `OmpMessage` | Union of `UserMessage`, `AssistantMessage`, `ToolResultMessage` (role-tagged). | `src/shared/rpc.ts` |
| `UserMessage` | `role: "user"`, `content: string | ContentBlock[]`, `timestamp?`, `optimisticId?` (renderer-only; authoritative JSONL snapshots omit it). | `src/shared/rpc.ts` |
| `AssistantMessage` | `role: "assistant"`, `content: string | ContentBlock[]`, `timestamp?`. | `src/shared/rpc.ts` |
| `ToolResultMessage` | `role: "toolResult"`, `toolCallId`, `toolName`, `content: string | ContentBlock[]`, `details?`, `isError?`, `timestamp?`. | `src/shared/rpc.ts` |
| `ContentBlock` | Union of `TextBlock`, `ThinkingBlock`, `ToolCallBlock`, `ImageBlock`, plus an open `{ type: string; ... }` fallback. | `src/shared/rpc.ts` |

`ContentBlock` variants:

| Block | Fields |
| --- | --- |
| `TextBlock` | `type: "text"`, `text` |
| `ThinkingBlock` | `type: "thinking"`, `thinking`, `thinkingSignature?` |
| `ToolCallBlock` | `type: "toolCall"`, `id`, `name`, `arguments: unknown` |
| `ImageBlock` | `type: "image"`, `image?`, `data?`, `mimeType?` |

### Bare-string normalization

The static type allows `content: string | ContentBlock[]`, but the wire is
looser. `omp` emits text-only turns with a plain-string `content`, and a
freshly-spawned subagent can emit a frame with `content` missing (undefined).
The renderer normalizes both into the canonical `ContentBlock[]` shape once,
at every store ingestion boundary, through `toContentBlocks` and
`normalizeMessageContent` in `src/renderer/src/store/session-reducer.ts`. A
non-empty string becomes a single `TextBlock`; an empty string or undefined
becomes no blocks; an array passes through by reference. After normalization
the rest of the renderer can trust `OmpMessage.content` as `ContentBlock[]`
and never re-guard.

## RPC state (`get_state`)

The primary snapshot of a live session, returned by the `get_state` command
and captured at the `ready` handshake. The bridge produces it
([`../systems/rpc-bridge.md`](../systems/rpc-bridge.md)); the renderer seeds a
session slice from it through `sessionFromState`.

| Field | Type | Notes |
| --- | --- | --- |
| `model` | `RpcModel` | Active model (`provider`, `id`, optional `name`, `baseUrl`, `reasoning`, `contextWindow`, `maxTokens`, `cost`). |
| `thinkingLevel` | `ThinkingLevel` | `"off"` through `"xhigh"`. |
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
| `todoPhases` | `TodoPhase[]` | The todo board (`{ id, name, tasks: TodoTask[] }`). |
| `systemPrompt` | `string[]?` | Active system prompt lines. |
| `dumpTools` | `DumpTool[]?` | Tools available to the agent (`{ name, description?, parameters? }`). |
| `contextUsage` | `ContextUsage?` | `{ tokens, contextWindow, percent }`. |

## Session stats (`get_session_stats`)

| Type | Fields | Source |
| --- | --- | --- |
| `SessionStats` | `tokens?`, `cost?` (USD), `contextUsage?: ContextUsage`, plus an open index (`[key: string]: unknown`) for extra fields `omp` may report. | `src/shared/rpc.ts` |

The renderer's per-session slice holds the latest `SessionStats` snapshot on
`LiveSessionState.stats`.

## Session transcript model

Parsed from the on-disk JSONL under `~/.omp/agent/sessions/<slug>/`. The
session store is the producer
([`../systems/session-store.md`](../systems/session-store.md)).

| Type | Fields | Source |
| --- | --- | --- |
| `SessionSummary` | `id`, `path` (absolute `.jsonl` path), `project` (directory slug), `cwd`, `title`, `createdAt`, `updatedAt`, `messageCount`, `model?`, `sizeBytes`, `archived?`. | `src/shared/domain.ts` |
| `SessionTranscript` | `summary: SessionSummary`, `messages: OmpMessage[]`. | `src/shared/domain.ts` |

`SessionSummary` is the listing row; `SessionTranscript` is the parsed file
returned by `data:sessions:read`. Search hits (`SessionSearchHit`) and
per-project aggregates (`ProjectSessions`) are documented in
[`../primitives/domain-types.md`](../primitives/domain-types.md).

## Subagent model

Live subagent telemetry, reduced from the `subagent_lifecycle`,
`subagent_progress`, and `subagent_event` frames the bridge forwards. Defined
in `src/shared/rpc.ts`.

| Type | Fields | Source |
| --- | --- | --- |
| `SubagentSnapshot` | `id`, `index`, `agent`, `agentSource` (`"bundled" | "user" | "project"`), `description?`, `status` (`"pending" | "running" | "completed" | "failed" | "aborted"`), `task?`, `assignment?`, `sessionFile?`, `lastUpdate`, `progress?`, `parentToolCallId?`. Richer superset of the legacy `SubagentInfo` that the live roster reduces from frames. | `src/shared/rpc.ts` |
| `AgentProgress` | `index`, `id`, `agent`, `agentSource`, `status`, `task`, `assignment?`, `description?`, `lastIntent?`, `currentTool?`, `currentToolArgs?`, `currentToolStartMs?`, `recentTools` (`{ tool, args, endMs }[]`), `recentOutput: string[]`, `toolCount`, `requests`, `tokens`. Open index. | `src/shared/rpc.ts` |
| `SubagentMessagesResult` | `sessionFile`, `fromByte`, `nextByte`, `reset`, `entries: FileEntry[]` (raw JSONL records), `messages: OmpMessage[]` (parsed). A paginated live transcript cursor; `nextByte` resumes incremental tailing, and `reset === true` signals a file rotation so the consumer clears its cursor. | `src/shared/rpc.ts` |

The three subagent frame payloads (`SubagentLifecyclePayload`,
`SubagentProgressPayload`, `SubagentEventPayload`) and the frame refinements
are listed in [`../primitives/rpc-protocol.md`](../primitives/rpc-protocol.md).
The renderer's per-subagent live state (`SubagentLiveState`, holding the latest
`progress` and a capped `events` buffer) is reduced in
`src/renderer/src/store/session-reducer.ts`.

## Dashboard aggregate

| Type | Fields | Source |
| --- | --- | --- |
| `DashboardData` | `sessions: { total, recent: SessionSummary[], byProject: ProjectSessions[] }`, `models: { total, providers, default? }`, `mcp: McpServerInfo[]`, `skills`, `agents`, `github: { repo: GhRepo | null, openIssues, openPrs }`, `generatedAt`. | `src/shared/domain.ts` |

Built by the dashboard service from the other data services for the dashboard
view. The individual domain types (`McpServerInfo`, `SkillInfo`, `AgentInfo`,
`ProviderInfo`, `GhRepo`, `GhIssue`, `GhPr`, `OmpStatsSnapshot`, the Linear and
files and changes shapes) are listed in
[`../primitives/domain-types.md`](../primitives/domain-types.md).

## Producers

| Model | Producer | Page |
| --- | --- | --- |
| `RpcState`, `OmpMessage[]`, `SubagentSnapshot`, `SessionStats` | RPC bridge (`src/main/omp`) | [`../systems/rpc-bridge.md`](../systems/rpc-bridge.md) |
| `SessionSummary`, `SessionTranscript` | Session store (`src/main/services/session-store.ts`) | [`../systems/session-store.md`](../systems/session-store.md) |
| `DashboardData` and the domain types | Data services (`src/main/services`) | [`../systems/data-services.md`](../systems/data-services.md) |

## Related pages

- [`../primitives/rpc-protocol.md`](../primitives/rpc-protocol.md): the
  exhaustive `src/shared/rpc.ts` type list.
- [`../primitives/domain-types.md`](../primitives/domain-types.md): the
  exhaustive `src/shared/domain.ts` type list.
- [`../primitives/ipc-contract.md`](../primitives/ipc-contract.md): the
  channels that carry these models across IPC.

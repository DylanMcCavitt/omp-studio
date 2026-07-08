# Tool approvals and UI requests

`omp` can ask its host for a decision or a piece of input through
`extension_ui_request` frames. OMP Studio routes those frames to a single
per-window layer that renders the blocking ones as focused modal dialogs and
the passive ones as toasts or an explicit-action banner. Tool approvals are the
safety-critical case: the studio renders them with a rich approval dialog whose
default focused action and Esc key are both Deny.

## Purpose

Be the host that answers `omp`'s `extension_ui_request` frames so the agent
never blocks on a silent host. Keep the safety-critical tool approvals honest
(Deny is the reflexive answer), let the user scope an "Always allow for this
session" rule to skip re-prompting, and surface the passive hint methods
without blocking. Keep the protocol knowledge in one pure, DOM-free module so
it is unit-tested without a renderer and reused by every dialog.

## Directory layout

```
src/renderer/src/
├── components/chat/
│   ├── UiRequestLayer.tsx              # the active session's UI-request pipeline
│   └── ui-request/
│       ├── logic.ts                    # pure classification + allow-key + partitioning
│       ├── ModalShell.tsx              # shared modal scaffolding (a11y, focus trap, portal)
│       ├── ApprovalRequestDialog.tsx   # tool-approval dialog (Deny default)
│       ├── SelectRequestDialog.tsx     # generic select listbox dialog
│       ├── InputRequestDialog.tsx      # single-line input dialog
│       ├── EditorRequestDialog.tsx     # multiline editor dialog
│       ├── UiHints.tsx                 # passive hint toasts + open_url banner
│       └── ApprovalModeControl.tsx     # header approval-mode chip + allowlist revoke
└── store/
    ├── approvals.ts                    # per-session approval policy + always-allow rules
    └── chat.ts                         # uiRequests queue + respondUi / dismissUiRequest
```

## Key abstractions

| Abstraction | File | One line |
| --- | --- | --- |
| `UiRequestLayer` | `src/renderer/src/components/chat/UiRequestLayer.tsx` | Reads the active session's `uiRequests` and routes each to a dialog or a hint. |
| `classifyUiRequest` | `src/renderer/src/components/chat/ui-request/logic.ts` | `modal`, `cancel`, `open_url`, or `hint` from the request method. |
| `approvalKey` / `approvalSelectKey` | `src/renderer/src/components/chat/ui-request/logic.ts` | Stable session-scoped allow key for a tool approval. |
| `approvalSelectShape` | `src/renderer/src/components/chat/ui-request/logic.ts` | Detects an approval-shaped `select` (`Allow tool:` + Approve/Deny). |
| `partitionUiRequests` | `src/renderer/src/components/chat/ui-request/logic.ts` | Splits a session's queue into modal/hints/openUrls/cancels. |
| `AllowRule` | `src/renderer/src/store/approvals.ts` | One always-allow rule: a stable key + a label. |
| `ExtensionUiRequest` / `ExtensionUiResponse` | `src/shared/rpc.ts` | The wire request and the `{confirmed}` / `{value}` / `{cancelled}` response. |

## How it works

### Frame flow

The bridge emits an `extension_ui_request` frame as an `evt:ui-request` event
carrying `{ sessionId, request, responseRequired }`. The chat store's
`_handleUiRequest` pushes it through the reducer via `studioFrame.uiRequest`,
which dedupes by request id into the session's `uiRequests` queue. The
renderer answers through `chat.respondUiRequest({ sessionId, requestId,
response })`, which the store forwards to the bridge; the reducer's
`studioFrame.uiResolved` dequeues the request by id. `dismissUiRequest` drops a
request without writing a response (for passive hints, `open_url`, and orphan
cleanup).

```mermaid
flowchart LR
  Child["omp child"]
  Bridge["rpc-session.ts<br/>handleExtensionUi"]
  Evt["evt:ui-request"]
  Store["store/chat.ts<br/>_handleUiRequest -> studioFrame.uiRequest"]
  Slice["uiRequests queue"]
  Layer["UiRequestLayer"]
  Dialogs["approval / select / input / editor dialogs"]
  Hints["UiHints toasts + open_url banner"]
  Resp["chat.respondUiRequest"]
  Wire["extension_ui_response frame"]

  Child -->|extension_ui_request| Bridge
  Bridge -->|responseRequired + fail-closed timer| Evt
  Evt --> Store --> Slice --> Layer
  Layer -->|modal| Dialogs
  Layer -->|hint / open_url| Hints
  Dialogs --> Resp
  Hints -->|dismiss (no response)| Store
  Resp --> Bridge --> Wire --> Child
```

### The layer

`UiRequestLayer` is mounted once at the `ChatWorkspace` root for the active
session (modal UI requests are window-exclusive, so `App` mounts one layer).
It reads the active session's `uiRequests` and partitions them with
`partitionUiRequests`: the single oldest response-required `modal` request
renders as a focused dialog (FIFO), `hints` and `openUrls` render as passive
surfaces, and `cancels` are handled as side effects.

The layer also:

- Auto-approves a `confirm` or approval-shaped `select` whose stable key is on
  the session allowlist, computed synchronously so it never flashes a dialog.
- Honors `cancel` requests by dropping the targeted request and acking the
  cancel itself, both with a `{ cancelled: true }` response.
- Drops every pending request locally when the session exits (orphan handling:
  the child is gone, so the bridge already cleared its pending map without
  writing a fail-closed frame).
- Runs a cross-session timeout sweeper that fail-closes any response-required
  request whose bridge timeout elapses, so a background session's answered
  request never leaves a dangling modal on switch.

### The dialogs

The four blocking methods render through `ModalShell`, which owns the
accessibility (`role="dialog"`, `aria-modal`, labelled title and description,
Esc to dismiss, Cmd/Ctrl+Enter for the primary action) and renders through a
portal so the overlay escapes any transformed ancestor. Focus behavior (focus
the default action on open, trap Tab, restore focus on close) comes from the
shared `useFocusTrap` hook.

- **`ApprovalRequestDialog`** — the safety-critical one. The default focused
  action and the Esc key are both Deny, so a reflexive Enter or Escape never
  approves. Cmd/Ctrl+Enter is the explicit Approve-once accelerator. "Always
  allow for this session" is offered only when the request yields a stable key.
  omp delivers tool approvals as either a `confirm` or an approval-shaped
  `select`; the layer routes both here and supplies `decide` so the right
  response shape (`{confirmed}` vs `{value}`) goes back on the wire.
- **`SelectRequestDialog`** — generic `select`: renders the request's `options`
  as a keyboard-navigable listbox (Up/Down/Home/End/Enter), submits the chosen
  option string as `{value}`, Esc cancels.
- **`InputRequestDialog`** — single-line text field; Enter or Cmd/Ctrl+Enter
  submits as `{value}`, Esc cancels.
- **`EditorRequestDialog`** — multiline textarea prefilled from `prefill`;
  Enter inserts a newline, Cmd/Ctrl+Enter submits as `{value}`.

### Tool approvals arrive as a `select`, not a `confirm`

A tool approval under the `always-ask` approval mode is surfaced by omp as a
`select` with a title of `Allow tool: <name> …` and options `["Approve",
"Deny"]`, not as a `confirm`. The studio must render these with the rich
`ApprovalRequestDialog` while keeping every other `select` on the generic
`SelectRequestDialog`. Detection in `approvalSelectShape` requires both of
omp's signals: the canonical `Allow tool:` title prefix (the marker
`formatApprovalPrompt` always emits) AND exactly the two-option Approve/Deny
set. The option pair alone is too weak, because a generic interactive select
could legitimately offer Approve/Deny; routing that to the rich dialog would
expose "Always allow" and a title-keyed rule that then auto-approves unrelated
prompts sharing the title. The `Allow tool:` prefix is a deliberate protocol
marker, so gating on it is precise.

### Always-allow allowlist

`approvalKey` builds a stable session-scoped allow key only from structured
fields: a tool identity (`toolName` or `tool`) plus an argument signature when
omp provides them. The key is never derived from the prose `title` or
`message`, because two unrelated actions can share a generic title. When
neither structured identity exists, there is no stable key, so "Always allow"
is not offered. For an approval-shaped `select` (whose frame carries no
structured tool identity), `approvalSelectKey` falls back to the
`Allow tool:` title, which is the action signature, and a structured key still
wins when present.

Rules live in `store/approvals.ts`, keyed by session id. `addRule` dedupes by
key; `revokeRule` removes one; `prune` drops state for sessions no longer open
(the `UiRequestLayer` calls it as `openSessions` change). The
`ApprovalModeControl` chip in the chat header shows the session's approval mode
(captured at spawn) and lists the always-allow rules with a revoke affordance
per rule.

### The bridge's auto-respond defaults

The bridge fail-closes every response-required request so `omp` never blocks
forever. `RESPONSE_REQUIRED_UI_METHODS` is `confirm`, `select`, `input`,
`editor`, and `cancel`. Each is tracked with a timeout (the request's own
`timeout` when provided, else `DEFAULT_UI_REQUEST_TIMEOUT_MS` = 5 minutes).
When the timeout elapses, `timeoutUi` writes the fail-closed response: a
`confirm` becomes `{ confirmed: false, timedOut: true }`; every other method
becomes `{ cancelled: true, timedOut: true }`. Fire-and-forget hint methods
(`notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`,
`open_url`) carry `responseRequired: false` and expect no reply.

### Passive hints

`UiHints` surfaces the non-blocking methods. Hints (`notify`, `setStatus`,
`setWidget`, `setTitle`, `set_editor_text`) appear as auto-dismissing toasts
(6s); `open_url` renders a persistent banner that opens the URL only on an
explicit click (the renderer's explicit-action guard; main guards the external
open too). None of these block the agent.

## Integration points

- **Chat store / reducer**: the `uiRequests` queue and `studioFrame.uiRequest`
  / `studioFrame.uiResolved` in `src/renderer/src/store/session-reducer.ts`.
- **RPC bridge**: `extension_ui_request` / `extension_ui_response` and the
  fail-closed backstop in `src/main/omp/rpc-session.ts`. See
  [`../systems/rpc-bridge.md`](../../systems/rpc-bridge.md).
- **Approvals store**: per-session policy and rules in
  `src/renderer/src/store/approvals.ts`.
- **External open**: `open_url` and markdown links both go through
  `window.omp.openExternal`. See [`transcript.md`](transcript.md).
- **Shell layout**: `ApprovalModeControl` sits in the chat pane header. See
  [`../shell-layout.md`](../shell-layout.md).

## Entry points for modification

- Add a UI-request method: extend `ExtensionUiMethod` in `src/shared/rpc.ts`,
  classify it in `logic.ts`, and route it from `UiRequestLayer.tsx` (add a
  dialog or a hint surface).
- Change approval detection or the allow key: edit
  `approvalSelectShape` / `approvalKey` / `approvalSelectKey` in
  `src/renderer/src/components/chat/ui-request/logic.ts`.
- Change the dialog set: edit the dialog component and `ModalShell` in
  `src/renderer/src/components/chat/ui-request/`.
- Change the always-allow store: edit `src/renderer/src/store/approvals.ts`.

## Key source files

| File | Purpose |
| --- | --- |
| `src/renderer/src/components/chat/UiRequestLayer.tsx` | The active session's UI-request pipeline: partition, auto-approve, cancel, orphan and timeout handling. |
| `src/renderer/src/components/chat/ui-request/logic.ts` | Pure classification, allow-key derivation, approval-select detection, queue partitioning, timeout collection. |
| `src/renderer/src/components/chat/ui-request/ModalShell.tsx` | Shared modal scaffolding (a11y, focus trap, portal, Esc/Cmd+Enter). |
| `src/renderer/src/components/chat/ui-request/ApprovalRequestDialog.tsx` | Tool-approval dialog: Deny default focus, Always allow, Approve once. |
| `src/renderer/src/components/chat/ui-request/SelectRequestDialog.tsx` | Generic select listbox dialog. |
| `src/renderer/src/components/chat/ui-request/InputRequestDialog.tsx` | Single-line input dialog. |
| `src/renderer/src/components/chat/ui-request/EditorRequestDialog.tsx` | Multiline editor dialog. |
| `src/renderer/src/components/chat/ui-request/UiHints.tsx` | Passive hint toasts and `open_url` banner. |
| `src/renderer/src/components/chat/ui-request/ApprovalModeControl.tsx` | Header approval-mode chip and allowlist revoke. |
| `src/renderer/src/store/approvals.ts` | Per-session approval policy and always-allow rules. |
| `src/shared/rpc.ts` | `ExtensionUiMethod`, `ExtensionUiRequest`, `ExtensionUiResponse`, `ApprovalPolicy`. |
| `src/main/omp/rpc-session.ts` | `handleExtensionUi`, `respondUi`, `timeoutUi` fail-closed backstop. |

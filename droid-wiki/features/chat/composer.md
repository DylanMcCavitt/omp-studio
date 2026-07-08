# Composer

The composer is where the user talks to the agent. It is a rounded bordered
input box with a textarea over a controls row, mounted at the bottom of each
chat pane. While the agent streams, the send slot becomes Steer and Stop. Both
send paths accept image attachments, the slash-command palette hangs off the
same textarea, and dropping an agent onto the composer opens a routing chooser
instead of silently inserting steering text.

## Purpose

Own the prompt-entry surface for one chat session: text entry, image
attachments, slash commands, model and thinking controls, and the
send/steer/stop decision. Keep the layout-agnostic input logic in a reusable
component so the same textarea, attachment handling, and overlay seam can back
other surfaces, and keep every pane-scoped concern (which session, which
shortcuts, which prefill) explicit so two panes never cross-talk.

## Directory layout

```
src/renderer/src/
├── components/chat/
│   ├── Composer.tsx              # active-chat composer shell
│   ├── PromptComposer.tsx        # reusable textarea + attachments + overlay seam
│   ├── ImageAttachmentStrip.tsx  # pending image thumbnails + validation errors
│   ├── SlashCommandPalette.tsx   # composer-anchored slash palette
│   ├── ModelControl.tsx          # composer model picker chip
│   ├── ThinkingControl.tsx       # header thinking-level picker
│   ├── AgentDropChooser.tsx      # dropped-agent routing chooser
│   └── ChatPanelDock.tsx         # left-rail Usage / Plan / Subagents dock
└── lib/
    ├── images.ts                 # image attachment reading + validation
    ├── slash-commands.ts         # pure filter/insert helpers for the palette
    └── model-options.ts          # settings default-model combobox options
```

## Key abstractions

| Abstraction | File | One line |
| --- | --- | --- |
| `PromptComposer` | `src/renderer/src/components/chat/PromptComposer.tsx` | Reusable textarea + attachments + overlay/actions controls seam. |
| `PromptComposerActionContext` | `src/renderer/src/components/chat/PromptComposer.tsx` | `submit`, `canSubmit`, `busy`, `hasContent` handed to `renderActions`. |
| `PromptComposerOverlayContext` | `src/renderer/src/components/chat/PromptComposer.tsx` | `open`, `close`, `setText`, `text` handed to the slash palette overlay. |
| `ImageAttachment` | `src/renderer/src/lib/images.ts` | A composer-local attachment: wire `ImageContent` plus UI metadata and a stable id. |
| `CommandLike` / `commandInsertText` | `src/renderer/src/lib/slash-commands.ts` | Bare command name and `/<name> ` insert text (always trailing space). |
| `AgentDragPayload` | `src/renderer/src/lib/agentDrag.ts` | The shared agent drag contract the chooser routes. |

## How it works

`Composer.tsx` is the shell bound to one pane's `sessionId`. It reads that
session's `status`, `model`, and `availableCommands`, plus the active workspace
label for the placeholder. It hands all of that to `PromptComposer` and supplies
three render callbacks:

- `renderActions` swaps the send button for Steer + Stop while the session is
  `streaming`. Send calls `chat.send(text, images, sessionId)`; Steer calls
  `chat.steer(text, images, sessionId)`; Stop calls `chat.abort(sessionId)`.
- `renderControls` renders the `ModelControl` chip (disabled when the session
  is not registered).
- `renderOverlay` renders the `SlashCommandPalette`, fed by the session's
  `availableCommands`.

`PromptComposer` owns the textarea (auto-grow, optional Enter-to-submit), the
attachment state, and the drag/paste/attach input routes. It clears text and
attachments only after `onSubmit` resolves truthy, so a failed send leaves the
content in place to retry.

```mermaid
flowchart TB
  User["User input (type / paste / drop / attach)"]
  PC["PromptComposer<br/>(textarea + attachments + overlay seam)"]
  SCP["SlashCommandPalette"]
  IAS["ImageAttachmentStrip"]
  AC["AgentDropChooser"]
  Actions["renderActions: Send / Steer / Stop"]
  Controls["renderControls: ModelControl"]
  Store["chat store<br/>send / steer / abort / setModel"]

  User --> PC
  PC -->|"/" at empty composer or Cmd/Ctrl+Shift+P"| SCP
  PC -->|paste / drop / attach| IAS
  PC -->|"agent drop"| AC
  PC --> Actions
  PC --> Controls
  Actions --> Store
  Controls --> Store
  AC --> Store
  SCP -->|setText: /name | PC
```

### Text entry

The textarea auto-grows up to `maxHeight` (default 200px). Enter submits
(Shift+Enter always newlines) when `submitOnEnter` is on. Typing `/` at an empty
composer opens the slash palette instead of inserting a literal slash; the
palette owns its own filter input so the composer's text and image state stay
untouched until a command is chosen, at which point `setText` inserts `/<name> `
and refocuses the textarea with the caret at the end.

### Image attachments

`lib/images.ts` reads picked, pasted, or dropped files into the wire
`ImageContent` shape (base64 with the `data:*;base64,` prefix stripped) and
enforces conservative client-side limits: `MAX_IMAGES = 10` per prompt and
`MAX_IMAGE_BYTES = 20 MiB` per file. Non-images, oversized files, and overflow
past the cap are reported as human-readable errors rendered by
`ImageAttachmentStrip` under the thumbnails. `ImageAttachmentStrip` shows each
thumbnail with an aria-labeled remove button. On send, attachments map to
`ImageContent[]` and ride `PromptOptions.images`. The store's `buildUserMessage`
turns an image-bearing prompt into ordered content blocks (text first, then
images) so `MessageBubble` can render the image blocks; an image-only prompt
omits the text block entirely.

### Slash command palette

`SlashCommandPalette` lists the active session's `availableCommands` (never
hardcoded; omp advertises them via `available_commands_update`). It filters as
you type with the pure helpers in `lib/slash-commands.ts`, navigates with arrow
keys, and inserts `/<name> ` on Enter or click. The `clampIndex` / `moveIndex`
helpers resolve the stored cursor against the current result length so a stale
index from a longer pre-filter list can never point past the end.

### Model and thinking controls

`ModelControl` is the compact model picker chip in the composer controls row.
It leads with a workspace Live Dot (hue = identity, fill = session status) and
shows the active model's name. The popover loads the model list once via
`window.omp.listModels()` and reuses the shared `filterOptions` /
`clampIndex` / `moveIndex` helpers so its filtering and keyboard model stay in
step with `Combobox`. Picking a model calls `chat.setModel(provider, modelId,
sessionId)`. `ThinkingControl` is the inline thinking-level picker in the chat
header, built on the shared `Menu` / `MenuItem` primitives and offering the six
levels (`off` through `xhigh`).

### Agent drop chooser

Dropping an agent on the composer no longer commits to anything. `PromptComposer`
detects an agent drag by the `AGENT_DRAG_MIME` data type and, when
`onAgentDrop` is provided, hands the parsed payload up to `Composer`, which
renders `AgentDropChooser` anchored above the input. The chooser previews the
exact steering prompt and offers four explicit targets:

- **Steer current response** — insert the prompt into the composer to edit
  (`onSteer`, the pre-AGE-779 path).
- **Queue after current response** — send now as a follow-up; disabled unless
  the session is streaming.
- **Run in parallel** — `chat.startParallelChat(text, { cwd })` spawns a fresh
  session in the same workspace and sends the prompt as its first turn, without
  stealing the current view.
- **Open in pane** — run in parallel and pin the new chat in a split pane via
  `openPaneWithFeedback`.

Esc, the backdrop, or Cancel dismiss as a clean no-op. A malformed payload
surfaces an inline error either way, never a silent no-op.

### Steer vs follow-up

When the session is already streaming, the composer's send path steers instead
of prompting. The store decides the wire shape in `send`:

- If the session is `streaming`, `chat.prompt` is called with
  `PromptOptions.streamingBehavior: "followUp"` (and `images` when present),
  so the prompt runs when the current turn finishes.
- `chat.steer` is the mid-turn interrupt path. The image-capable steer path
  sends `chat.prompt` with `streamingBehavior: "steer"` (because `chat.steer`
  carries no images); the plain text path calls `chat.steer` directly.

### The `pendingComposerText` seed

`app.pendingComposerText` is a global one-shot prefill used by the Skills &
Commands "Use in chat" action. `Composer` reads it only when it is the active
pane (`isActivePane`), so a pinned pane rendering another session never adopts
or consumes it. `PromptComposer` adopts a non-null `injectText` via `applyText`
(replace + focus + caret at end) and calls `onInjectConsumed` so the caller can
clear it. The local steer adoption from `AgentDropChooser` shares the same
inject seam.

### Pane scoping

Everything in `Composer` is keyed to its `sessionId`. `globalShortcuts`
(Cmd/Ctrl+Shift+P for the slash palette) is passed to `PromptComposer` only
when `isActivePane`, so background panes do not react to the chord. The
placeholder names the active workspace (`Message {workspace}…`), and the
composer is disabled until its session is registered in the store.

### ChatPanelDock

`ChatPanelDock` is the left-rail home of the Usage / Plan / Subagents widgets
(AGE-674). It renders nothing without an active session. Collapsed by default
to a one-line counter strip (Usage %, Plan done/total, live agent count), it
expands to the full `SessionStatsPanel`, `TodoPanel`, and `SubagentTree`. The
Subagents widget's Eye pops the subagent's transcript into the center view via
`setInspectedSubagent`; its split action opens the inspector in a new pane. See
[`subagent-drill-in.md`](subagent-drill-in.md) and
[`session-management.md`](session-management.md).

## Integration points

- **Chat store**: `send`, `steer`, `abort`, `setModel`, `setThinking`,
  `startParallelChat`. See `src/renderer/src/store/chat.ts`.
- **RPC bridge**: the prompt/steer/follow-up/set_model/set_thinking_level
  commands. See [`../systems/rpc-bridge.md`](../../systems/rpc-bridge.md).
- **Shell layout**: `openPaneWithFeedback` and the pane model. See
  [`../shell-layout.md`](../shell-layout.md).
- **Settings**: the workspace label and the default model/thinking/approval
  settings used by `newChat` and `startParallelChat`. See
  [`../systems/settings-service.md`](../../systems/settings-service.md).

## Entry points for modification

- Add a composer control: add it to `renderControls` in
  `src/renderer/src/components/chat/Composer.tsx`, or pass a new seam through
  `PromptComposer`.
- Add an attachment route: extend `PromptComposer`'s drag/paste/attach handling
  and the validation in `src/renderer/src/lib/images.ts`.
- Add a slash-palette behavior: edit `SlashCommandPalette` and the pure helpers
  in `src/renderer/src/lib/slash-commands.ts`.
- Add a dropped-agent target: edit `AgentDropChooser` and the store action it
  calls.

## Key source files

| File | Purpose |
| --- | --- |
| `src/renderer/src/components/chat/Composer.tsx` | The active-chat composer shell; wires the session, model chip, slash palette, and send/steer/stop actions. |
| `src/renderer/src/components/chat/PromptComposer.tsx` | Reusable textarea, attachments, drag/paste/attach, the overlay/actions/controls seam. |
| `src/renderer/src/components/chat/ImageAttachmentStrip.tsx` | Pending image thumbnails and validation errors. |
| `src/renderer/src/components/chat/SlashCommandPalette.tsx` | Composer-anchored slash palette. |
| `src/renderer/src/components/chat/ModelControl.tsx` | Compact model picker chip with a workspace Live Dot. |
| `src/renderer/src/components/chat/ThinkingControl.tsx` | Inline thinking-level picker for the chat header. |
| `src/renderer/src/components/chat/AgentDropChooser.tsx` | Dropped-agent routing chooser (steer / queue / parallel / pane). |
| `src/renderer/src/components/chat/ChatPanelDock.tsx` | Left-rail Usage / Plan / Subagents dock. |
| `src/renderer/src/lib/images.ts` | Image attachment reading, validation, and `ImageContent` building. |
| `src/renderer/src/lib/slash-commands.ts` | Pure filter/insert/cursor helpers for the slash palette. |
| `src/renderer/src/lib/model-options.ts` | Settings default-model combobox options. |

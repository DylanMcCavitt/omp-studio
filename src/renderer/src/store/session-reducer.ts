// Pure, framework-free reduction of one live chat session's render state.
//
// This module is the single source of truth for the *shape* of a live session
// and for every state transition the renderer derives from the omp RPC stream.
// It imports only types (erased at runtime) — no React, no `window`, no zustand —
// so it can be unit-tested directly under `bun test` (test/session-reducer.test.ts)
// and reused by every multi-session consumer (C3 ui-requests, D2r rail, E4 stats,
// F4 slash palette) without dragging in the store or the DOM.
//
// The store owns side effects (subscriptions, IPC fetches, optimistic appends)
// and feeds their results back through this reducer so all state shaping lives in
// exactly one place. Inputs are RPC frames (`window.omp.chat.onEvent`) plus a few
// studio-internal control frames the store synthesises for data that does not
// arrive as a wire frame (authoritative get_state/get_messages/get_subagents
// snapshots, optimistic user messages, and the per-session UI-request queue).

import type { ChatUiRequestEvent } from "@shared/ipc";
import type {
  AgentProgress,
  AvailableCommand,
  ContentBlock,
  ContextUsage,
  MessageUpdateFrame,
  OmpMessage,
  RpcFrame,
  RpcModel,
  RpcState,
  SessionStats,
  SubagentEventFrame,
  SubagentInfo,
  SubagentProgressFrame,
  ThinkingLevel,
  TodoPhase,
  ToolExecutionFrame,
  UserMessage,
} from "@shared/rpc";

/** High-level lifecycle of a single session as the renderer presents it. */
export type ChatStatus = "idle" | "spawning" | "streaming" | "error" | "exited";

/**
 * Live run-state of a single tool call, recorded from the `tool_execution_*`
 * frames as they stream — before the authoritative `toolResult` messages are
 * reconciled at turn end. Keyed by tool-call id in `LiveSessionState.toolRuns`
 * so the Activity rail can mark a step `done`/`running` mid-turn (AGE-708).
 */
export type ActivityRunState = "running" | "done" | "error";

/**
 * Kind of a transcript system card. `command_output` carries the text a local
 * slash command printed; `session_info` reflects a `session_info_update` (e.g. a
 * rename); `config` reflects a `config_update` (model/thinking change).
 */
export type SystemCardKind = "command_output" | "session_info" | "config";

/**
 * A lightweight system notice rendered inline in the transcript. Local slash
 * commands emit no agent_end, so their `command_output`/`session_info_update`/
 * `config_update` side-channel frames need visible feedback. Cards are anchored
 * to the transcript position they arrived at (`afterCount` = number of visible,
 * non-toolResult messages that preceded them) so they interleave chronologically
 * with messages rather than floating to the bottom. `id` is a per-session
 * monotonic key (no Date.now/random — the reducer stays pure).
 */
export interface SystemCard {
  id: string;
  kind: SystemCardKind;
  title: string;
  body: string;
  afterCount: number;
}

/**
 * Live per-subagent drill-in data reduced from the NESTED `subagent_progress`
 * (`payload.progress`) and `subagent_event` (`payload.event`) frames, keyed by
 * subagent id. The SubagentTree ticker reads `progress`; the inspector live
 * feed reads `events`, capped to the most recent {@link MAX_SUBAGENT_EVENTS}
 * (oldest dropped) so a chatty child never grows the slice unbounded.
 */
export interface SubagentLiveState {
  /** Latest snapshot from `subagent_progress.payload.progress`. */
  progress?: AgentProgress;
  /** Recent child RPC frames from `subagent_event.payload.event` (capped). */
  events: RpcFrame[];
}

/**
 * Everything the UI needs to render ONE chat session. The multi-session store
 * keeps a `Record<studioSessionId, LiveSessionState>`; the active pane and the
 * sidebar's SessionList read slices of it. Keep this shape additive and clean —
 * downstream issues (C3/D2r/E4/F4) build directly on these fields.
 */
export interface LiveSessionState {
  /** Studio session id (the record key, duplicated here for convenience). */
  sessionId: string;
  status: ChatStatus;
  /** Working directory the session runs in (rail title fallback). */
  cwd?: string;
  /** omp session name from get_state (preferred rail title). */
  sessionName?: string;
  /**
   * Absolute path to this session's JSONL file (from `get_state`). The session
   * actions menu operates on this path (rename/delete/archive/reveal/export).
   */
  sessionFile?: string;
  /**
   * Studio display-name override set when the user renames a live session. The
   * persisted alias is keyed by `sessionFile` on disk (shown in the Sessions
   * history view); this mirrors it onto the live slice so the rail row updates
   * immediately. `get_state` never clobbers it (omp owns `sessionName`).
   */
  alias?: string;
  /** Epoch ms of the last slice change; the store stamps it (rail "last activity"). */
  lastActivityAt: number;
  /** True while omp is compacting this session's context (Compacting badge). */
  isCompacting: boolean;
  /**
   * True while a *manual* compaction (CompactDialog) is in flight. Distinct from
   * `isCompacting`, which tracks omp's auto-compaction frames — the manual
   * `compact` command resolves on completion and emits no auto_compaction_*
   * frames, so the store drives this flag around the in-flight call.
   */
  compacting: boolean;
  /** Authoritative transcript (reconciled from get_messages on turn end). */
  messages: OmpMessage[];
  /** In-progress assistant text delta accumulator for the streaming bubble. */
  liveText: string;
  /** In-progress assistant thinking delta accumulator. */
  liveThinking: string;
  todoPhases: TodoPhase[];
  subagents: SubagentInfo[];
  /**
   * Live per-subagent progress + event buffers reduced from the NESTED
   * subagent frames, keyed by subagent id. Drives the SubagentTree ticker and
   * the SubagentInspector live feed; ephemeral (dies with the slice).
   */
  subagentEvents: Record<string, SubagentLiveState>;
  model: RpcModel | null;
  thinkingLevel: ThinkingLevel;
  contextUsage?: ContextUsage;
  /** Latest `get_session_stats` snapshot (tokens/cost/context + future keys). */
  stats?: SessionStats;
  /** Number of messages queued behind the current turn (steer/follow-up). */
  queuedCount: number;
  /** Name of the tool currently executing, for the activity indicator. */
  activeTool: string | null;
  /**
   * Live tool-call run-state keyed by tool-call id, recorded from the
   * `tool_execution_*` frames as the turn streams (before the reconciled
   * `toolResult` messages land). Lets the Activity rail mark steps
   * `done`/`running`/`queued` mid-turn; reset each turn (AGE-708).
   */
  toolRuns: Record<string, ActivityRunState>;
  /** Slash commands advertised by this session (`available_commands_update`). */
  availableCommands: AvailableCommand[];
  /** Outstanding extension UI requests awaiting a renderer response (C3). */
  uiRequests: ChatUiRequestEvent[];
  /**
   * Inline transcript system cards from local slash-command side channels
   * (`command_output`/`session_info_update`/`config_update`). Capped to the most
   * recent entries (oldest dropped) so a long session never grows unbounded.
   */
  systemCards: SystemCard[];
  /** Per-session monotonic counter for stable `SystemCard.id`s (pure, no Date.now). */
  systemCardSeq: number;
  error?: string;
}

/** Build a fresh session slice; `init` overrides any default field. */
export function createSession(
  sessionId: string,
  init: Partial<LiveSessionState> = {},
): LiveSessionState {
  return {
    sessionId,
    status: "idle",
    cwd: undefined,
    sessionName: undefined,
    sessionFile: undefined,
    alias: undefined,
    lastActivityAt: 0,
    isCompacting: false,
    compacting: false,
    messages: [],
    liveText: "",
    liveThinking: "",
    todoPhases: [],
    subagents: [],
    subagentEvents: {},
    model: null,
    thinkingLevel: "medium",
    contextUsage: undefined,
    stats: undefined,
    queuedCount: 0,
    activeTool: null,
    toolRuns: {},
    availableCommands: [],
    uiRequests: [],
    systemCards: [],
    systemCardSeq: 0,
    error: undefined,
    ...init,
  };
}

/** Seed a slice from a `get_state` snapshot (used when opening/resuming). */
export function sessionFromState(
  sessionId: string,
  state: RpcState,
): LiveSessionState {
  return createSession(sessionId, {
    status: state.isStreaming ? "streaming" : "idle",
    model: state.model ?? null,
    thinkingLevel: state.thinkingLevel,
    todoPhases: state.todoPhases ?? [],
    contextUsage: state.contextUsage,
    queuedCount: state.queuedMessageCount ?? 0,
    sessionName: state.sessionName,
    sessionFile: state.sessionFile,
    isCompacting: state.isCompacting,
  });
}

// Studio-internal control-frame types. These are NOT emitted by omp; the store
// synthesises them (via `studioFrame.*`) to push authoritative snapshots and
// UI-request lifecycle through the same reducer. The `studio/` prefix can never
// collide with a real omp frame `type`.
const CONTROL = {
  state: "studio/state",
  messages: "studio/messages",
  subagents: "studio/subagents",
  userMessage: "studio/user-message",
  uiRequest: "studio/ui-request",
  stats: "studio/stats",
  uiResolved: "studio/ui-resolved",
} as const;

/**
 * Typed builders for the studio-internal control frames. Call sites stay fully
 * typed; only the reducer interior casts off the loose `RpcFrame` bag (the same
 * pattern the wire-frame cases use, since `RpcFrame` is deliberately loose).
 */
export const studioFrame = {
  /** Apply an authoritative `get_state` snapshot (model/thinking/todos/context). */
  state: (state: RpcState): RpcFrame => ({ type: CONTROL.state, state }),
  /** Apply a `get_session_stats` snapshot (tokens/cost/context + future keys). */
  stats: (stats: SessionStats): RpcFrame => ({ type: CONTROL.stats, stats }),
  /** Replace the transcript with an authoritative `get_messages` snapshot. */
  messages: (messages: OmpMessage[]): RpcFrame => ({
    type: CONTROL.messages,
    messages,
  }),
  /** Replace the subagent roster with a `get_subagents` snapshot. */
  subagents: (subagents: SubagentInfo[]): RpcFrame => ({
    type: CONTROL.subagents,
    subagents,
  }),
  /** Optimistically append a user message before the prompt round-trips. */
  userMessage: (message: UserMessage): RpcFrame => ({
    type: CONTROL.userMessage,
    message,
  }),
  /** Enqueue an extension UI request for this session. */
  uiRequest: (event: ChatUiRequestEvent): RpcFrame => ({
    type: CONTROL.uiRequest,
    event,
  }),
  /** Dequeue a resolved UI request by its request id. */
  uiResolved: (requestId: string): RpcFrame => ({
    type: CONTROL.uiResolved,
    requestId,
  }),
};

/**
 * Coerce any message `content` into the canonical `ContentBlock[]` shape the
 * renderer assumes. The wire is looser than the static type: omp emits text-only
 * turns with a plain-string `content`, and a freshly-spawned subagent can emit a
 * frame with `content` missing (undefined). A non-empty string becomes a single
 * text block; an empty string or undefined/other becomes no blocks; an array
 * passes through by reference. This is the single source of truth for the
 * coercion — render sites call it instead of re-implementing per-site guards.
 */
export function toContentBlocks(
  content: string | ContentBlock[] | undefined,
): ContentBlock[] {
  if (Array.isArray(content)) return content;
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  return [];
}

/**
 * Normalize a message so its `content` is always `ContentBlock[]`. Applied at
 * every store ingestion boundary (snapshot frames, user-message appends, resume
 * hydration, the subagent pump) so the rest of the renderer can trust
 * `OmpMessage.content` and never re-guard. Array content is returned by
 * reference so an already-normalized message keeps a stable identity.
 */
export function normalizeMessageContent(message: OmpMessage): OmpMessage {
  if (Array.isArray(message.content)) return message;
  return { ...message, content: toContentBlocks(message.content) };
}

/**
 * Merge an in-progress assistant snapshot into the transcript: replace the
 * trailing assistant message (the one being streamed) or append a fresh one.
 */
export function upsertAssistant(
  messages: OmpMessage[],
  snapshot: OmpMessage,
): OmpMessage[] {
  const normalized = normalizeMessageContent(snapshot);
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant") {
    const next = messages.slice();
    next[next.length - 1] = normalized;
    return next;
  }
  return [...messages, normalized];
}

/** Most recent system cards kept per session; older ones are dropped. */
const MAX_SYSTEM_CARDS = 50;

/** Most recent child events kept per subagent in `subagentEvents`. */
const MAX_SUBAGENT_EVENTS = 200;

/**
 * Append a transcript system card, anchoring it after the current visible
 * (non-toolResult) message count, minting a stable id from the per-session
 * counter, and capping the list to the most recent entries. Pure: returns a new
 * state object. Empty bodies are dropped (no-op) so a blank side-channel frame
 * never produces an empty card.
 */
function appendSystemCard(
  state: LiveSessionState,
  kind: SystemCardKind,
  title: string,
  body: string,
): LiveSessionState {
  if (body === "") return state;
  const afterCount = state.messages.reduce(
    (n, m) => (m.role === "toolResult" ? n : n + 1),
    0,
  );
  const card: SystemCard = {
    id: `card-${state.systemCardSeq}`,
    kind,
    title,
    body,
    afterCount,
  };
  return {
    ...state,
    systemCards: [...state.systemCards, card].slice(-MAX_SYSTEM_CARDS),
    systemCardSeq: state.systemCardSeq + 1,
  };
}

/**
 * Reduce one frame into the next session state. Pure and immutable: returns a
 * NEW state object when something changed, or the SAME reference for a no-op
 * (so React/zustand can skip re-renders). Handles streamed omp frames
 * (agent/turn lifecycle, message deltas, tool execution, available commands) and
 * studio-internal control frames (state/messages/subagents snapshots, optimistic
 * user messages, UI-request enqueue/dequeue). Signal-only frames
 * (todo_reminder/todo_auto_clear/subagent_lifecycle) are no-ops here — the store
 * reacts to them by fetching an authoritative snapshot and feeding it back
 * through `studioFrame.state`/`studioFrame.subagents`.
 */
export function reduceSession(
  state: LiveSessionState,
  frame: RpcFrame,
): LiveSessionState {
  switch (frame.type) {
    case "agent_start":
    case "turn_start":
      return {
        ...state,
        status: "streaming",
        liveText: "",
        liveThinking: "",
        activeTool: null,
        toolRuns: {},
        error: undefined,
      };

    case "message_update": {
      const f = frame as MessageUpdateFrame;
      let next = state;
      const ev = f.assistantMessageEvent;
      if (ev?.type === "text_delta" && ev.delta) {
        next = { ...next, liveText: next.liveText + ev.delta };
      } else if (ev?.type === "thinking_delta" && ev.delta) {
        next = { ...next, liveThinking: next.liveThinking + ev.delta };
      }
      if (f.message) {
        next = { ...next, messages: upsertAssistant(next.messages, f.message) };
      }
      return next;
    }

    case "tool_execution_start":
    case "tool_execution_update": {
      const f = frame as ToolExecutionFrame;
      let next = state;
      if (f.toolName && f.toolName !== next.activeTool) {
        next = { ...next, activeTool: f.toolName };
      }
      // Track the running call by id so the rail can promote exactly this step
      // (parallel tools run concurrently — name alone can't disambiguate).
      if (f.toolCallId && next.toolRuns[f.toolCallId] !== "running") {
        next = {
          ...next,
          toolRuns: { ...next.toolRuns, [f.toolCallId]: "running" },
        };
      }
      return next;
    }

    case "tool_execution_end": {
      const f = frame as ToolExecutionFrame;
      let next = state;
      if (next.activeTool !== null) next = { ...next, activeTool: null };
      // Record completion now — the reconciled `toolResult` message only arrives
      // at turn end, so this is what lets a step go `done` mid-stream (AGE-708).
      if (f.toolCallId) {
        const done: ActivityRunState = f.result?.isError ? "error" : "done";
        if (next.toolRuns[f.toolCallId] !== done) {
          next = {
            ...next,
            toolRuns: { ...next.toolRuns, [f.toolCallId]: done },
          };
        }
      }
      return next;
    }

    case "auto_compaction_start":
      return state.isCompacting ? state : { ...state, isCompacting: true };

    case "auto_compaction_end":
      return state.isCompacting ? { ...state, isCompacting: false } : state;

    case "agent_end":
    case "turn_end":
      return {
        ...state,
        status: "idle",
        liveText: "",
        liveThinking: "",
        activeTool: null,
      };

    case "available_commands_update": {
      const commands = (frame as { commands?: AvailableCommand[] }).commands;
      return Array.isArray(commands)
        ? { ...state, availableCommands: commands }
        : state;
    }

    // Builtin slash-command side channels. Local commands produce no agent_end,
    // so these frames are the only visible feedback — surface each as an inline
    // transcript card (and keep the relevant slice fields fresh).
    case "command_output": {
      const text = (frame as { text?: unknown }).text;
      return typeof text === "string"
        ? appendSystemCard(state, "command_output", "Command output", text)
        : state;
    }

    case "session_info_update": {
      const title = (frame as { title?: unknown }).title;
      const name = typeof title === "string" ? title : "";
      // Keep the rail/header title in sync, then note the change in-transcript.
      const next = name ? { ...state, sessionName: name } : state;
      return appendSystemCard(
        next,
        "session_info",
        "Session",
        name ? `Renamed to “${name}”` : "Session updated",
      );
    }

    case "config_update": {
      const f = frame as { model?: RpcModel; thinkingLevel?: ThinkingLevel };
      const model = f.model ?? state.model;
      const thinkingLevel = f.thinkingLevel ?? state.thinkingLevel;
      const modelLabel = model
        ? (model.name ?? `${model.provider}/${model.id}`)
        : "—";
      return appendSystemCard(
        { ...state, model, thinkingLevel },
        "config",
        "Config updated",
        `Model: ${modelLabel} · thinking: ${thinkingLevel}`,
      );
    }

    // Feature 4: subagent drill-in. Frames are NESTED under `payload`. Progress
    // overwrites the latest snapshot per subagent id; events append to a capped
    // ring (oldest dropped). The store (chat.ts) reacts to these to pump the
    // open inspector's live transcript cursor — the reducer only shapes state.
    case "subagent_progress": {
      const progress = (frame as SubagentProgressFrame).payload?.progress;
      const id = progress?.id;
      if (!id) return state;
      const prev = state.subagentEvents[id];
      return {
        ...state,
        subagentEvents: {
          ...state.subagentEvents,
          [id]: { progress, events: prev?.events ?? [] },
        },
      };
    }

    case "subagent_event": {
      const payload = (frame as SubagentEventFrame).payload;
      const id = payload?.id;
      const event = payload?.event;
      if (!id || !event) return state;
      const prev = state.subagentEvents[id];
      const events = [...(prev?.events ?? []), event];
      if (events.length > MAX_SUBAGENT_EVENTS) {
        events.splice(0, events.length - MAX_SUBAGENT_EVENTS);
      }
      return {
        ...state,
        subagentEvents: {
          ...state.subagentEvents,
          [id]: { progress: prev?.progress, events },
        },
      };
    }

    case CONTROL.state: {
      const rpc = (frame as { state?: RpcState }).state;
      if (!rpc) return state;
      return {
        ...state,
        model: rpc.model ?? state.model,
        thinkingLevel: rpc.thinkingLevel ?? state.thinkingLevel,
        todoPhases: rpc.todoPhases ?? state.todoPhases,
        contextUsage: rpc.contextUsage ?? state.contextUsage,
        queuedCount: rpc.queuedMessageCount ?? state.queuedCount,
        sessionName: rpc.sessionName ?? state.sessionName,
        sessionFile: rpc.sessionFile ?? state.sessionFile,
        isCompacting: rpc.isCompacting ?? state.isCompacting,
      };
    }

    case CONTROL.stats: {
      const stats = (frame as { stats?: SessionStats }).stats;
      if (!stats) return state;
      // Keep the slice's contextUsage in sync when stats carry a fresher value
      // (compaction shrinks it), but never clobber a known value with nothing.
      return {
        ...state,
        stats,
        contextUsage: stats.contextUsage ?? state.contextUsage,
      };
    }

    case CONTROL.messages: {
      const messages = (frame as { messages?: OmpMessage[] }).messages;
      if (!Array.isArray(messages)) return state;
      // Normalize every snapshot at the boundary so downstream render sites can
      // trust `content: ContentBlock[]` without re-guarding.
      return {
        ...state,
        messages: messages.map(normalizeMessageContent),
      };
    }

    case CONTROL.subagents: {
      const subagents = (frame as { subagents?: SubagentInfo[] }).subagents;
      return Array.isArray(subagents) ? { ...state, subagents } : state;
    }

    case CONTROL.userMessage: {
      const message = (frame as { message?: UserMessage }).message;
      return message
        ? {
            ...state,
            messages: [...state.messages, normalizeMessageContent(message)],
          }
        : state;
    }

    case CONTROL.uiRequest: {
      const event = (frame as { event?: ChatUiRequestEvent }).event;
      if (!event) return state;
      // Dedupe by request id so a re-delivered frame never double-enqueues.
      const without = state.uiRequests.filter(
        (u) => u.request.id !== event.request.id,
      );
      return { ...state, uiRequests: [...without, event] };
    }

    case CONTROL.uiResolved: {
      const requestId = (frame as { requestId?: string }).requestId;
      if (!requestId) return state;
      const next = state.uiRequests.filter((u) => u.request.id !== requestId);
      return next.length === state.uiRequests.length
        ? state
        : { ...state, uiRequests: next };
    }

    default:
      return state;
  }
}

/**
 * A stable, framework-free classification of a session's headline status for
 * the SessionList / pane header badge. UI labels and colors are mapped from
 * this kind in the view layer. Priority is deliberate: terminal states
 * (error/exited) win, then a pending UI request the user must answer
 * (approval before input), then compaction, then the streaming lifecycle.
 * "Needs approval"/"Needs input" are derived from the per-session uiRequests
 * queue (only response-required requests count).
 */
export type SessionBadgeKind =
  | "ready"
  | "starting"
  | "streaming"
  | "compacting"
  | "needs-approval"
  | "needs-input"
  | "error"
  | "exited";

export function deriveSessionBadgeKind(
  s: Pick<LiveSessionState, "status" | "uiRequests" | "isCompacting">,
): SessionBadgeKind {
  if (s.status === "error") return "error";
  if (s.status === "exited") return "exited";
  let approval = false;
  let input = false;
  for (const u of s.uiRequests) {
    if (!u.responseRequired) continue;
    const m = u.request.method;
    if (m === "confirm" || m === "select" || m === "cancel") approval = true;
    else if (m === "input" || m === "editor") input = true;
  }
  if (approval) return "needs-approval";
  if (input) return "needs-input";
  if (s.isCompacting) return "compacting";
  if (s.status === "streaming") return "streaming";
  if (s.status === "spawning") return "starting";
  return "ready";
}

/**
 * The Live Dot status triad (AGE-699): hue = workspace identity, fill = this.
 * Coarser than `SessionBadgeKind`; it answers only "is this session working,
 * waiting, or finished" so a single dot can carry status across the UI.
 */
export type SessionStatus = "running" | "idle" | "done";

/**
 * Derive a session's Live-Dot status. Pure and framework-free: status is never
 * stored, it is read off the session model. A `live` session (one with an omp
 * child, i.e. in `openSessions`) is `running` while its turn streams and `idle`
 * otherwise; a session with no live child (hibernated/closed) is `done`.
 */
export function sessionStatus(session: {
  live: boolean;
  status?: ChatStatus;
}): SessionStatus {
  if (!session.live) return "done";
  return session.status === "streaming" ? "running" : "idle";
}

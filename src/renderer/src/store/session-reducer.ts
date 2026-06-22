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
  AvailableCommand,
  ContextUsage,
  MessageUpdateFrame,
  OmpMessage,
  RpcFrame,
  RpcModel,
  RpcState,
  SubagentInfo,
  ThinkingLevel,
  TodoPhase,
  ToolExecutionFrame,
  UserMessage,
} from "@shared/rpc";

/** High-level lifecycle of a single session as the renderer presents it. */
export type ChatStatus = "idle" | "spawning" | "streaming" | "error";

/**
 * Everything the UI needs to render ONE chat session. The multi-session store
 * keeps a `Record<studioSessionId, LiveSessionState>`; the active pane and the
 * (future) SessionRail read slices of it. Keep this shape additive and clean —
 * downstream issues (C3/D2r/E4/F4) build directly on these fields.
 */
export interface LiveSessionState {
  /** Studio session id (the record key, duplicated here for convenience). */
  sessionId: string;
  status: ChatStatus;
  /** Authoritative transcript (reconciled from get_messages on turn end). */
  messages: OmpMessage[];
  /** In-progress assistant text delta accumulator for the streaming bubble. */
  liveText: string;
  /** In-progress assistant thinking delta accumulator. */
  liveThinking: string;
  todoPhases: TodoPhase[];
  subagents: SubagentInfo[];
  model: RpcModel | null;
  thinkingLevel: ThinkingLevel;
  contextUsage?: ContextUsage;
  /** Number of messages queued behind the current turn (steer/follow-up). */
  queuedCount: number;
  /** Name of the tool currently executing, for the activity indicator. */
  activeTool: string | null;
  /** Slash commands advertised by this session (`available_commands_update`). */
  availableCommands: AvailableCommand[];
  /** Outstanding extension UI requests awaiting a renderer response (C3). */
  uiRequests: ChatUiRequestEvent[];
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
    messages: [],
    liveText: "",
    liveThinking: "",
    todoPhases: [],
    subagents: [],
    model: null,
    thinkingLevel: "medium",
    contextUsage: undefined,
    queuedCount: 0,
    activeTool: null,
    availableCommands: [],
    uiRequests: [],
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
 * Merge an in-progress assistant snapshot into the transcript: replace the
 * trailing assistant message (the one being streamed) or append a fresh one.
 */
export function upsertAssistant(
  messages: OmpMessage[],
  snapshot: OmpMessage,
): OmpMessage[] {
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant") {
    const next = messages.slice();
    next[next.length - 1] = snapshot;
    return next;
  }
  return [...messages, snapshot];
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
      const toolName = (frame as ToolExecutionFrame).toolName;
      return toolName && toolName !== state.activeTool
        ? { ...state, activeTool: toolName }
        : state;
    }

    case "tool_execution_end":
      return state.activeTool === null ? state : { ...state, activeTool: null };

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
      };
    }

    case CONTROL.messages: {
      const messages = (frame as { messages?: OmpMessage[] }).messages;
      return Array.isArray(messages) ? { ...state, messages } : state;
    }

    case CONTROL.subagents: {
      const subagents = (frame as { subagents?: SubagentInfo[] }).subagents;
      return Array.isArray(subagents) ? { ...state, subagents } : state;
    }

    case CONTROL.userMessage: {
      const message = (frame as { message?: UserMessage }).message;
      return message
        ? { ...state, messages: [...state.messages, message] }
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

// Zustand store for the single active chat session. Wraps `window.omp.chat.*`,
// subscribes to streamed RPC frames + lifecycle events, and reduces them into
// render-ready state for the Chat view and its components.

import type { ChatCreateOptions, ChatLifecycleEvent } from "@shared/ipc";
import type {
  AssistantMessage,
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
import { create } from "zustand";
import { useAppStore } from "@/store/app";

export type ChatStatus = "idle" | "spawning" | "streaming" | "error";

interface ChatState {
  sessionId: string | null;
  status: ChatStatus;
  messages: OmpMessage[];
  /** current streaming assistant text (delta accumulator) */
  liveText: string;
  /** current streaming assistant thinking (delta accumulator) */
  liveThinking: string;
  todoPhases: TodoPhase[];
  subagents: SubagentInfo[];
  model: RpcModel | null;
  thinkingLevel: ThinkingLevel;
  contextUsage?: ContextUsage;
  queuedCount: number;
  /** name of the tool currently executing, for the activity indicator */
  activeTool: string | null;
  error?: string;
  /** combined unsubscribe handle for onEvent + onLifecycle */
  _unsub: (() => void) | null;
}

interface ChatActions {
  attach(sessionId: string, state: RpcState): Promise<void>;
  start(opts: ChatCreateOptions): Promise<void>;
  send(text: string): Promise<void>;
  steer(text: string): Promise<void>;
  abort(): Promise<void>;
  setModel(provider: string, id: string): Promise<void>;
  setThinking(level: ThinkingLevel): Promise<void>;
  reset(): void;
  _onFrame(frame: RpcFrame): Promise<void>;
  _onLifecycle(e: ChatLifecycleEvent): void;
  _refresh(): Promise<void>;
}

export type ChatStore = ChatState & ChatActions;

const initialState: ChatState = {
  sessionId: null,
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
  error: undefined,
  _unsub: null,
};

/**
 * Merge an in-progress assistant snapshot into the message list: replace the
 * trailing assistant message (the one being streamed) or append a fresh one.
 */
function upsertAssistant(
  messages: OmpMessage[],
  snapshot: AssistantMessage,
): OmpMessage[] {
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant") {
    const next = messages.slice();
    next[next.length - 1] = snapshot;
    return next;
  }
  return [...messages, snapshot];
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export const useChatStore = create<ChatStore>()((set, get) => ({
  ...initialState,

  async attach(sessionId, state) {
    const prev = get()._unsub;
    if (prev) prev();

    const offEvent = window.omp.chat.onEvent((e) => {
      if (e.sessionId !== sessionId) return;
      void get()._onFrame(e.frame);
    });
    const offLifecycle = window.omp.chat.onLifecycle((e) => {
      if (e.sessionId !== sessionId) return;
      get()._onLifecycle(e);
    });

    set({
      sessionId,
      status: state.isStreaming ? "streaming" : "idle",
      messages: [],
      liveText: "",
      liveThinking: "",
      model: state.model ?? null,
      thinkingLevel: state.thinkingLevel,
      todoPhases: state.todoPhases ?? [],
      contextUsage: state.contextUsage,
      queuedCount: state.queuedMessageCount ?? 0,
      subagents: [],
      activeTool: null,
      error: undefined,
      _unsub: () => {
        offEvent();
        offLifecycle();
      },
    });

    try {
      const messages = await window.omp.chat.getMessages(sessionId);
      if (get().sessionId === sessionId) set({ messages });
    } catch (e) {
      set({ error: errorMessage(e) });
    }

    try {
      const subagents = await window.omp.chat.getSubagents(sessionId);
      if (get().sessionId === sessionId) set({ subagents });
    } catch {
      // subagents are best-effort
    }
  },

  async start(opts) {
    set({ status: "spawning", error: undefined });
    try {
      const { sessionId, state } = await window.omp.chat.create(opts);
      useAppStore.getState().openChat(sessionId);
      await get().attach(sessionId, state);
    } catch (e) {
      set({ status: "error", error: errorMessage(e) });
    }
  },

  async send(text) {
    const id = get().sessionId;
    const trimmed = text.trim();
    if (!id || !trimmed) return;
    const userMsg: UserMessage = {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    set((s) => ({ messages: [...s.messages, userMsg] }));
    try {
      if (get().status === "streaming") {
        await window.omp.chat.prompt(id, text, {
          streamingBehavior: "followUp",
        });
      } else {
        await window.omp.chat.prompt(id, text);
      }
    } catch (e) {
      set({ status: "error", error: errorMessage(e) });
    }
  },

  async steer(text) {
    const id = get().sessionId;
    const trimmed = text.trim();
    if (!id || !trimmed) return;
    const userMsg: UserMessage = {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    set((s) => ({ messages: [...s.messages, userMsg] }));
    try {
      await window.omp.chat.steer(id, text);
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  async abort() {
    const id = get().sessionId;
    if (!id) return;
    try {
      await window.omp.chat.abort(id);
    } catch {
      // best-effort; lifecycle/frames will reconcile
    }
    set({ status: "idle", liveText: "", liveThinking: "", activeTool: null });
  },

  async setModel(provider, id) {
    const sessionId = get().sessionId;
    if (!sessionId) return;
    try {
      await window.omp.chat.setModel(sessionId, provider, id);
      const st = await window.omp.chat.getState(sessionId);
      if (get().sessionId === sessionId)
        set({ model: st.model ?? get().model });
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  async setThinking(level) {
    const id = get().sessionId;
    set({ thinkingLevel: level });
    if (!id) return;
    try {
      await window.omp.chat.setThinking(id, level);
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  reset() {
    const unsub = get()._unsub;
    if (unsub) unsub();
    set({ ...initialState });
  },

  async _onFrame(frame) {
    const id = get().sessionId;
    if (!id) return;
    switch (frame.type) {
      case "agent_start":
      case "turn_start": {
        set({
          status: "streaming",
          liveText: "",
          liveThinking: "",
          activeTool: null,
          error: undefined,
        });
        break;
      }
      case "message_update": {
        const f = frame as MessageUpdateFrame;
        const ev = f.assistantMessageEvent;
        if (ev?.type === "text_delta" && ev.delta) {
          const delta = ev.delta;
          set((s) => ({ liveText: s.liveText + delta }));
        } else if (ev?.type === "thinking_delta" && ev.delta) {
          const delta = ev.delta;
          set((s) => ({ liveThinking: s.liveThinking + delta }));
        }
        if (f.message) {
          const snapshot = f.message;
          set((s) => ({ messages: upsertAssistant(s.messages, snapshot) }));
        }
        break;
      }
      case "tool_execution_start":
      case "tool_execution_update": {
        const tn = (frame as ToolExecutionFrame).toolName;
        if (tn) set({ activeTool: tn });
        break;
      }
      case "tool_execution_end": {
        set({ activeTool: null });
        break;
      }
      case "agent_end":
      case "turn_end": {
        set({
          status: "idle",
          liveText: "",
          liveThinking: "",
          activeTool: null,
        });
        await get()._refresh();
        break;
      }
      case "todo_reminder":
      case "todo_auto_clear": {
        try {
          const st = await window.omp.chat.getState(id);
          if (get().sessionId === id) {
            set({
              todoPhases: st.todoPhases ?? [],
              contextUsage: st.contextUsage,
              queuedCount: st.queuedMessageCount ?? 0,
            });
          }
        } catch {
          // ignore transient state read failures
        }
        break;
      }
      case "subagent_lifecycle": {
        try {
          const subagents = await window.omp.chat.getSubagents(id);
          if (get().sessionId === id) set({ subagents });
        } catch {
          // ignore
        }
        break;
      }
      default:
        break;
    }
  },

  _onLifecycle(e) {
    if (e.status === "error") {
      set({ status: "error", error: e.detail });
    } else if (e.status === "exited") {
      set({ status: "idle", activeTool: null });
    }
  },

  async _refresh() {
    const id = get().sessionId;
    if (!id) return;
    try {
      const [messages, st] = await Promise.all([
        window.omp.chat.getMessages(id),
        window.omp.chat.getState(id),
      ]);
      if (get().sessionId !== id) return;
      set({
        messages,
        todoPhases: st.todoPhases ?? [],
        contextUsage: st.contextUsage,
        model: st.model ?? get().model,
        thinkingLevel: st.thinkingLevel ?? get().thinkingLevel,
        queuedCount: st.queuedMessageCount ?? 0,
      });
    } catch {
      // ignore transient refresh failures
    }
  },
}));

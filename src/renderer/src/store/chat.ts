// Multi-session chat store. Holds every live session's render state in a
// normalized `openSessions` map keyed by studio session id, registers ONE global
// subscription to the bridge's frame/lifecycle/ui-request streams (routing each
// frame to its session), and reduces frames through the pure `reduceSession`
// reducer. The active pane reads the active session's slice via
// `useActiveSession`; the (future) SessionRail will list `openSessions`.
//
// All state shaping flows through the reducer — the store owns only side effects
// (subscriptions, IPC calls, optimistic appends) and feeds their results back as
// studio control frames so there is exactly one place that mutates a slice.

import type {
  ChatCreateOptions,
  ChatLifecycleEvent,
  ChatUiRequestEvent,
  ChatUiRespondPayload,
} from "@shared/ipc";
import type {
  RpcFrame,
  RpcState,
  ThinkingLevel,
  UserMessage,
} from "@shared/rpc";
import { create } from "zustand";
import { useAppStore } from "@/store/app";
import {
  type LiveSessionState,
  reduceSession,
  sessionFromState,
  studioFrame,
} from "@/store/session-reducer";
import { useSettingsStore } from "@/store/settings";

export type { ChatStatus, LiveSessionState } from "@/store/session-reducer";

interface ChatState {
  /** Every open session's render state, keyed by studio session id. */
  openSessions: Record<string, LiveSessionState>;
  /** The session shown in the active chat pane, or null for a fresh chat. */
  activeSessionId: string | null;
  /** True while a brand-new session is spawning (drives the start panel). */
  creating: boolean;
  /** Last create() failure, if any. */
  createError?: string;
  /** Cleanup for the single global bridge subscription (null until wired). */
  _unsub: (() => void) | null;
}

interface ChatActions {
  /** Register the single global frame/lifecycle/ui-request subscription. Idempotent. */
  ensureSubscribed(): void;
  /** Tear down the global subscription (mirror of ensureSubscribed). */
  teardown(): void;

  /** Select which session the chat pane shows (without changing route). */
  setActiveSession(id: string | null): void;
  /** Show an existing session in the chat route. */
  openChat(id: string): void;
  /** Start a brand-new (unspawned) chat in the chat route. */
  newChat(): void;

  /** Register/refresh a session slice from a get_state snapshot + hydrate it. */
  openSession(sessionId: string, state: RpcState): Promise<void>;
  /** Spawn a new rpc-ui session, register it, and make it active. */
  start(opts: ChatCreateOptions): Promise<void>;

  /** Prompt the active session (steers/follow-ups while it streams). */
  send(text: string): Promise<void>;
  /** Steer the active session mid-turn. */
  steer(text: string): Promise<void>;
  /** Abort the active session's current turn. */
  abort(): Promise<void>;
  setModel(provider: string, modelId: string): Promise<void>;
  setThinking(level: ThinkingLevel): Promise<void>;
  /** Answer an extension UI request and dequeue it from its session. */
  respondUi(payload: ChatUiRespondPayload): Promise<void>;

  _handleFrame(sessionId: string, frame: RpcFrame): void;
  _handleLifecycle(e: ChatLifecycleEvent): void;
  _handleUiRequest(e: ChatUiRequestEvent): void;
  _patch(
    sessionId: string,
    fn: (s: LiveSessionState) => LiveSessionState,
  ): void;
  _refresh(sessionId: string): Promise<void>;
  _refreshState(sessionId: string): Promise<void>;
  _refreshSubagents(sessionId: string): Promise<void>;
}

export type ChatStore = ChatState & ChatActions;

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export const useChatStore = create<ChatStore>()((set, get) => ({
  openSessions: {},
  activeSessionId: null,
  creating: false,
  createError: undefined,
  _unsub: null,

  ensureSubscribed() {
    if (get()._unsub) return;
    const offEvent = window.omp.chat.onEvent((e) =>
      get()._handleFrame(e.sessionId, e.frame),
    );
    const offLifecycle = window.omp.chat.onLifecycle((e) =>
      get()._handleLifecycle(e),
    );
    const offUi = window.omp.chat.onUiRequest((e) => get()._handleUiRequest(e));
    set({
      _unsub: () => {
        offEvent();
        offLifecycle();
        offUi();
      },
    });
  },

  teardown() {
    const unsub = get()._unsub;
    if (unsub) unsub();
    set({ _unsub: null });
  },

  setActiveSession(id) {
    set({ activeSessionId: id });
  },

  openChat(id) {
    set({ activeSessionId: id });
    useAppStore.getState().setRoute("chat");
  },

  newChat() {
    set({ activeSessionId: null });
    useAppStore.getState().setRoute("chat");
  },

  async openSession(sessionId, state) {
    // Register the slice synchronously so streamed frames route immediately and
    // the pane can render before the transcript finishes hydrating.
    set((s) => ({
      openSessions: {
        ...s.openSessions,
        [sessionId]: sessionFromState(sessionId, state),
      },
    }));

    try {
      const messages = await window.omp.chat.getMessages(sessionId);
      get()._patch(sessionId, (s) =>
        reduceSession(s, studioFrame.messages(messages)),
      );
    } catch (e) {
      get()._patch(sessionId, (s) => ({ ...s, error: errorMessage(e) }));
    }

    try {
      const subagents = await window.omp.chat.getSubagents(sessionId);
      get()._patch(sessionId, (s) =>
        reduceSession(s, studioFrame.subagents(subagents)),
      );
    } catch {
      // subagents are best-effort
    }
  },

  async start(opts) {
    get().ensureSubscribed();
    set({ creating: true, createError: undefined });
    try {
      const { sessionId, state } = await window.omp.chat.create(opts);
      void useSettingsStore.getState().recordProject(opts.cwd);
      set({ creating: false });
      // Register + activate before hydrating so the new pane shows instantly.
      get().openChat(sessionId);
      await get().openSession(sessionId, state);
    } catch (e) {
      set({ creating: false, createError: errorMessage(e) });
    }
  },

  async send(text) {
    const id = get().activeSessionId;
    const trimmed = text.trim();
    if (!id || !trimmed) return;
    const userMsg: UserMessage = {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    get()._patch(id, (s) => reduceSession(s, studioFrame.userMessage(userMsg)));
    try {
      if (get().openSessions[id]?.status === "streaming") {
        await window.omp.chat.prompt(id, text, {
          streamingBehavior: "followUp",
        });
      } else {
        await window.omp.chat.prompt(id, text);
      }
    } catch (e) {
      get()._patch(id, (s) => ({
        ...s,
        status: "error",
        error: errorMessage(e),
      }));
    }
  },

  async steer(text) {
    const id = get().activeSessionId;
    const trimmed = text.trim();
    if (!id || !trimmed) return;
    const userMsg: UserMessage = {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    get()._patch(id, (s) => reduceSession(s, studioFrame.userMessage(userMsg)));
    try {
      await window.omp.chat.steer(id, text);
    } catch (e) {
      get()._patch(id, (s) => ({ ...s, error: errorMessage(e) }));
    }
  },

  async abort() {
    const id = get().activeSessionId;
    if (!id) return;
    try {
      await window.omp.chat.abort(id);
    } catch {
      // best-effort; lifecycle/frames will reconcile
    }
    get()._patch(id, (s) => ({
      ...s,
      status: "idle",
      liveText: "",
      liveThinking: "",
      activeTool: null,
    }));
  },

  async setModel(provider, modelId) {
    const id = get().activeSessionId;
    if (!id) return;
    try {
      await window.omp.chat.setModel(id, provider, modelId);
      const st = await window.omp.chat.getState(id);
      get()._patch(id, (s) => reduceSession(s, studioFrame.state(st)));
    } catch (e) {
      get()._patch(id, (s) => ({ ...s, error: errorMessage(e) }));
    }
  },

  async setThinking(level) {
    const id = get().activeSessionId;
    if (!id) return;
    get()._patch(id, (s) => ({ ...s, thinkingLevel: level }));
    try {
      await window.omp.chat.setThinking(id, level);
    } catch (e) {
      get()._patch(id, (s) => ({ ...s, error: errorMessage(e) }));
    }
  },

  async respondUi(payload) {
    get()._patch(payload.sessionId, (s) =>
      reduceSession(s, studioFrame.uiResolved(payload.requestId)),
    );
    try {
      await window.omp.chat.respondUiRequest(payload);
    } catch (e) {
      get()._patch(payload.sessionId, (s) => ({
        ...s,
        error: errorMessage(e),
      }));
    }
  },

  _handleFrame(sessionId, frame) {
    if (!get().openSessions[sessionId]) return;
    get()._patch(sessionId, (s) => reduceSession(s, frame));
    // Signal frames carry no authoritative data; fetch a fresh snapshot and
    // feed it back through the reducer.
    switch (frame.type) {
      case "agent_end":
      case "turn_end":
        void get()._refresh(sessionId);
        break;
      case "todo_reminder":
      case "todo_auto_clear":
        void get()._refreshState(sessionId);
        break;
      case "subagent_lifecycle":
        void get()._refreshSubagents(sessionId);
        break;
      default:
        break;
    }
  },

  _handleLifecycle(e) {
    if (e.status === "error") {
      get()._patch(e.sessionId, (s) => ({
        ...s,
        status: "error",
        error: e.detail,
      }));
    } else if (e.status === "exited") {
      get()._patch(e.sessionId, (s) => ({
        ...s,
        status: "idle",
        activeTool: null,
      }));
    }
  },

  _handleUiRequest(e) {
    get()._patch(e.sessionId, (s) =>
      reduceSession(s, studioFrame.uiRequest(e)),
    );
  },

  _patch(sessionId, fn) {
    set((s) => {
      const cur = s.openSessions[sessionId];
      if (!cur) return s;
      const next = fn(cur);
      if (next === cur) return s;
      return { openSessions: { ...s.openSessions, [sessionId]: next } };
    });
  },

  async _refresh(sessionId) {
    try {
      const [messages, st] = await Promise.all([
        window.omp.chat.getMessages(sessionId),
        window.omp.chat.getState(sessionId),
      ]);
      get()._patch(sessionId, (s) =>
        reduceSession(
          reduceSession(s, studioFrame.messages(messages)),
          studioFrame.state(st),
        ),
      );
    } catch {
      // ignore transient refresh failures
    }
  },

  async _refreshState(sessionId) {
    try {
      const st = await window.omp.chat.getState(sessionId);
      get()._patch(sessionId, (s) => reduceSession(s, studioFrame.state(st)));
    } catch {
      // ignore transient state read failures
    }
  },

  async _refreshSubagents(sessionId) {
    try {
      const subagents = await window.omp.chat.getSubagents(sessionId);
      get()._patch(sessionId, (s) =>
        reduceSession(s, studioFrame.subagents(subagents)),
      );
    } catch {
      // ignore
    }
  },
}));

const EMPTY_SESSION: undefined = undefined;

/**
 * Subscribe to a slice of the *active* session. Returns the selector applied to
 * the active `LiveSessionState`, or to `undefined` when there is no active
 * session — so components keep the single-active-view ergonomics they had before
 * the store became multi-session. Always return stable references for the
 * no-session case (a shared constant) to avoid render loops.
 */
export function useActiveSession<T>(
  selector: (s: LiveSessionState | undefined) => T,
): T {
  return useChatStore((store) =>
    selector(
      store.activeSessionId
        ? store.openSessions[store.activeSessionId]
        : EMPTY_SESSION,
    ),
  );
}

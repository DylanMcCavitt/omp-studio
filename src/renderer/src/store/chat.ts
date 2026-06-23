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
  PromptOptions,
} from "@shared/ipc";
import type {
  ContentBlock,
  ImageContent,
  RpcFrame,
  RpcState,
  ThinkingLevel,
  UserMessage,
} from "@shared/rpc";
import { create } from "zustand";
import { useAppStore } from "@/store/app";
import { useApprovalStore } from "@/store/approvals";
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
  /** Dispose a session's child and drop its slice (transcript untouched). */
  closeSession(id: string): Promise<void>;

  /** Register/refresh a session slice from a get_state snapshot + hydrate it. */
  openSession(
    sessionId: string,
    state: RpcState,
    init?: Partial<LiveSessionState>,
  ): Promise<void>;
  /**
   * Spawn a new rpc-ui session, register it, and make it active. Resolves
   * `true` on success, `false` if the spawn failed (createError is set).
   */
  start(opts: ChatCreateOptions): Promise<boolean>;

  /**
   * Prompt the active session, optionally with image attachments (follows up
   * while it streams). Resolves `true` once the prompt is accepted by the
   * bridge, `false` if there was nothing to send or the IPC call failed.
   */
  send(text: string, images?: ImageContent[]): Promise<boolean>;
  /** Steer the active session mid-turn, optionally with image attachments. */
  steer(text: string, images?: ImageContent[]): Promise<boolean>;
  /** Abort the active session's current turn. */
  abort(): Promise<void>;
  setModel(provider: string, modelId: string): Promise<void>;
  setThinking(level: ThinkingLevel): Promise<void>;
  /** Answer an extension UI request and dequeue it from its session. */
  respondUi(payload: ChatUiRespondPayload): Promise<void>;
  /**
   * Drop a UI request from a session's queue WITHOUT writing a response.
   * For passive hints, open_url, and orphan cleanup (exit / renderer-side
   * timeout) where the bridge either expects no reply or has already settled.
   */
  dismissUiRequest(sessionId: string, requestId: string): void;
  /** Pull a fresh `get_session_stats` snapshot into the session slice. */
  refreshStats(sessionId: string): Promise<void>;
  /**
   * Compact a session's context (optionally steering the summary). Marks the
   * slice compacting for the duration, then refreshes state + stats once omp
   * reports completion. Compaction changes context only — the JSONL is untouched.
   */
  compact(sessionId: string, instructions?: string): Promise<void>;

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

// Build the optimistic user message appended to the transcript before the prompt
// round-trips. With attachments the content becomes ordered blocks (text first,
// then images) so MessageBubble can render the image blocks; image-only prompts
// omit the text block entirely.
function buildUserMessage(text: string, images?: ImageContent[]): UserMessage {
  if (!images || images.length === 0) {
    return { role: "user", content: text, timestamp: Date.now() };
  }
  const content: ContentBlock[] = [];
  if (text.trim() !== "") content.push({ type: "text", text });
  for (const image of images) {
    content.push({ type: "image", data: image.data, mimeType: image.mimeType });
  }
  return { role: "user", content, timestamp: Date.now() };
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

  async closeSession(id) {
    // close() disposes the child; the on-disk transcript is untouched (close ≠
    // delete). Best-effort so a failed IPC still drops the slice and the rail
    // reflects the close. The other open children keep their subscriptions and
    // keep streaming — closing one never touches another.
    try {
      await window.omp.chat.close(id);
    } catch {
      // main may have already torn the child down; fall through to drop it
    }
    set((s) => {
      if (!s.openSessions[id]) return s;
      const rest = Object.fromEntries(
        Object.entries(s.openSessions).filter(([key]) => key !== id),
      );
      const activeSessionId =
        s.activeSessionId === id
          ? (Object.keys(rest)[0] ?? null)
          : s.activeSessionId;
      return { openSessions: rest, activeSessionId };
    });
  },

  async openSession(sessionId, state, init = {}) {
    // Register the slice synchronously so streamed frames route immediately and
    // the pane can render before the transcript finishes hydrating.
    set((s) => ({
      openSessions: {
        ...s.openSessions,
        [sessionId]: {
          ...sessionFromState(sessionId, state),
          lastActivityAt: Date.now(),
          ...init,
        },
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

    // Populate stats for an already-running session (e.g. resumed mid-chat) so
    // the panel/meter show usage immediately rather than waiting for a turn end.
    void get().refreshStats(sessionId);
  },

  async start(opts) {
    get().ensureSubscribed();
    set({ creating: true, createError: undefined });
    try {
      const { sessionId, state } = await window.omp.chat.create(opts);
      void useSettingsStore.getState().recordProject(opts.cwd);
      // Record the spawn-time approval policy for the per-session approval
      // control (approval mode is fixed at spawn — there is no runtime setter).
      useApprovalStore
        .getState()
        .setPolicy(
          sessionId,
          opts.approvalPolicy ?? { mode: "always-ask", autoApprove: false },
        );
      set({ creating: false });
      // Register + activate before hydrating so the new pane shows instantly.
      get().openChat(sessionId);
      await get().openSession(sessionId, state, { cwd: opts.cwd });
      return true;
    } catch (e) {
      set({ creating: false, createError: errorMessage(e) });
      return false;
    }
  },

  async send(text, images) {
    const id = get().activeSessionId;
    const hasImages = Boolean(images && images.length > 0);
    if (!id || (text.trim() === "" && !hasImages)) return false;
    get()._patch(id, (s) =>
      reduceSession(s, studioFrame.userMessage(buildUserMessage(text, images))),
    );
    try {
      const streaming = get().openSessions[id]?.status === "streaming";
      const promptOpts: PromptOptions | undefined = streaming
        ? { streamingBehavior: "followUp", images }
        : hasImages
          ? { images }
          : undefined;
      await window.omp.chat.prompt(id, text, promptOpts);
      return true;
    } catch (e) {
      get()._patch(id, (s) => ({
        ...s,
        status: "error",
        error: errorMessage(e),
      }));
      return false;
    }
  },

  async steer(text, images) {
    const id = get().activeSessionId;
    const hasImages = Boolean(images && images.length > 0);
    if (!id || (text.trim() === "" && !hasImages)) return false;
    get()._patch(id, (s) =>
      reduceSession(s, studioFrame.userMessage(buildUserMessage(text, images))),
    );
    try {
      if (hasImages) {
        // chat.steer carries no images; the prompt command with a "steer"
        // streamingBehavior is the image-capable steer path.
        await window.omp.chat.prompt(id, text, {
          streamingBehavior: "steer",
          images,
        });
      } else {
        await window.omp.chat.steer(id, text);
      }
      return true;
    } catch (e) {
      get()._patch(id, (s) => ({ ...s, error: errorMessage(e) }));
      return false;
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

  dismissUiRequest(sessionId, requestId) {
    get()._patch(sessionId, (s) =>
      reduceSession(s, studioFrame.uiResolved(requestId)),
    );
  },

  async refreshStats(sessionId) {
    if (!get().openSessions[sessionId]) return;
    try {
      const stats = await window.omp.chat.getSessionStats(sessionId);
      get()._patch(sessionId, (s) =>
        reduceSession(s, studioFrame.stats(stats)),
      );
    } catch {
      // Stats are best-effort (the bridge degrades to {} on older omp builds);
      // leave the prior slice untouched on a transient failure.
    }
  },

  async compact(sessionId, instructions) {
    if (!get().openSessions[sessionId]) return;
    get()._patch(sessionId, (s) => ({ ...s, compacting: true }));
    try {
      await window.omp.chat.compact(sessionId, instructions);
    } catch (e) {
      get()._patch(sessionId, (s) => ({ ...s, error: errorMessage(e) }));
    } finally {
      get()._patch(sessionId, (s) => ({ ...s, compacting: false }));
      // Compaction shrinks context + may change token accounting; pull fresh
      // state and stats so the panel/meter reflect the post-compaction window.
      await get()._refreshState(sessionId);
      await get().refreshStats(sessionId);
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
        // Stats settle at turn end (tokens/cost/context); pull a fresh snapshot.
        // Event-driven, not polled — one fetch per turn boundary.
        void get().refreshStats(sessionId);
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
        status: "exited",
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
      // `next` is a freshly-built slice (the reducer/patch fns never return a
      // shared reference when they change state), so stamping the activity time
      // in place is copy-free — it powers the SessionRail "last activity"
      // column and keeps non-active sessions' rows live as frames arrive.
      next.lastActivityAt = Date.now();
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

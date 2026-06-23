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

import type { SessionTranscript } from "@shared/domain";
import type {
  ChatCreateOptions,
  ChatLifecycleEvent,
  ChatUiRequestEvent,
  ChatUiRespondPayload,
  OpenSessionDescriptor,
  PromptOptions,
} from "@shared/ipc";
import type {
  ContentBlock,
  ImageContent,
  OmpMessage,
  RpcFrame,
  RpcState,
  SubagentEventFrame,
  SubagentProgressFrame,
  ThinkingLevel,
  UserMessage,
} from "@shared/rpc";
import { create } from "zustand";
import { useAppStore } from "@/store/app";
import { useApprovalStore } from "@/store/approvals";
import {
  createSession,
  type LiveSessionState,
  reduceSession,
  sessionFromState,
  studioFrame,
} from "@/store/session-reducer";
import { useSettingsStore } from "@/store/settings";

export type { ChatStatus, LiveSessionState } from "@/store/session-reducer";

/**
 * A persisted open-session descriptor that is NOT currently live (no child).
 * These restore on boot (D3r) and render as muted, resumable rows in the rail.
 * `resuming` drives the in-flight spinner; `error` holds an honest failure
 * (missing JSONL / resume error) that surfaces a disabled error row + Remove.
 */
export interface HibernatedSession {
  descriptor: OpenSessionDescriptor;
  resuming?: boolean;
  error?: string;
}

/**
 * Live drill-in transcript buffer for the currently-open SubagentInspector
 * (feature 4). Only the LIVE path uses it: the store pumps `getSubagentMessages`
 * on each incoming progress/event frame for `subagentId`, appending `messages`
 * and advancing `cursor` (= `nextByte`); a `reset` clears and restarts. A
 * completed subagent is read once via `readSession` straight in the component.
 */
export interface SubagentInspectorState {
  sessionId: string;
  subagentId: string;
  sessionFile?: string;
  /** Whether the watched subagent is still live (gates cursor pumping). */
  live: boolean;
  /** Byte offset for the next incremental `getSubagentMessages` read. */
  cursor: number;
  messages: OmpMessage[];
  loading: boolean;
  /** True once a live read has completed, so empty ≠ not-yet-loaded. */
  started: boolean;
  error?: string;
}

interface ChatState {
  /** Every open session's render state, keyed by studio session id. */
  openSessions: Record<string, LiveSessionState>;
  /**
   * Persisted-but-not-live sessions (restored on boot), keyed by studio session
   * id. The rail lists these as hibernated rows; opening one resumes it and
   * promotes it into `openSessions`. Never overlaps with `openSessions`.
   */
  hibernatedSessions: Record<string, HibernatedSession>;
  /** The session shown in the active chat pane, or null for a fresh chat. */
  activeSessionId: string | null;
  /** True while a brand-new session is spawning (drives the start panel). */
  creating: boolean;
  /** Last create() failure, if any. */
  createError?: string;
  /** Cleanup for the single global bridge subscription (null until wired). */
  _unsub: (() => void) | null;
  /**
   * Live drill-in transcript buffer for the open SubagentInspector, or null
   * when none is open. Ephemeral; never persisted.
   */
  _subagentInspector: SubagentInspectorState | null;
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

  /**
   * Restore persisted open-session descriptors on boot (D3r). Reads the live
   * registry list (chat.list) unioned with settings.openSessions, deduped by
   * studio session id, and registers any descriptor without a live slice as a
   * hibernated row. Does NOT auto-spawn any child.
   */
  loadOpenSessions(): Promise<void>;
  /**
   * Open (resume) a hibernated descriptor: hydrate the transcript from JSONL
   * immediately so history shows while the child spawns, then merge live state
   * over it via the standard refresh path. A missing JSONL or a failed resume
   * surfaces an honest error row (no fabricated transcript).
   */
  resumeSession(id: string): Promise<void>;
  /**
   * Drop a hibernated/errored descriptor from the open list permanently
   * (registry dispose → settings re-persist) so it does not return on reboot.
   */
  removeHibernated(id: string): Promise<void>;

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
  /**
   * Open the live drill-in transcript for a subagent and seed its cursor. Live
   * subagents pump `getSubagentMessages` incrementally on each incoming
   * progress/event frame; completed ones are read once via `readSession` in the
   * inspector component. Only one inspector is open at a time.
   */
  openSubagentInspector(
    sessionId: string,
    subagentId: string,
    opts: { sessionFile?: string; live: boolean },
  ): void;
  /** Close the drill-in and drop its transcript buffer. */
  closeSubagentInspector(): void;
  /** Advance the open inspector's transcript cursor (frame-driven, not polled). */
  _pumpSubagentMessages(): Promise<void>;

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

// readSession degrades to an EMPTY PLACEHOLDER (sizeBytes 0, no messages)
// instead of throwing when a JSONL is missing/unreadable, so a deleted
// transcript must be detected from the result — otherwise resume would promote
// an empty session and (via the ompSessionId fallback) spawn a child against a
// transcript that no longer exists. A real session file always has bytes (at
// least a header); only the placeholder reports zero.
function transcriptIsMissing(t: SessionTranscript): boolean {
  return t.summary.sizeBytes === 0 && t.messages.length === 0;
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

// Single-flight guards for the inspector cursor pump: only one
// `getSubagentMessages` read runs at a time, and a frame that lands mid-read
// re-pumps once it finishes so the final bytes are never missed (no polling).
let inspectorPumpInFlight = false;
let inspectorPumpQueued = false;

export const useChatStore = create<ChatStore>()((set, get) => ({
  openSessions: {},
  hibernatedSessions: {},
  activeSessionId: null,
  creating: false,
  createError: undefined,
  _unsub: null,
  _subagentInspector: null,

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

  async loadOpenSessions() {
    // Open the global subscription first so a resumed child's frames route the
    // moment it spawns.
    get().ensureSubscribed();
    let listed: OpenSessionDescriptor[] = [];
    try {
      listed = await window.omp.chat.list();
    } catch {
      // chat.list is best-effort; fall back to the persisted settings below so a
      // boot still restores the workspace even if the registry call fails.
    }
    // Union the live registry list with the persisted descriptors (a fresh boot
    // has an empty in-memory registry, so settings.openSessions is the real
    // source), deduped by studio session id with the registry entry winning.
    const persisted = useSettingsStore.getState().settings?.openSessions ?? [];
    const byId = new Map<string, OpenSessionDescriptor>();
    for (const d of persisted) byId.set(d.studioSessionId, d);
    for (const d of listed) byId.set(d.studioSessionId, d);
    if (byId.size === 0) return;

    set((s) => {
      const hibernatedSessions = { ...s.hibernatedSessions };
      let changed = false;
      for (const descriptor of byId.values()) {
        const id = descriptor.studioSessionId;
        // A descriptor already live this run (created/resumed) is not hibernated.
        if (s.openSessions[id]) continue;
        const existing = hibernatedSessions[id];
        // Preserve an in-flight/error row; only refresh its descriptor.
        hibernatedSessions[id] = existing
          ? { ...existing, descriptor }
          : { descriptor };
        changed = true;
      }
      return changed ? { hibernatedSessions } : s;
    });
  },

  async resumeSession(id) {
    const row = get().hibernatedSessions[id];
    if (!row || row.resuming) return;
    const { descriptor } = row;
    get().ensureSubscribed();
    // Mark the row resuming (spinner, disabled) and clear any prior error.
    set((s) => ({
      hibernatedSessions: {
        ...s.hibernatedSessions,
        [id]: { descriptor, resuming: true },
      },
    }));

    // 1) Hydrate the transcript from JSONL FIRST (fast, local read) so history
    //    is visible the instant the slice mounts. readSession degrades to an
    //    empty PLACEHOLDER (no throw) when the file is missing/unreadable, so a
    //    deleted JSONL is detected from the result. Either failure is honest:
    //    surface the error row, register NO optimistic slice, and do NOT spawn
    //    (never fabricate a transcript).
    let hydrated: OmpMessage[] = [];
    if (descriptor.sessionFile) {
      const failResume = (message: string): void => {
        set((s) => ({
          hibernatedSessions: {
            ...s.hibernatedSessions,
            [id]: { descriptor, error: message },
          },
        }));
      };
      let transcript: SessionTranscript;
      try {
        transcript = await window.omp.readSession(descriptor.sessionFile);
      } catch (e) {
        failResume(errorMessage(e));
        return;
      }
      if (transcriptIsMissing(transcript)) {
        failResume(`Session transcript not found: ${descriptor.sessionFile}`);
        return;
      }
      hydrated = transcript.messages;
    }

    // 2) Show the hydrated history immediately: register an optimistic live
    //    slice (spawning) carrying the JSONL transcript, drop the hibernated
    //    row, and activate the pane while the child spawns.
    set((s) => {
      const hibernatedSessions = { ...s.hibernatedSessions };
      delete hibernatedSessions[id];
      return {
        hibernatedSessions,
        openSessions: {
          ...s.openSessions,
          [id]: createSession(id, {
            status: "spawning",
            cwd: descriptor.cwd,
            sessionName: descriptor.title ?? undefined,
            thinkingLevel: descriptor.thinkingLevel ?? "medium",
            sessionFile: descriptor.sessionFile,
            messages: hydrated,
            lastActivityAt: Date.now(),
          }),
        },
      };
    });
    get().openChat(id);
    // Mirror create()'s per-session approval policy so the C3 approval control
    // reflects the resumed child's spawn-time policy.
    useApprovalStore.getState().setPolicy(id, descriptor.approvalPolicy);

    // 3) Spawn + merge live state over the hydrated transcript via the standard
    //    refresh path. openSession seeds from the authoritative resume state and
    //    keeps `messages: hydrated` until live get_messages replaces it, so the
    //    transcript never flashes empty (no double-render).
    try {
      const { state } = await window.omp.chat.resume(descriptor);
      await get().openSession(id, state, {
        cwd: descriptor.cwd,
        messages: hydrated,
      });
    } catch (e) {
      // Resume failed: drop the optimistic slice and surface an honest error
      // row. The briefly-shown history is discarded — a dead child must not
      // leave a zombie live pane behind.
      set((s) => {
        const openSessions = { ...s.openSessions };
        delete openSessions[id];
        const activeSessionId =
          s.activeSessionId === id ? null : s.activeSessionId;
        return {
          openSessions,
          activeSessionId,
          hibernatedSessions: {
            ...s.hibernatedSessions,
            [id]: { descriptor, error: errorMessage(e) },
          },
        };
      });
    }
  },

  async removeHibernated(id) {
    set((s) => {
      if (!s.hibernatedSessions[id]) return s;
      const hibernatedSessions = { ...s.hibernatedSessions };
      delete hibernatedSessions[id];
      return { hibernatedSessions };
    });
    // Permanently drop the descriptor from the registry + persisted settings so
    // it does not reappear on the next boot. dispose() removes the record (and
    // re-persists); close() would only hibernate it.
    try {
      await window.omp.chat.dispose(id);
    } catch {
      // best-effort: the row is already gone from the rail
    }
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
      void useSettingsStore.getState().recordWorkspace(opts.cwd);
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

  openSubagentInspector(sessionId, subagentId, opts) {
    set({
      _subagentInspector: {
        sessionId,
        subagentId,
        sessionFile: opts.sessionFile,
        live: opts.live,
        cursor: 0,
        messages: [],
        loading: opts.live && Boolean(opts.sessionFile),
        started: false,
        error: undefined,
      },
    });
    // Live agents with a transcript get an immediate first read so history shows
    // before the next frame; later reads are frame-driven via _handleFrame.
    if (opts.live && opts.sessionFile) void get()._pumpSubagentMessages();
  },

  closeSubagentInspector() {
    if (get()._subagentInspector) set({ _subagentInspector: null });
  },

  async _pumpSubagentMessages() {
    const insp = get()._subagentInspector;
    if (!insp) return;
    if (!insp.live || !insp.sessionFile) return;
    if (inspectorPumpInFlight) {
      inspectorPumpQueued = true;
      return;
    }
    inspectorPumpInFlight = true;
    try {
      do {
        inspectorPumpQueued = false;
        const cur = get()._subagentInspector;
        if (!cur) break;
        if (!cur.live || !cur.sessionFile) break;
        try {
          const res = await window.omp.chat.getSubagentMessages(cur.sessionId, {
            sessionFile: cur.sessionFile,
            fromByte: cur.cursor,
          });
          set((s) => {
            const i = s._subagentInspector;
            // The inspector may have closed or switched subagents mid-read;
            // only apply when it still points at the same one.
            if (
              !i ||
              i.subagentId !== cur.subagentId ||
              i.sessionId !== cur.sessionId
            ) {
              return s;
            }
            const messages = res.reset
              ? res.messages
              : [...i.messages, ...res.messages];
            return {
              _subagentInspector: {
                ...i,
                messages,
                cursor: res.nextByte,
                loading: false,
                started: true,
                error: undefined,
              },
            };
          });
        } catch (e) {
          set((s) => {
            const i = s._subagentInspector;
            if (!i || i.subagentId !== cur.subagentId) return s;
            return {
              _subagentInspector: {
                ...i,
                loading: false,
                started: true,
                error: errorMessage(e),
              },
            };
          });
          break;
        }
      } while (inspectorPumpQueued);
    } finally {
      inspectorPumpInFlight = false;
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
      case "subagent_progress":
      case "subagent_event": {
        // The reducer already stored the NESTED payload; if the open inspector
        // is watching this live subagent, advance its transcript cursor.
        const insp = get()._subagentInspector;
        if (insp?.live && insp.sessionFile) {
          const p = (frame as SubagentEventFrame | SubagentProgressFrame)
            .payload as { id?: string; progress?: { id?: string } };
          const fid = p?.id ?? p?.progress?.id;
          if (fid && fid === insp.subagentId) {
            void get()._pumpSubagentMessages();
          }
        }
        break;
      }
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

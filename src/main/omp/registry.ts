// Owns the set of live `omp --mode rpc-ui` sessions plus the persisted
// descriptor of every open chat (live or hibernated), keyed by an opaque id the
// renderer uses to address a chat. Plain node, no electron.
//
// One child per live chat. Hibernation disposes the child but KEEPS the
// descriptor so the chat can be resumed later. Descriptors are persisted to the
// main-owned settings store (B1) on create, turn-end, hibernate, and dispose so
// the workspace survives an app restart. The JSONL transcript file is the
// durable resume token; the runtime omp session id is display metadata that may
// change across resume.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { OpenSessionDescriptor } from "@shared/ipc";
import type {
  ApprovalMode,
  ApprovalPolicy,
  RpcFrame,
  RpcState,
  ThinkingLevel,
} from "@shared/rpc";
import { scoped } from "../logger";
import { updateSettings } from "../services/settings-service";
import { OmpRpcSession } from "./rpc-session";

const log = scoped("registry");

/** The fully-resolved spawn config handed to the session factory. */
export interface SpawnSessionOptions {
  cwd: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  approvalMode: ApprovalMode;
  autoApprove: boolean;
  /** JSONL path (preferred) or omp session id when resuming an existing chat. */
  resume?: string;
}

// How the registry materializes a live session. Injectable at construction —
// main owns the registry and the renderer never constructs it, so this is not a
// renderer-reachable sink — letting tests assert the resolved spawn config
// without spawning a child. Mirrors config-service's injectable CLI runner.
export type SessionFactory = (opts: SpawnSessionOptions) => OmpRpcSession;

// Persistence seam for open-session descriptors. Defaults to the B1 settings
// store; tests inject a stub to assert what is persisted without touching
// userData. Only ever handed descriptors — never secrets.
export interface SessionStore {
  save(descriptors: OpenSessionDescriptor[]): Promise<void>;
}

/** A chat the registry currently tracks (live or hibernated). */
export interface LiveSessionSnapshot {
  id: string;
  cwd: string;
  model?: string;
  status: OpenSessionDescriptor["status"];
  sessionFile?: string;
  lastActiveAt: string;
}

// In-memory record: the descriptor we persist plus the live child (null once
// hibernated). Keeping the descriptor after the child is gone is what lets a
// chat be resumed.
interface SessionRecord {
  child: OmpRpcSession | null;
  descriptor: OpenSessionDescriptor;
}

const defaultFactory: SessionFactory = (opts) => new OmpRpcSession(opts);

const defaultStore: SessionStore = {
  save: async (openSessions) => {
    await updateSettings({ openSessions });
  },
};

export class SessionRegistry {
  private readonly records = new Map<string, SessionRecord>();
  // Children inside the create/resume spawn-to-ready window. They are not in
  // `records` yet, so disposeAll() sweeps this set too — quit during startup
  // must not orphan a freshly spawned child.
  private readonly inFlight = new Set<OmpRpcSession>();
  // In-flight resumes keyed by studio session id. hibernate()/dispose() flag
  // the token so a resume that completes AFTER a deliberate teardown does not
  // resurrect the closed chat (the teardown wins).
  private readonly resuming = new Map<string, { cancelled: boolean }>();
  private readonly createSession: SessionFactory;
  private readonly store: SessionStore;

  constructor(opts?: { createSession?: SessionFactory; store?: SessionStore }) {
    this.createSession = opts?.createSession ?? defaultFactory;
    this.store = opts?.store ?? defaultStore;
  }

  // Seed the registry with persisted open-session descriptors on boot, as
  // HIBERNATED records (no live child). Without this, a fresh process starts
  // with an empty record set, so `chat:list` returns nothing and the first
  // `resume`/`persist` writes only its own records back to settings —
  // clobbering the un-resumed descriptors. Seeding here keeps the full open set
  // in memory so list() surfaces it and persist() preserves it (merge by id;
  // an already-tracked id is never overwritten). Idempotent and child-free, so
  // no turn-end listener is attached until the chat is actually resumed.
  hydrate(descriptors: OpenSessionDescriptor[]): void {
    for (const descriptor of descriptors) {
      const id = descriptor.studioSessionId;
      if (this.records.has(id)) continue;
      this.records.set(id, {
        child: null,
        descriptor: { ...descriptor, status: "hibernated" },
      });
    }
  }

  async create(opts: {
    cwd: string;
    model?: string;
    thinkingLevel?: ThinkingLevel;
    approvalPolicy?: ApprovalPolicy;
  }): Promise<{ id: string; session: OmpRpcSession; state: RpcState }> {
    const id = randomUUID();
    // Default to the safest policy (ask every time, no blanket auto-approve)
    // when the renderer omits one.
    const approvalPolicy: ApprovalPolicy = opts.approvalPolicy ?? {
      mode: "always-ask",
      autoApprove: false,
    };
    const session = this.createSession({
      cwd: opts.cwd,
      model: opts.model,
      thinkingLevel: opts.thinkingLevel,
      approvalMode: approvalPolicy.mode,
      autoApprove: approvalPolicy.autoApprove,
    });
    const state = await this.startSession(session);
    const now = new Date().toISOString();
    const descriptor: OpenSessionDescriptor = {
      studioSessionId: id,
      cwd: opts.cwd,
      createdAt: now,
      lastActiveAt: now,
      title: state.sessionName ?? null,
      approvalPolicy,
      status: "open",
    };
    if (opts.model) descriptor.model = opts.model;
    if (opts.thinkingLevel) descriptor.thinkingLevel = opts.thinkingLevel;
    if (state.sessionFile) descriptor.sessionFile = state.sessionFile;
    if (state.sessionId) descriptor.ompSessionId = state.sessionId;
    this.register(id, session, descriptor);
    await this.persist();
    return { id, session, state };
  }

  // Resume a hibernated/persisted chat. The JSONL path is the preferred resume
  // token; fall back to the omp session id when the file is gone. A descriptor
  // with neither a readable transcript nor an id cannot be resumed — we surface
  // a clear error instead of spawning an empty session (no fake transcript).
  async resume(
    descriptor: OpenSessionDescriptor,
  ): Promise<{ id: string; session: OmpRpcSession; state: RpcState }> {
    const id = descriptor.studioSessionId;
    const resume = resolveResumeToken(descriptor);
    const session = this.createSession({
      cwd: descriptor.cwd,
      model: descriptor.model,
      thinkingLevel: descriptor.thinkingLevel,
      approvalMode: descriptor.approvalPolicy.mode,
      autoApprove: descriptor.approvalPolicy.autoApprove,
      resume,
    });
    // A hibernate/dispose landing while this resume awaits ready must WIN —
    // completing the resume anyway would resurrect a chat the user just
    // closed. The token is flagged by hibernate()/dispose() and checked
    // after the await.
    const token = { cancelled: false };
    this.resuming.set(id, token);
    let state: RpcState;
    try {
      state = await this.startSession(session);
    } finally {
      this.resuming.delete(id);
    }
    if (token.cancelled) {
      session.dispose();
      throw new Error("session was closed while resuming");
    }
    // Keep the studioSessionId stable across resume; the runtime sessionFile and
    // omp session id may have changed and are refreshed from live state.
    const refreshed: OpenSessionDescriptor = {
      ...descriptor,
      lastActiveAt: new Date().toISOString(),
      status: "open",
    };
    if (state.sessionFile) refreshed.sessionFile = state.sessionFile;
    if (state.sessionId) refreshed.ompSessionId = state.sessionId;
    if (refreshed.title === null && state.sessionName) {
      refreshed.title = state.sessionName;
    }
    // A resume targeting an already-live chat must retire the previous child
    // before replacing the record, or the orphan keeps emitting frames against
    // a session id that now points at a different child.
    this.records.get(id)?.child?.dispose();
    this.register(id, session, refreshed);
    await this.persist();
    return { id, session, state };
  }

  get(id: string): OmpRpcSession | undefined {
    return this.records.get(id)?.child ?? undefined;
  }

  /** Snapshot of every chat the registry tracks (live + hibernated). */
  list(): LiveSessionSnapshot[] {
    return [...this.records.values()].map((record) => {
      const d = record.descriptor;
      const snapshot: LiveSessionSnapshot = {
        id: d.studioSessionId,
        cwd: d.cwd,
        status: d.status,
        lastActiveAt: d.lastActiveAt,
      };
      if (d.model) snapshot.model = d.model;
      if (d.sessionFile) snapshot.sessionFile = d.sessionFile;
      return snapshot;
    });
  }

  /** The persisted-shape descriptors backing `chat:list`. */
  descriptors(): OpenSessionDescriptor[] {
    return [...this.records.values()].map((record) => record.descriptor);
  }

  // Hibernate: dispose the child but KEEP the descriptor so the chat can be
  // resumed. The session stays in the list as "hibernated".
  async hibernate(id: string): Promise<void> {
    const resuming = this.resuming.get(id);
    if (resuming) resuming.cancelled = true;
    const record = this.records.get(id);
    if (!record) return;
    record.child?.dispose();
    record.child = null;
    record.descriptor.status = "hibernated";
    record.descriptor.lastActiveAt = new Date().toISOString();
    await this.persist();
  }

  // Full teardown: dispose the child AND drop the descriptor from the open set.
  // Unlike hibernate, the chat no longer appears in the workspace (the JSONL
  // transcript on disk is untouched — deletion is a separate session action).
  async dispose(id: string): Promise<void> {
    const resuming = this.resuming.get(id);
    if (resuming) resuming.cancelled = true;
    const record = this.records.get(id);
    if (!record) return;
    this.records.delete(id);
    record.child?.dispose();
    await this.persist();
  }

  // Stop every live child but RETAIN the descriptor records (marked hibernated)
  // so the workspace survives. On macOS window-all-closed does NOT quit the app,
  // so a reopened window must still be able to list/resume these chats.
  // Synchronous to match the electron lifecycle hooks that call it.
  disposeAll(): void {
    // Children still in the spawn-to-ready window: not yet registered, but
    // alive. dispose() rejects their whenReady(), so the awaiting create/
    // resume unwinds with "session disposed" instead of resolving.
    for (const session of this.inFlight) session.dispose();
    this.inFlight.clear();
    for (const record of this.records.values()) {
      record.child?.dispose();
      record.child = null;
      record.descriptor.status = "hibernated";
    }
  }

  // ---- internals --------------------------------------------------------

  private async startSession(session: OmpRpcSession): Promise<RpcState> {
    this.inFlight.add(session);
    try {
      await session.whenReady();
      return await session.getState();
    } catch (error) {
      // A session that never became ready must not leak its child process.
      session.dispose();
      throw error;
    } finally {
      this.inFlight.delete(session);
    }
  }

  private register(
    id: string,
    session: OmpRpcSession,
    descriptor: OpenSessionDescriptor,
  ): void {
    this.records.set(id, { child: session, descriptor });
    // Refresh lastActiveAt on every completed turn so the persisted descriptor
    // reflects recency for restore ordering. dispose() removes this listener.
    session.on("frame", (frame: RpcFrame) => {
      if (frame.type === "agent_end") void this.onTurnEnd(id);
    });
    // Self-exit / crash handling. This fires ONLY for a child that dies on
    // its own: OmpRpcSession.dispose() calls removeAllListeners() BEFORE
    // killing the child (load-bearing ordering — see dispose()), so every
    // deliberate teardown (hibernate / dispose / resume-replace) never
    // reaches this listener. Without it a crashed child would stay listed
    // as status:"open" with a dead child ref, and chat commands would throw
    // "unknown session" at a chat the UI still shows as live.
    session.on("exit", () => {
      const record = this.records.get(id);
      // Already replaced (resume) or dropped (dispose) — nothing to reconcile.
      if (!record || record.child !== session) return;
      log.warn("session child exited on its own; hibernating record", { id });
      record.child = null;
      record.descriptor.status = "hibernated";
      record.descriptor.lastActiveAt = new Date().toISOString();
      void this.persist();
    });
  }

  private async onTurnEnd(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    record.descriptor.lastActiveAt = new Date().toISOString();
    record.descriptor.status = "open";
    await this.persist();
  }

  private async persist(): Promise<void> {
    try {
      await this.store.save(this.descriptors());
    } catch (error) {
      // A settings-write failure must not tear down a live session.
      log.warn("failed to persist open sessions", { error });
    }
  }
}

// The JSONL transcript (when present on disk) is the stable resume token;
// otherwise fall back to the omp session id. Throw a clear error when neither
// can drive a resume so the caller never silently spawns an empty session.
function resolveResumeToken(descriptor: OpenSessionDescriptor): string {
  if (descriptor.sessionFile && existsSync(descriptor.sessionFile)) {
    return descriptor.sessionFile;
  }
  if (descriptor.ompSessionId) return descriptor.ompSessionId;
  if (descriptor.sessionFile) {
    throw new Error(
      `cannot resume session: transcript not found at ${descriptor.sessionFile} and no omp session id is available`,
    );
  }
  throw new Error(
    "cannot resume session: no transcript file or omp session id to resume from",
  );
}

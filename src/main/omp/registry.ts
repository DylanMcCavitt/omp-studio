// Owns the set of live `omp --mode rpc` sessions, keyed by an opaque id the
// renderer uses to address a chat. Plain node, no electron.

import { randomUUID } from "node:crypto";
import type {
  ApprovalMode,
  ApprovalPolicy,
  RpcState,
  ThinkingLevel,
} from "@shared/rpc";
import { OmpRpcSession } from "./rpc-session";

/** The fully-resolved spawn config handed to the session factory. */
interface SpawnSessionOptions {
  cwd: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  approvalMode: ApprovalMode;
  autoApprove: boolean;
}

// How the registry materializes a live session. Injectable at construction —
// main owns the registry and the renderer never constructs it, so this is not a
// renderer-reachable sink — letting tests assert the resolved spawn config
// without spawning a child. Mirrors config-service's injectable CLI runner.
type SessionFactory = (opts: SpawnSessionOptions) => OmpRpcSession;

export class SessionRegistry {
  private readonly sessions = new Map<string, OmpRpcSession>();
  private readonly createSession: SessionFactory;

  constructor(createSession?: SessionFactory) {
    this.createSession = createSession ?? ((opts) => new OmpRpcSession(opts));
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
    const session = this.createSession({
      cwd: opts.cwd,
      model: opts.model,
      thinkingLevel: opts.thinkingLevel,
      approvalMode: opts.approvalPolicy?.mode ?? "always-ask",
      autoApprove: opts.approvalPolicy?.autoApprove ?? false,
    });
    try {
      await session.whenReady();
      const state = await session.getState();
      this.sessions.set(id, session);
      return { id, session, state };
    } catch (error) {
      // A session that never became ready must not leak its child process.
      session.dispose();
      throw error;
    }
  }

  get(id: string): OmpRpcSession | undefined {
    return this.sessions.get(id);
  }

  async dispose(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    session.dispose();
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
  }
}

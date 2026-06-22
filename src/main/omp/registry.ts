// Owns the set of live `omp --mode rpc` sessions, keyed by an opaque id the
// renderer uses to address a chat. Plain node, no electron.

import { randomUUID } from "node:crypto";
import type { ApprovalPolicy, RpcState, ThinkingLevel } from "@shared/rpc";
import { OmpRpcSession } from "./rpc-session";

export class SessionRegistry {
  private readonly sessions = new Map<string, OmpRpcSession>();

  async create(opts: {
    cwd: string;
    model?: string;
    thinkingLevel?: ThinkingLevel;
    approvalPolicy?: ApprovalPolicy;
    /** test seam: override the resolved omp binary */
    binary?: string;
  }): Promise<{ id: string; session: OmpRpcSession; state: RpcState }> {
    const id = randomUUID();
    // Default to the safest policy (ask every time, no blanket auto-approve)
    // when the renderer omits one.
    const session = new OmpRpcSession({
      cwd: opts.cwd,
      model: opts.model,
      thinkingLevel: opts.thinkingLevel,
      approvalMode: opts.approvalPolicy?.mode ?? "always-ask",
      autoApprove: opts.approvalPolicy?.autoApprove ?? false,
      binary: opts.binary,
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

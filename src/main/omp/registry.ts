// Owns the set of live `omp --mode rpc` sessions, keyed by an opaque id the
// renderer uses to address a chat. Plain node, no electron.

import { randomUUID } from "node:crypto";
import type { RpcState, ThinkingLevel } from "@shared/rpc";
import { OmpRpcSession } from "./rpc-session";

export class SessionRegistry {
  private readonly sessions = new Map<string, OmpRpcSession>();

  async create(opts: {
    cwd: string;
    model?: string;
    thinkingLevel?: ThinkingLevel;
  }): Promise<{ id: string; session: OmpRpcSession; state: RpcState }> {
    const id = randomUUID();
    const session = new OmpRpcSession(opts);
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

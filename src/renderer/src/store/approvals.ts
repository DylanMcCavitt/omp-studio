// Per-session approval UI state (C3): the session's approval policy (captured
// at spawn, for display) and its user-built "Always-allow-for-this-session"
// allowlist. This is renderer-only UI state — NOT derived from the omp RPC
// stream — so it lives in its own store rather than polluting the pure session
// reducer. Entries are keyed by studio session id; `prune` drops state for
// sessions no longer open (the UiRequestLayer calls it as openSessions change),
// so closing a session also forgets its allowlist without the chat store
// having to know about approvals.

import type { ApprovalPolicy } from "@shared/rpc";
import { create } from "zustand";

/** One always-allow rule: a stable structured key + a label for the panel. */
export interface AllowRule {
  key: string;
  label: string;
  createdAt: number;
}

interface ApprovalState {
  /** Approval policy captured at spawn, keyed by session id (display only). */
  policies: Record<string, ApprovalPolicy>;
  /** Always-allow rules per session id. */
  rulesBySession: Record<string, AllowRule[]>;

  setPolicy(sessionId: string, policy: ApprovalPolicy): void;
  /** Add (or refresh) an allow rule; deduped by key. */
  addRule(sessionId: string, rule: AllowRule): void;
  revokeRule(sessionId: string, key: string): void;
  /** Drop policy + rules for any session id not in `liveSessionIds`. */
  prune(liveSessionIds: readonly string[]): void;
}

export const useApprovalStore = create<ApprovalState>()((set) => ({
  policies: {},
  rulesBySession: {},

  setPolicy(sessionId, policy) {
    set((s) => ({ policies: { ...s.policies, [sessionId]: policy } }));
  },

  addRule(sessionId, rule) {
    set((s) => {
      const existing = s.rulesBySession[sessionId] ?? [];
      if (existing.some((r) => r.key === rule.key)) return s;
      return {
        rulesBySession: {
          ...s.rulesBySession,
          [sessionId]: [...existing, rule],
        },
      };
    });
  },

  revokeRule(sessionId, key) {
    set((s) => {
      const existing = s.rulesBySession[sessionId];
      if (!existing) return s;
      const next = existing.filter((r) => r.key !== key);
      if (next.length === existing.length) return s;
      return {
        rulesBySession: { ...s.rulesBySession, [sessionId]: next },
      };
    });
  },

  prune(liveSessionIds) {
    set((s) => {
      const live = new Set(liveSessionIds);
      const policies: Record<string, ApprovalPolicy> = {};
      const rulesBySession: Record<string, AllowRule[]> = {};
      let changed = false;
      for (const [id, policy] of Object.entries(s.policies)) {
        if (live.has(id)) policies[id] = policy;
        else changed = true;
      }
      for (const [id, rules] of Object.entries(s.rulesBySession)) {
        if (live.has(id)) rulesBySession[id] = rules;
        else changed = true;
      }
      return changed ? { policies, rulesBySession } : s;
    });
  },
}));

/** Stable empty rule list so no-rule sessions keep a steady selector ref. */
export const NO_RULES: AllowRule[] = [];

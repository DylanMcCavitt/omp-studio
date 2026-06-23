// Renderer mirror of the main-owned Linear integration (feature 2). Every
// Linear HTTP call lives in main behind `window.omp.linear.*`; this store holds
// only the mapped, non-secret domain shapes (status, teams, projects, issues)
// plus loading/error flags. The API key is NEVER held here: `connect` forwards
// it once to `linear.setApiKey` and retains nothing, `disconnect` asks main to
// delete it. Every bridge call degrades ([] / unauthenticated) over throwing.

import type {
  LinearIssue,
  LinearProjectInfo,
  LinearStatusInfo,
  LinearTeam,
} from "@shared/domain";
import { create } from "zustand";

/** Backend-scoped issue filters forwarded verbatim to `listIssues`. */
export interface LinearIssueFilters {
  teamId?: string;
  assignedToMe?: boolean;
}

/** The status the renderer assumes whenever there is no validated key. */
const UNAUTHENTICATED: LinearStatusInfo = {
  status: "unauthenticated",
  writesEnabled: false,
};

interface LinearState {
  /** Latest auth status; null until the first `loadStatus` resolves. */
  status: LinearStatusInfo | null;
  statusLoading: boolean;
  /** True while a connect/disconnect mutation is in flight. */
  connecting: boolean;

  teams: LinearTeam[];
  projects: LinearProjectInfo[];
  issues: LinearIssue[];
  loading: boolean;
  error: string | undefined;

  /** Fetch auth status. Degrades to an `error` status, never throws. */
  loadStatus(): Promise<void>;
  /** Fetch teams for the team filter (degrades to []). */
  loadTeams(): Promise<void>;
  /** Fetch projects (optionally scoped to a team) for the project filter. */
  loadProjects(teamId?: string): Promise<void>;
  /** Fetch issues for the given backend filters (degrades to []). */
  loadIssues(filters?: LinearIssueFilters): Promise<void>;
  /**
   * Forward an API key to main (validated + stored in the OS keychain there),
   * adopt the returned non-secret status, and prime the data on success. The
   * key itself is never written into the store.
   */
  connect(key: string): Promise<LinearStatusInfo>;
  /** Ask main to delete the stored key and reset all Linear state locally. */
  disconnect(): Promise<void>;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useLinearStore = create<LinearState>((set, get) => ({
  status: null,
  statusLoading: true,
  connecting: false,
  teams: [],
  projects: [],
  issues: [],
  loading: false,
  error: undefined,

  async loadStatus() {
    set({ statusLoading: true });
    try {
      const status = await window.omp.linear.status();
      set({ status, statusLoading: false });
    } catch (e) {
      set({
        statusLoading: false,
        status: { status: "error", writesEnabled: false },
        error: message(e),
      });
    }
  },

  async loadTeams() {
    try {
      set({ teams: await window.omp.linear.listTeams() });
    } catch {
      set({ teams: [] });
    }
  },

  async loadProjects(teamId) {
    try {
      set({ projects: await window.omp.linear.listProjects(teamId) });
    } catch {
      set({ projects: [] });
    }
  },

  async loadIssues(filters) {
    set({ loading: true, error: undefined });
    try {
      const issues = await window.omp.linear.listIssues(filters);
      set({ issues, loading: false });
    } catch (e) {
      set({ issues: [], loading: false, error: message(e) });
    }
  },

  async connect(key) {
    set({ connecting: true, error: undefined });
    try {
      const status = await window.omp.linear.setApiKey(key);
      set({ status, connecting: false });
      // Prime the browse surface immediately on a good key so the view doesn't
      // flash an empty list before its own effects run.
      if (status.status === "authenticated") {
        void get().loadTeams();
        void get().loadProjects();
        void get().loadIssues();
      }
      return status;
    } catch (e) {
      const status: LinearStatusInfo = {
        status: "error",
        writesEnabled: false,
      };
      set({ status, connecting: false, error: message(e) });
      return status;
    }
  },

  async disconnect() {
    set({ connecting: true });
    let error: string | undefined;
    try {
      await window.omp.linear.clearApiKey();
    } catch (e) {
      // Deletion is best-effort; the local reset below still detaches the
      // renderer from every Linear shape regardless.
      error = message(e);
    }
    set({
      connecting: false,
      status: UNAUTHENTICATED,
      teams: [],
      projects: [],
      issues: [],
      error,
    });
  },
}));

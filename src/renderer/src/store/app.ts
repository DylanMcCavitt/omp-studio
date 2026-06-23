import { create } from "zustand";

// Source of truth for the set of shell destinations. `lib/nav-registry.ts` keys
// its `Record<Route, …>` registry off this union, so a route added here without
// a matching NAV_ENTRIES entry (or vice versa) fails to typecheck (D2 coverage).
export type Route =
  | "dashboard"
  | "chat"
  | "sessions"
  | "skills"
  | "mcp"
  | "agents"
  | "github"
  | "linear"
  | "settings";

/** A request to open a specific session transcript scrolled to a message. */
export interface SessionFocus {
  /** Absolute path to the session's .jsonl file. */
  path: string;
  /** Message index to scroll to (-1 = none, just open the session). */
  messageIndex: number;
}

interface AppState {
  route: Route;
  setRoute: (r: Route) => void;

  /** Working directory selected for new chats / scoping, or null for default. */
  selectedProject: string | null;
  setSelectedProject: (p: string | null) => void;

  /** Pending request to focus a session in the Sessions view (consumed once). */
  sessionFocus: SessionFocus | null;
  /** Navigate to Sessions and request the given transcript + message focus. */
  focusSession: (focus: SessionFocus) => void;
  /** Clear the pending focus once the Sessions view has consumed it. */
  clearSessionFocus: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  route: "dashboard",
  setRoute: (route) => set({ route }),

  selectedProject: null,
  setSelectedProject: (selectedProject) => set({ selectedProject }),

  sessionFocus: null,
  focusSession: (sessionFocus) => set({ route: "sessions", sessionFocus }),
  clearSessionFocus: () => set({ sessionFocus: null }),
}));

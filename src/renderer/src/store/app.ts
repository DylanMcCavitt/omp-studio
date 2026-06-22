import { create } from "zustand";

export type Route =
  | "dashboard"
  | "chat"
  | "sessions"
  | "skills"
  | "mcp"
  | "agents"
  | "github"
  | "settings";

interface AppState {
  route: Route;
  setRoute: (r: Route) => void;

  /** Working directory selected for new chats / scoping, or null for default. */
  selectedProject: string | null;
  setSelectedProject: (p: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  route: "dashboard",
  setRoute: (route) => set({ route }),

  selectedProject: null,
  setSelectedProject: (selectedProject) => set({ selectedProject }),
}));

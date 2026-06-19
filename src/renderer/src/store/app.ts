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

  /** The chat session id currently open, or null for a fresh, unstarted chat. */
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  /** Open an existing chat session and switch to the chat view. */
  openChat: (id: string) => void;
  /** Start a brand-new chat (no session yet) and switch to the chat view. */
  newChat: () => void;

  /** Working directory selected for new chats / scoping, or null for default. */
  selectedProject: string | null;
  setSelectedProject: (p: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  route: "dashboard",
  setRoute: (route) => set({ route }),

  activeChatId: null,
  setActiveChatId: (activeChatId) => set({ activeChatId }),
  openChat: (id) => set({ activeChatId: id, route: "chat" }),
  newChat: () => set({ activeChatId: null, route: "chat" }),

  selectedProject: null,
  setSelectedProject: (selectedProject) => set({ selectedProject }),
}));

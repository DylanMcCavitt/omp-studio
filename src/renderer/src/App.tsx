import { useEffect } from "react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { Layout } from "@/components/Layout";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { useShortcuts } from "@/lib/useShortcuts";
import { useTheme } from "@/lib/useTheme";
import { useAppStore } from "@/store/app";
import { useChatStore } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";
import ChatWorkspace from "@/views/Chat";

// The center is ALWAYS the Chat primary surface (the active session's transcript,
// else a minimal empty state). The 9 nav destinations live only in the right icon
// rail — `RailPanelHost` renders them off the shell store's `openPanelId`, never
// `route` (AGE-632). Center file tabs (chat + open files) are AGE-634.
export default function App() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const loadSettings = useSettingsStore((s) => s.load);
  const ensureSubscribed = useChatStore((s) => s.ensureSubscribed);
  const loadOpenSessions = useChatStore((s) => s.loadOpenSessions);
  // Apply the persisted theme to the document (follows the OS when "system").
  useTheme();
  // Single global keyboard-shortcut manager (Cmd+T/N/W/1-9/K/Shift+P, Esc).
  useShortcuts();
  // Bootstrap once: load persisted settings, open the single global bridge
  // subscription that routes every session's frames into the chat store, then
  // restore persisted open-session descriptors as hibernated rail rows (D3r).
  // Settings load first so loadOpenSessions can union settings.openSessions
  // with the live registry list; no children are auto-spawned on boot.
  useEffect(() => {
    void (async () => {
      await loadSettings();
      // Seed the workspace selection from the saved default so the switcher and
      // new chats target it out of the box (the removed StartPanel used to do
      // this on first render). Never clobber a selection already made.
      const app = useAppStore.getState();
      const defaultProject =
        useSettingsStore.getState().settings?.defaultProject;
      if (!app.selectedProject && defaultProject) {
        app.setSelectedProject(defaultProject);
      }
      ensureSubscribed();
      await loadOpenSessions();
    })();
  }, [loadSettings, ensureSubscribed, loadOpenSessions]);
  return (
    <Layout>
      {/* A crash in the chat surface shows a fallback, not a blank window; the
          shell (sidebar / header / rail) and search stay alive. resetKey tracks
          the active session so opening another chat clears a crashed transcript. */}
      <AppErrorBoundary resetKey={activeSessionId}>
        <ChatWorkspace />
      </AppErrorBoundary>
      <GlobalSearch />
    </Layout>
  );
}

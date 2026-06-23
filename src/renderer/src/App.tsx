import { type ComponentType, useEffect } from "react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { Layout } from "@/components/Layout";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { useShortcuts } from "@/lib/useShortcuts";
import { useTheme } from "@/lib/useTheme";
import { type Route, useAppStore } from "@/store/app";
import { useChatStore } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";
import Agents from "@/views/Agents";
import Chat from "@/views/Chat";
import Dashboard from "@/views/Dashboard";
import GitHub from "@/views/GitHub";
import Mcp from "@/views/Mcp";
import Sessions from "@/views/Sessions";
import Settings from "@/views/Settings";
import Skills from "@/views/Skills";

const VIEWS: Record<Route, ComponentType> = {
  dashboard: Dashboard,
  chat: Chat,
  sessions: Sessions,
  skills: Skills,
  mcp: Mcp,
  agents: Agents,
  github: GitHub,
  settings: Settings,
};

export default function App() {
  const route = useAppStore((s) => s.route);
  const setRoute = useAppStore((s) => s.setRoute);
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
      ensureSubscribed();
      await loadOpenSessions();
    })();
  }, [loadSettings, ensureSubscribed, loadOpenSessions]);
  const View = VIEWS[route];
  return (
    <Layout>
      {/* A crash in the active view shows a fallback, not a blank window; the
          shell (sidebar/header) and search stay alive. resetKey={route} clears
          the error when the user navigates away via the sidebar. */}
      <AppErrorBoundary resetKey={route} onReset={() => setRoute("dashboard")}>
        <View />
      </AppErrorBoundary>
      <GlobalSearch />
    </Layout>
  );
}

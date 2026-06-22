import { type ComponentType, useEffect } from "react";
import { Layout } from "@/components/Layout";
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
  const loadSettings = useSettingsStore((s) => s.load);
  const ensureSubscribed = useChatStore((s) => s.ensureSubscribed);
  // Bootstrap once: load persisted settings and open the single global bridge
  // subscription that routes every session's frames into the chat store.
  useEffect(() => {
    void loadSettings();
    ensureSubscribed();
  }, [loadSettings, ensureSubscribed]);
  const View = VIEWS[route];
  return (
    <Layout>
      <View />
    </Layout>
  );
}

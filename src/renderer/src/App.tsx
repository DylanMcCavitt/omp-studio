import type { ComponentType } from "react";
import { Layout } from "@/components/Layout";
import { useAppStore, type Route } from "@/store/app";
import Dashboard from "@/views/Dashboard";
import Chat from "@/views/Chat";
import Sessions from "@/views/Sessions";
import Skills from "@/views/Skills";
import Mcp from "@/views/Mcp";
import Agents from "@/views/Agents";
import GitHub from "@/views/GitHub";
import Settings from "@/views/Settings";

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
  const View = VIEWS[route];
  return (
    <Layout>
      <View />
    </Layout>
  );
}

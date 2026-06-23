import {
  Bot,
  Github,
  Globe,
  History,
  LayoutDashboard,
  type LucideIcon,
  MessagesSquare,
  Plug,
  Settings,
  Sparkles,
  SquareKanban,
  Terminal as TerminalIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import type { Route } from "@/store/app";
import Agents from "@/views/Agents";
import Browser from "@/views/Browser";
import Chat from "@/views/Chat";
import Dashboard from "@/views/Dashboard";
import GitHub from "@/views/GitHub";
import Linear from "@/views/Linear";
import Mcp from "@/views/Mcp";
import Sessions from "@/views/Sessions";
import SettingsView from "@/views/Settings";
import Skills from "@/views/Skills";
import Terminal from "@/views/Terminal";

/** Sidebar section a destination belongs to; rendered in `NAV_GROUP_ORDER`. */
export type NavGroup = "core" | "tools" | "integrations";

/**
 * One navigation destination: its route key, sidebar presentation (label / icon
 * / group) and the view the shell mounts for it. This triple used to be spread
 * across three hot files — `Sidebar.tsx` (`NAV`), `App.tsx` (`VIEWS`) and the
 * `Route` union in `store/app.ts`. Collapsing it here (D2) makes adding a view a
 * single registry entry instead of three parallel array edits that keep drifting.
 */
export interface NavEntry {
  route: Route;
  label: string;
  icon: LucideIcon;
  view: ComponentType;
  group?: NavGroup;
  /**
   * A primary surface that lives in the left/center (not the right icon rail).
   * `chat` is the only primary destination — it's reached from the sidebar's
   * New chat / session list, never the rail. Everything else is `railable`.
   */
  primary?: boolean;
}

/** The order sidebar groups are rendered in. */
export const NAV_GROUP_ORDER: readonly NavGroup[] = [
  "core",
  "tools",
  "integrations",
];

/**
 * Source of truth for every destination, keyed by route. The `satisfies
 * Record<Route, …>` is the coverage assert: omit a `Route` (or add a key that
 * isn't one) and this stops compiling, so the union in `store/app.ts` and this
 * registry can never silently diverge. `NAV_ENTRIES` is derived in key order.
 */
const NAV_REGISTRY = {
  dashboard: {
    label: "Dashboard",
    icon: LayoutDashboard,
    view: Dashboard,
    group: "core",
  },
  chat: {
    label: "Chat",
    icon: MessagesSquare,
    view: Chat,
    group: "core",
    primary: true,
  },
  sessions: { label: "Sessions", icon: History, view: Sessions, group: "core" },
  skills: { label: "Skills", icon: Sparkles, view: Skills, group: "tools" },
  mcp: { label: "MCP", icon: Plug, view: Mcp, group: "tools" },
  agents: { label: "Agents", icon: Bot, view: Agents, group: "tools" },
  terminal: {
    label: "Terminal",
    icon: TerminalIcon,
    view: Terminal,
    group: "tools",
  },
  browser: { label: "Browser", icon: Globe, view: Browser, group: "tools" },
  github: {
    label: "GitHub",
    icon: Github,
    view: GitHub,
    group: "integrations",
  },
  linear: {
    label: "Linear",
    icon: SquareKanban,
    view: Linear,
    group: "integrations",
  },
  settings: {
    label: "Settings",
    icon: Settings,
    view: SettingsView,
    group: "integrations",
  },
} satisfies Record<Route, Omit<NavEntry, "route">>;

/** Every nav destination in display order (derived from `NAV_REGISTRY`). */
export const NAV_ENTRIES: readonly NavEntry[] = Object.entries(
  NAV_REGISTRY,
).map(([route, def]) => ({ route: route as Route, ...def }));

/**
 * The destinations shown in the right icon rail. Chat is the primary center
 * surface, and Sessions stays panel-renderable for existing history/deep links
 * without occupying one of the nine v3 rail icons.
 */
export const RAIL_ENTRIES: readonly NavEntry[] = NAV_ENTRIES.filter(
  (e) => !e.primary && e.route !== "sessions",
);

/** Panel entries keyed by route — a small static lookup for the panel host. */
const PANEL_ENTRY_BY_ROUTE: Partial<Record<Route, NavEntry>> =
  Object.fromEntries(
    NAV_ENTRIES.filter((e) => !e.primary).map((e) => [e.route, e]),
  );

/** The panel entry for `route`, or undefined when it is not panel-renderable. */
export function railEntry(route: Route): NavEntry | undefined {
  return PANEL_ENTRY_BY_ROUTE[route];
}

/** Whether `route` can render in the right-side docked panel host. */
export function isRailRoute(route: Route): boolean {
  return PANEL_ENTRY_BY_ROUTE[route] !== undefined;
}

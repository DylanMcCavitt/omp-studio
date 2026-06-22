import {
  Bot,
  Github,
  History,
  LayoutDashboard,
  type LucideIcon,
  MessagesSquare,
  Plug,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { type Route, useAppStore } from "@/store/app";
import { useChatStore } from "@/store/chat";

interface NavItem {
  route: Route;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { route: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { route: "chat", label: "Chat", icon: MessagesSquare },
  { route: "sessions", label: "Sessions", icon: History },
  { route: "skills", label: "Skills", icon: Sparkles },
  { route: "mcp", label: "MCP", icon: Plug },
  { route: "agents", label: "Agents", icon: Bot },
  { route: "github", label: "GitHub", icon: Github },
  { route: "settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const route = useAppStore((s) => s.route);
  const setRoute = useAppStore((s) => s.setRoute);
  const newChat = useChatStore((s) => s.newChat);

  return (
    <nav className="no-drag flex w-60 shrink-0 flex-col border-r border-border bg-bg-raised">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-bg shadow-glow">
          ω
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-ink">OMP Studio</span>
          <span className="text-xs text-ink-faint">Oh My Pi cockpit</span>
        </div>
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={newChat}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg transition-colors",
            "hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          )}
        >
          <Plus size={16} />
          New chat
        </button>
      </div>

      <div className="scrollbar flex-1 overflow-y-auto px-2 py-2">
        <ul className="flex flex-col gap-0.5">
          {NAV.map(({ route: r, label, icon: Icon }) => {
            const active = route === r;
            return (
              <li key={r}>
                <button
                  type="button"
                  onClick={() => setRoute(r)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-ink-muted hover:bg-bg-hover hover:text-ink",
                  )}
                >
                  <Icon size={17} className="shrink-0" />
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-border-subtle px-4 py-3">
        <span className="text-xs text-ink-faint">omp harness</span>
      </div>
    </nav>
  );
}

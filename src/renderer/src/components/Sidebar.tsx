// The workspace-centric left sidebar (AGE-632/634). Top to bottom: the workspace
// switcher, a segmented Chats | Files toggle, then the active surface. Chats =
// a New chat action + the live/hibernated session list (selecting a row opens
// it in the center). Files = the workspace file tree (AGE-634), whose file
// clicks open a center editor tab. The flat nav list that used to live here
// moved to the right icon rail (AGE-630).

import {
  FileText,
  type LucideIcon,
  MessageSquare,
  MessageSquarePlus,
} from "lucide-react";
import { ChatPanelDock } from "@/components/chat/ChatPanelDock";
import { SessionList } from "@/components/chat/SessionList";
import { FileTree } from "@/components/files/FileTree";
import { Button } from "@/components/ui";
import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";
import { cn } from "@/lib/cn";
import { useChatStore } from "@/store/chat";
import { type SidebarMode, useShellStore } from "@/store/shell";

export function Sidebar() {
  const newChat = useChatStore((s) => s.newChat);
  const mode = useShellStore((s) => s.sidebarMode);
  const setMode = useShellStore((s) => s.setSidebarMode);

  return (
    <nav className="no-drag flex h-full w-full min-w-0 flex-col border-r border-border bg-bg-raised">
      <div className="flex items-center gap-2.5 px-3 pb-3 pt-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-bold text-bg shadow-glow">
          ω
        </div>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold text-ink">
            OMP Studio
          </span>
          <span className="truncate text-xs text-ink-faint">
            Oh My Pi cockpit
          </span>
        </div>
      </div>

      <div className="px-3 pb-3">
        <WorkspaceSwitcher />
      </div>

      <div className="px-3 pb-2">
        <SidebarModeToggle mode={mode} onChange={setMode} />
      </div>

      {mode === "chats" ? <ChatsPane onNewChat={newChat} /> : <FileTree />}

      <ChatPanelDock />

      <div className="border-t border-border-subtle px-3 py-3">
        <span className="text-xs text-ink-faint">omp harness</span>
      </div>
    </nav>
  );
}

const MODES: { id: SidebarMode; label: string; icon: LucideIcon }[] = [
  { id: "chats", label: "Chats", icon: MessageSquare },
  { id: "files", label: "Files", icon: FileText },
];

function SidebarModeToggle({
  mode,
  onChange,
}: {
  mode: SidebarMode;
  onChange: (mode: SidebarMode) => void;
}) {
  return (
    <div className="flex min-w-0 gap-1 rounded-lg bg-bg-panel p-1">
      {MODES.map(({ id, label, icon: Icon }) => {
        const active = id === mode;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(id)}
            className={cn(
              "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              active
                ? "bg-bg-raised text-ink shadow-sm"
                : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon size={14} className="shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ChatsPane({ onNewChat }: { onNewChat: () => void }) {
  return (
    <>
      <div className="px-3 pb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onNewChat}
          className="w-full"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New chat
        </Button>
      </div>
      <SessionList />
    </>
  );
}

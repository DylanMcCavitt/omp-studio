// The workspace-centric left sidebar (AGE-632/634, minimal pass AGE-807). Top
// to bottom: the workspace context block (the switcher trigger — repo, branch,
// worktree; app branding lives in the titlebar, not here), one slim tool row
// (Chats | Files toggle + New chat), then the active surface. Chats = the
// session list grouped by workspace (every project with open or hibernated
// sessions is visible — AGE-807); Files = the workspace file tree (AGE-634).
// The panel dock collapses to a one-line counter strip at the bottom.

import {
  FileText,
  type LucideIcon,
  MessageSquare,
  MessageSquarePlus,
} from "lucide-react";
import { ChatPanelDock } from "@/components/chat/ChatPanelDock";
import { SessionList } from "@/components/chat/SessionList";
import { FileTree } from "@/components/files/FileTree";
import { IconButton } from "@/components/ui";
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
      <div className="px-3 pb-2 pt-2">
        <WorkspaceSwitcher />
      </div>

      <div className="flex items-center gap-2 px-3 pb-2">
        <SidebarModeToggle mode={mode} onChange={setMode} />
        <IconButton
          label="New chat"
          onClick={newChat}
          className="ml-auto h-7 w-7"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </IconButton>
      </div>

      {mode === "chats" ? <SessionList /> : <FileTree />}

      <ChatPanelDock />
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

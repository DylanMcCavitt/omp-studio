import { Plus } from "lucide-react";
import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";
import { cn } from "@/lib/cn";
import { useChatStore } from "@/store/chat";

// The left sidebar is workspace-centric: the workspace switcher and a New chat
// action. The flat nav list that used to live here moved to the right icon rail
// (AGE-630); the session list + Chats/Files toggle land in the full rebuild
// (AGE-632). Until then the body is an empty spacer that keeps the footer pinned.
export function Sidebar() {
  const newChat = useChatStore((s) => s.newChat);

  return (
    <nav className="no-drag flex h-full w-full min-w-0 flex-col border-r border-border bg-bg-raised">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-2">
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

      <div className="flex-1" />

      <div className="border-t border-border-subtle px-4 py-3">
        <span className="text-xs text-ink-faint">omp harness</span>
      </div>
    </nav>
  );
}

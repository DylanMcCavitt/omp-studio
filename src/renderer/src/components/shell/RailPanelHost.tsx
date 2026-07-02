// The expandable panel the right icon rail opens (AGE-630). `Layout` renders it
// in a fixed-width overlay sheet while a rail panel is open. It shows the active
// destination's header (label + close button) above that destination's view
// component, read straight from the nav registry — so the rail mounts the same
// view the old sidebar nav used to route to.
//
// Closing: the close button and Esc both collapse the rail. Esc is wired here
// (not in the global shortcut manager) so it stays local to the open panel, and
// it yields to any nested overlay (Menu/Popover/Dialog) that already consumed
// the keypress via `preventDefault`.

import { X } from "lucide-react";
import { useEffect } from "react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { IconButton } from "@/components/ui";
import { railEntry } from "@/lib/nav-registry";
import type { Route } from "@/store/app";
import { useShellStore } from "@/store/shell";

export function RailPanelHost({ openPanelId }: { openPanelId: Route }) {
  const closePanel = useShellStore((s) => s.closePanel);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Yield to a nested overlay (Menu/Popover/Dialog) that already handled Esc.
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        closePanel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePanel]);

  const entry = railEntry(openPanelId);
  if (!entry) return null;
  const { view: View, label } = entry;

  return (
    <aside
      aria-label={`${label} panel`}
      className="flex h-full min-h-0 w-full flex-col bg-bg"
    >
      <header className="flex h-9 shrink-0 items-center justify-end border-b border-border-subtle px-2">
        <IconButton
          label={`Close ${label}`}
          onClick={closePanel}
          className="h-7 w-7"
        >
          <X className="h-4 w-4" />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* Isolate a crash in a rail destination view so it can't blank the
            whole app (the old center had this; restore it for railed views). */}
        <AppErrorBoundary resetKey={openPanelId} onReset={closePanel}>
          <View />
        </AppErrorBoundary>
      </div>
    </aside>
  );
}

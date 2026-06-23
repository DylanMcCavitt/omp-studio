import type { ReactNode } from "react";
import { PanelGroup, Panel as ResizablePanel } from "react-resizable-panels";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { usePersistedPanelLayout } from "@/components/layout/usePersistedPanelLayout";
import { Toaster } from "@/components/ui";
import {
  DEFAULT_SIDEBAR_WIDTH_PCT,
  roundPct,
  SIDEBAR_MAX_PCT,
  SIDEBAR_MIN_PCT,
} from "@/lib/layout";
import { useSettingsStore } from "@/store/settings";
import { Sidebar } from "./Sidebar";

export interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  // Remount the split exactly once when settings finish loading so the resizable
  // panels capture the persisted widths (defaultSize is mount-only). Before that
  // the shell renders with default widths — fine, no interaction has happened.
  const settingsLoaded = useSettingsStore((s) => s.settings != null);
  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <header className="titlebar flex h-7 shrink-0 items-center border-b border-border-subtle bg-bg-raised pl-[72px]">
        <span className="flex-1 text-center text-xs font-medium text-ink-faint">
          OMP Studio
        </span>
        <span className="w-[72px]" />
      </header>
      <ShellSplit key={settingsLoaded ? "ready" : "boot"}>
        {children}
      </ShellSplit>
      <Toaster />
    </div>
  );
}

function ShellSplit({ children }: { children: ReactNode }) {
  const { initialLayout, groupRef, onLayout, reset } = usePersistedPanelLayout({
    defaultLayout: [DEFAULT_SIDEBAR_WIDTH_PCT, 100 - DEFAULT_SIDEBAR_WIDTH_PCT],
    read: (l) =>
      l.sidebarWidthPct != null
        ? [l.sidebarWidthPct, 100 - l.sidebarWidthPct]
        : undefined,
    toPatch: ([sidebar = DEFAULT_SIDEBAR_WIDTH_PCT]) => ({
      sidebarWidthPct: roundPct(sidebar),
    }),
  });

  return (
    <PanelGroup
      ref={groupRef}
      direction="horizontal"
      onLayout={onLayout}
      className="flex min-h-0 flex-1"
    >
      <ResizablePanel
        order={1}
        defaultSize={initialLayout[0]}
        minSize={SIDEBAR_MIN_PCT}
        maxSize={SIDEBAR_MAX_PCT}
        className="flex min-h-0"
      >
        <Sidebar />
      </ResizablePanel>
      <ResizeHandle ariaLabel="Resize sidebar" onReset={reset} />
      <ResizablePanel
        order={2}
        defaultSize={initialLayout[1]}
        className="flex min-h-0"
      >
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </ResizablePanel>
    </PanelGroup>
  );
}

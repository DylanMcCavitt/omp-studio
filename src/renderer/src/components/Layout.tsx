import type { LayoutSettings } from "@shared/ipc";
import { type ReactNode, useEffect, useRef } from "react";
import { PanelGroup, Panel as ResizablePanel } from "react-resizable-panels";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { usePersistedPanelLayout } from "@/components/layout/usePersistedPanelLayout";
import { RailPanelHost } from "@/components/shell/RailPanelHost";
import { RightRail } from "@/components/shell/RightRail";
import { Toaster } from "@/components/ui";
import {
  DEFAULT_RIGHT_PANEL_WIDTH_PCT,
  DEFAULT_SIDEBAR_WIDTH_PCT,
  MAIN_MIN_PCT,
  RIGHT_PANEL_MAX_PCT,
  RIGHT_PANEL_MIN_PCT,
  roundPct,
  SIDEBAR_MAX_PCT,
  SIDEBAR_MIN_PCT,
} from "@/lib/layout";
import { isRailRoute } from "@/lib/nav-registry";
import type { Route } from "@/store/app";
import { useSettingsStore } from "@/store/settings";
import { useShellStore } from "@/store/shell";
import { Sidebar } from "./Sidebar";

export interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  // Remount the split exactly once when settings finish loading so the resizable
  // panels capture the persisted widths (defaultSize is mount-only). Before that
  // the shell renders with default widths — fine, no interaction has happened.
  const settingsLoaded = useSettingsStore((s) => s.settings != null);
  const openPanelId = useShellStore((s) => s.openPanelId);
  const hydrate = useShellStore((s) => s.hydrate);
  const panelOpen = openPanelId != null && isRailRoute(openPanelId);

  // Restore the persisted open rail panel once, after settings finish loading.
  // Guarded so a panel the user opened during boot is never clobbered.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !settingsLoaded) return;
    hydratedRef.current = true;
    if (useShellStore.getState().openPanelId != null) return;
    const persisted =
      useSettingsStore.getState().settings?.layout?.rightPanelId;
    if (persisted && isRailRoute(persisted as Route))
      hydrate(persisted as Route);
  }, [settingsLoaded, hydrate]);

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <header className="titlebar flex h-7 shrink-0 items-center border-b border-border-subtle bg-bg-raised pl-[72px]">
        <span className="flex-1 text-center text-xs font-medium text-ink-faint">
          OMP Studio
        </span>
        <span className="w-[72px]" />
      </header>
      <div className="flex min-h-0 flex-1">
        <ShellSplit
          key={`${settingsLoaded ? "ready" : "boot"}:${panelOpen ? "panel" : "nopanel"}`}
          openPanelId={panelOpen ? openPanelId : null}
        >
          {children}
        </ShellSplit>
        <RightRail />
      </div>
      <Toaster />
    </div>
  );
}

function ShellSplit({
  openPanelId,
  children,
}: {
  openPanelId: Route | null;
  children: ReactNode;
}) {
  // When a rail panel is open the split has a third (right) panel; otherwise it
  // is the classic sidebar | main pair. The parent keys this component on open
  // state so we remount and re-capture the persisted sizes for the active shape.
  const open = openPanelId != null;
  const { initialLayout, groupRef, onLayout, reset } = usePersistedPanelLayout({
    defaultLayout: open
      ? [
          DEFAULT_SIDEBAR_WIDTH_PCT,
          100 - DEFAULT_SIDEBAR_WIDTH_PCT - DEFAULT_RIGHT_PANEL_WIDTH_PCT,
          DEFAULT_RIGHT_PANEL_WIDTH_PCT,
        ]
      : [DEFAULT_SIDEBAR_WIDTH_PCT, 100 - DEFAULT_SIDEBAR_WIDTH_PCT],
    read: (l) => {
      if (open) {
        const sidebar = l.sidebarWidthPct ?? DEFAULT_SIDEBAR_WIDTH_PCT;
        const right = l.rightPanelWidthPct ?? DEFAULT_RIGHT_PANEL_WIDTH_PCT;
        return [sidebar, 100 - sidebar - right, right];
      }
      return l.sidebarWidthPct != null
        ? [l.sidebarWidthPct, 100 - l.sidebarWidthPct]
        : undefined;
    },
    toPatch: (layout) => {
      const patch: Partial<LayoutSettings> = {
        sidebarWidthPct: roundPct(layout[0] ?? DEFAULT_SIDEBAR_WIDTH_PCT),
      };
      if (open && layout.length === 3) {
        patch.rightPanelWidthPct = roundPct(
          layout[2] ?? DEFAULT_RIGHT_PANEL_WIDTH_PCT,
        );
      }
      return patch;
    },
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
        minSize={MAIN_MIN_PCT}
        className="flex min-h-0"
      >
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </ResizablePanel>
      {openPanelId != null && (
        <>
          <ResizeHandle ariaLabel="Resize tool panel" onReset={reset} />
          <ResizablePanel
            order={3}
            defaultSize={initialLayout[2]}
            minSize={RIGHT_PANEL_MIN_PCT}
            maxSize={RIGHT_PANEL_MAX_PCT}
            className="flex min-h-0"
          >
            <RailPanelHost openPanelId={openPanelId} />
          </ResizablePanel>
        </>
      )}
    </PanelGroup>
  );
}

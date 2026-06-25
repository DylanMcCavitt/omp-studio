import type { LayoutSettings } from "@shared/ipc";
import { Moon, Sun } from "lucide-react";
import { type ReactNode, useEffect, useRef, useSyncExternalStore } from "react";
import { PanelGroup, Panel as ResizablePanel } from "react-resizable-panels";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { usePersistedPanelLayout } from "@/components/layout/usePersistedPanelLayout";
import { RailPanelHost } from "@/components/shell/RailPanelHost";
import { RightRail } from "@/components/shell/RightRail";
import { Toaster } from "@/components/ui";
import { WorkspaceColorDot } from "@/components/workspace/WorkspaceColor";
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
import { PREFERS_DARK_QUERY, resolveTheme } from "@/lib/theme";
import { projectLabel } from "@/lib/workspaces";
import { type Route, useAppStore } from "@/store/app";
import { useActiveSession } from "@/store/chat";
import { sessionStatus } from "@/store/session-reducer";
import { useSettingsStore } from "@/store/settings";
import { useShellStore } from "@/store/shell";
import { useUiStore } from "@/store/ui";
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
  // Ambient location for the titlebar: the active workspace's Live Dot + label
  // (falls back to its path basename, then the product name) instead of a dead
  // brand label.
  const selectedProject = useAppStore((s) => s.selectedProject);
  const workspaces = useSettingsStore((s) => s.settings?.workspaces);
  const themeMode = useSettingsStore((s) => s.settings?.theme ?? "system");
  const updateSettings = useSettingsStore((s) => s.update);
  const openNavPalette = useUiStore((s) => s.openNavPalette);
  const activeSessionStatus = useActiveSession((s) =>
    s ? sessionStatus({ live: true, status: s.status }) : undefined,
  );
  const prefersDark = usePrefersDark();
  const titleWorkspace = selectedProject
    ? workspaces?.find((w) => w.cwd === selectedProject)
    : undefined;
  const titleLabel = titleWorkspace
    ? titleWorkspace.label
    : selectedProject
      ? projectLabel(selectedProject)
      : "OMP Studio";
  const resolvedTheme = resolveTheme(themeMode, prefersDark);
  const switchToTheme = resolvedTheme === "dark" ? "light" : "dark";
  const switchTheme = () => void updateSettings({ theme: switchToTheme });

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
      <header className="titlebar relative flex h-7 shrink-0 items-center border-b border-border-subtle bg-bg-raised pl-[72px]">
        <span className="pointer-events-none absolute inset-x-[72px] top-0 flex h-full items-center justify-center gap-1.5 truncate px-3 text-center text-xs font-medium text-ink-muted">
          {selectedProject && (
            <WorkspaceColorDot
              color={titleWorkspace?.color}
              status={activeSessionStatus}
              size={8}
            />
          )}
          <span className="truncate">{titleLabel}</span>
        </span>
        <div className="no-drag ml-auto flex h-full items-center gap-1 pr-2">
          <button
            type="button"
            aria-label="Open navigation palette"
            onClick={openNavPalette}
            className="flex h-5 items-center rounded-full border border-border px-2 font-mono text-[11px] leading-none text-ink-muted transition-colors hover:border-border-strong hover:bg-bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            ⌘K
          </button>
          <button
            type="button"
            aria-label={`Switch to ${switchToTheme} theme`}
            onClick={switchTheme}
            disabled={!settingsLoaded}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-ink-muted transition-colors hover:border-border-strong hover:bg-bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-3 w-3" />
            ) : (
              <Moon className="h-3 w-3" />
            )}
          </button>
        </div>
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

function usePrefersDark(): boolean {
  return useSyncExternalStore(
    subscribePrefersDark,
    getPrefersDarkSnapshot,
    () => false,
  );
}

function subscribePrefersDark(onChange: () => void): () => void {
  const media = window.matchMedia(PREFERS_DARK_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getPrefersDarkSnapshot(): boolean {
  return window.matchMedia(PREFERS_DARK_QUERY).matches;
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
        className="flex min-h-0 min-w-0 overflow-hidden"
      >
        <Sidebar />
      </ResizablePanel>
      <ResizeHandle ariaLabel="Resize sidebar" onReset={reset} />
      <ResizablePanel
        order={2}
        defaultSize={initialLayout[1]}
        minSize={MAIN_MIN_PCT}
        className="flex min-h-0 min-w-0"
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
            className="flex min-h-0 min-w-0 overflow-hidden"
          >
            <RailPanelHost openPanelId={openPanelId} />
          </ResizablePanel>
        </>
      )}
    </PanelGroup>
  );
}

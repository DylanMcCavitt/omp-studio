import type { LayoutSettings } from "@shared/ipc";
import { Moon, PanelLeftOpen, Sun } from "lucide-react";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type ImperativePanelHandle,
  PanelGroup,
  Panel as ResizablePanel,
} from "react-resizable-panels";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { usePersistedPanelLayout } from "@/components/layout/usePersistedPanelLayout";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { RailPanelHost } from "@/components/shell/RailPanelHost";
import { RightRail } from "@/components/shell/RightRail";
import { Toaster } from "@/components/ui";
import { WorkspaceColorDot } from "@/components/workspace/WorkspaceColor";
import {
  clampRightPanelWidthPx,
  DEFAULT_SIDEBAR_WIDTH_PCT,
  defaultRightPanelWidthPx,
  MAIN_MIN_PCT,
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
  const settingsModalOpen = useShellStore((s) => s.settingsModalOpen);
  const closeSettingsModal = useShellStore((s) => s.closeSettingsModal);
  const hydrate = useShellStore((s) => s.hydrate);
  const panelOpen = openPanelId != null && isRailRoute(openPanelId);
  const shellRef = useRef<HTMLDivElement>(null);
  const viewportWidth = useMeasuredWidth(shellRef);
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
      <div ref={shellRef} className="relative flex min-h-0 flex-1">
        <ShellSplit key={settingsLoaded ? "ready" : "boot"}>
          {children}
        </ShellSplit>
        {panelOpen && (
          <RightPanelOverlay
            openPanelId={openPanelId}
            viewportWidth={viewportWidth}
          />
        )}
        <RightRail />
        {settingsModalOpen && <SettingsDialog onClose={closeSettingsModal} />}
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

function ShellSplit({ children }: { children: ReactNode }) {
  // The shell split is always the stable sidebar | main pair. Right-rail panels
  // render as an overlay sheet so opening/closing tools never remounts or
  // resizes the center subtree.
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const setLayout = useSettingsStore((s) => s.setLayout);
  const setSidebarToggleHandler = useShellStore(
    (s) => s.setSidebarToggleHandler,
  );
  const toggleSidebar = useShellStore((s) => s.toggleSidebar);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () =>
      useSettingsStore.getState().settings?.layout?.sidebarCollapsed === true,
  );
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  const persistedSidebarWidth =
    useSettingsStore.getState().settings?.layout?.sidebarWidthPct ??
    DEFAULT_SIDEBAR_WIDTH_PCT;
  const restoreSidebarWidth = () => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    panel.expand();
    if (panel.getSize() <= 0) panel.resize(persistedSidebarWidth);
  };
  const persistSidebarCollapsed = (collapsed: boolean) => {
    sidebarCollapsedRef.current = collapsed;
    setSidebarCollapsed(collapsed);
    setLayout({ sidebarCollapsed: collapsed });
  };
  const toggleSidebarCollapsed = () => {
    const panel = sidebarPanelRef.current;
    const nextCollapsed = !(
      panel?.isCollapsed() ?? sidebarCollapsedRef.current
    );
    if (nextCollapsed) {
      panel?.collapse();
    } else {
      restoreSidebarWidth();
    }
    persistSidebarCollapsed(nextCollapsed);
  };
  useEffect(() => {
    setSidebarToggleHandler(toggleSidebarCollapsed);
    return () => setSidebarToggleHandler(null);
  }, [setSidebarToggleHandler, toggleSidebarCollapsed]);
  const { initialLayout, groupRef, onLayout, reset } = usePersistedPanelLayout({
    defaultLayout: [DEFAULT_SIDEBAR_WIDTH_PCT, 100 - DEFAULT_SIDEBAR_WIDTH_PCT],
    read: (l) =>
      l.sidebarCollapsed
        ? [0, 100]
        : l.sidebarWidthPct != null
          ? [l.sidebarWidthPct, 100 - l.sidebarWidthPct]
          : undefined,
    toPatch: (layout) => {
      const sidebarWidthPct = roundPct(layout[0] ?? DEFAULT_SIDEBAR_WIDTH_PCT);
      return sidebarWidthPct <= 0
        ? { sidebarCollapsed: true }
        : { sidebarWidthPct };
    },
  });

  return (
    <div className="relative flex min-h-0 flex-1">
      <PanelGroup
        ref={groupRef}
        direction="horizontal"
        onLayout={onLayout}
        className="flex min-h-0 flex-1"
      >
        <ResizablePanel
          id="sidebar"
          ref={sidebarPanelRef}
          order={1}
          defaultSize={initialLayout[0]}
          minSize={SIDEBAR_MIN_PCT}
          maxSize={SIDEBAR_MAX_PCT}
          collapsible
          collapsedSize={0}
          onCollapse={() => persistSidebarCollapsed(true)}
          onExpand={() => persistSidebarCollapsed(false)}
          className="flex min-h-0 min-w-0 overflow-hidden"
        >
          {/* Unmount content while collapsed: the zero-width panel clips
              visually (overflow-hidden) but scrollWidth would still report
              the content, reading as horizontal overflow. */}
          {sidebarCollapsed ? null : (
            <Sidebar onToggleSidebar={toggleSidebar} />
          )}
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
      </PanelGroup>
      {sidebarCollapsed && (
        <button
          type="button"
          aria-label="Expand sidebar"
          onClick={toggleSidebar}
          className="no-drag absolute left-1 top-2 z-20 flex h-8 w-6 items-center justify-center rounded-md border border-border bg-bg-raised text-ink-muted shadow-sm transition-colors hover:bg-bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function useMeasuredWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );

  useEffect(() => {
    const measure = () => {
      setWidth(
        Math.round(
          ref.current?.getBoundingClientRect().width ?? window.innerWidth,
        ),
      );
    };
    measure();

    const ResizeObserverCtor =
      typeof ResizeObserver === "undefined" ? undefined : ResizeObserver;
    const observer = ResizeObserverCtor
      ? new ResizeObserverCtor(measure)
      : null;
    if (ref.current && observer) observer.observe(ref.current);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref]);

  return width;
}

function RightPanelOverlay({
  openPanelId,
  viewportWidth,
}: {
  openPanelId: Route;
  viewportWidth: number;
}) {
  const layout = useSettingsStore((s) => s.settings?.layout);
  const setLayout = useSettingsStore((s) => s.setLayout);
  const desiredWidth = useMemo(() => {
    const stored = layout?.rightPanelWidthsPx?.[openPanelId];
    if (typeof stored === "number" && Number.isFinite(stored) && stored > 0) {
      return stored;
    }
    const legacy = layout?.rightPanelWidthPct;
    if (typeof legacy === "number" && Number.isFinite(legacy) && legacy > 0) {
      return (viewportWidth * legacy) / 100;
    }
    return defaultRightPanelWidthPx(openPanelId);
  }, [layout, openPanelId, viewportWidth]);
  const clampedWidth = useMemo(
    () => clampRightPanelWidthPx(desiredWidth, viewportWidth),
    [desiredWidth, viewportWidth],
  );
  const [width, setWidth] = useState(clampedWidth);

  useEffect(() => setWidth(clampedWidth), [clampedWidth]);

  const persistWidth = (next: number) => {
    const current =
      useSettingsStore.getState().settings?.layout?.rightPanelWidthsPx ?? {};
    const patch: Partial<LayoutSettings> = {
      rightPanelWidthsPx: { ...current, [openPanelId]: next },
    };
    setLayout(patch);
  };

  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = width;
    handle.setPointerCapture(pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const next = clampRightPanelWidthPx(
        startWidth - (moveEvent.clientX - startX),
        viewportWidth,
      );
      setWidth(next);
      persistWidth(next);
    };
    const onPointerUp = () => {
      handle.releasePointerCapture(pointerId);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerUp);
    };

    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerUp);
  };

  return (
    <div
      className="absolute inset-y-0 right-12 z-30 flex min-h-0 overflow-hidden border-l border-border bg-bg shadow-2xl"
      style={{ width }}
    >
      {/* Pointer-only drag affordance (same convention as pane drag grips); Esc/rail toggle remain the keyboard path. */}
      <div
        aria-hidden="true"
        data-testid="overlay-resize-handle"
        className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize touch-none bg-transparent hover:bg-accent/20"
        onPointerDown={onResizeStart}
      />
      <RailPanelHost openPanelId={openPanelId} />
    </div>
  );
}

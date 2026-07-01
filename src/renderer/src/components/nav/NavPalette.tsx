// AGE-700 — the ⌘K navigation palette: a centered overlay that jumps between
// workspaces and recent sessions, each row led by a Live Dot. A distinct surface
// from the slash-command palette (commands) and the global search (full-text);
// it reuses the shared overlay/focus-trap/keyboard primitives. The open flag
// lives in the ui store so the single shortcut manager (useShortcuts) drives it.
//
// Selecting a workspace points new chats at its cwd (same effect as the
// switcher); selecting a session opens it in the center (resuming a hibernated
// one). ↑/↓ move a single selection across both groups, Enter/click jumps, Esc
// closes.

import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceColorDot } from "@/components/workspace/WorkspaceColor";
import { cn } from "@/lib/cn";
import {
  filterSessionItems,
  filterWorkspaceItems,
  type NavItem,
  sessionNavItems,
  workspaceNavItems,
} from "@/lib/nav-palette";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { useAppStore } from "@/store/app";
import { useChatStore } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";
import { useUiStore } from "@/store/ui";

function NavPaletteOverlay({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useFocusTrap<HTMLDivElement>();
  const listRef = useRef<HTMLDivElement>(null);

  const workspaces = useSettingsStore((s) => s.settings?.workspaces);
  const recordWorkspace = useSettingsStore((s) => s.recordWorkspace);
  const selectedProject = useAppStore((s) => s.selectedProject);
  const setSelectedProject = useAppStore((s) => s.setSelectedProject);
  const openSessions = useChatStore((s) => s.sessionSummaries);
  const hibernatedSessions = useChatStore((s) => s.hibernatedSessions);
  const openChat = useChatStore((s) => s.openChat);
  const resumeSession = useChatStore((s) => s.resumeSession);

  const workspaceItems = useMemo(
    () =>
      filterWorkspaceItems(
        workspaceNavItems(workspaces, selectedProject),
        query,
      ),
    [workspaces, selectedProject, query],
  );
  const sessionItems = useMemo(
    () =>
      filterSessionItems(
        sessionNavItems(openSessions, hibernatedSessions, workspaces),
        query,
      ),
    [openSessions, hibernatedSessions, workspaces, query],
  );

  // One flat ordered list (workspaces, then sessions) backs up/down selection
  // and the Enter target; each rendered row's data-index is its position here.
  const flat = useMemo<NavItem[]>(
    () => [...workspaceItems, ...sessionItems],
    [workspaceItems, sessionItems],
  );

  // Reset the cursor to the top whenever the result set changes shape.
  useEffect(() => setActiveIndex(0), [query, flat.length]);
  const active = flat.length ? Math.min(activeIndex, flat.length - 1) : 0;

  // Keep the active row visible.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const activate = (item: NavItem) => {
    if (item.kind === "workspace") {
      setSelectedProject(item.cwd);
      void recordWorkspace(item.cwd);
    } else if (item.live) {
      openChat(item.id);
    } else {
      void resumeSession(item.id);
    }
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[active];
      if (item) activate(item);
    }
  };

  const empty = flat.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close navigation"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigate"
        data-nav-overlay
        tabIndex={-1}
        className="relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border-strong bg-bg-panel shadow-panel focus:outline-none"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-ink-faint" />
          <input
            data-autofocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a workspace or session…"
            aria-label="Filter workspaces and sessions"
            className="w-full bg-transparent py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </div>

        <div
          ref={listRef}
          role="listbox"
          aria-label="Workspaces and sessions"
          className="scrollbar min-h-0 flex-1 overflow-auto p-1.5"
        >
          {empty ? (
            <div className="px-3 py-8 text-center text-sm text-ink-faint">
              No matching workspaces or sessions
            </div>
          ) : (
            <>
              {workspaceItems.length > 0 && (
                <p
                  className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint"
                  aria-hidden="true"
                >
                  Workspaces
                </p>
              )}
              {workspaceItems.map((w, i) => (
                <NavRow
                  key={`ws:${w.id}`}
                  index={i}
                  active={i === active}
                  onActivate={() => activate(w)}
                  onHover={() => setActiveIndex(i)}
                  dot={<WorkspaceColorDot color={w.color} />}
                  title={w.label}
                  meta={w.cwd}
                  trailing={w.current ? "current" : undefined}
                />
              ))}

              {sessionItems.length > 0 && (
                <p
                  className="px-2.5 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint"
                  aria-hidden="true"
                >
                  Recent sessions
                </p>
              )}
              {sessionItems.map((s, i) => {
                const idx = workspaceItems.length + i;
                return (
                  <NavRow
                    key={`se:${s.id}`}
                    index={idx}
                    active={idx === active}
                    onActivate={() => activate(s)}
                    onHover={() => setActiveIndex(idx)}
                    dot={
                      <WorkspaceColorDot color={s.color} status={s.status} />
                    }
                    title={s.title}
                    meta={s.workspaceLabel}
                  />
                );
              })}
            </>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-xs text-ink-faint">
          <span className="flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" /> jump
          </span>
          <span>↑↓ navigate</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

function NavRow({
  index,
  active,
  onActivate,
  onHover,
  dot,
  title,
  meta,
  trailing,
}: {
  index: number;
  active: boolean;
  onActivate: () => void;
  onHover: () => void;
  dot: React.ReactNode;
  title: string;
  meta: string;
  trailing?: string;
}) {
  return (
    <button
      type="button"
      data-index={index}
      role="option"
      aria-selected={active}
      // Keep the input focused through the click so the focus trap's Tab cycle
      // and the autofocused search field stay intact while selecting.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onActivate}
      onMouseMove={onHover}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
        active ? "bg-bg-hover" : "hover:bg-bg-hover/60",
      )}
    >
      {dot}
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{title}</span>
      <span className="shrink-0 truncate font-mono text-xs text-ink-muted">
        {meta}
      </span>
      {trailing && (
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-faint">
          {trailing}
        </span>
      )}
    </button>
  );
}

/**
 * The ⌘K navigation palette. Always rendered from App; reads its open flag from
 * the ui store and mounts the overlay only while open so its query/selection
 * state resets on every open.
 */
export function NavPalette() {
  const open = useUiStore((s) => s.navPaletteOpen);
  const close = useUiStore((s) => s.closeNavPalette);
  if (!open) return null;
  return <NavPaletteOverlay onClose={close} />;
}

// The session list for the left sidebar's Chats surface (AGE-632). Lists every
// open session from the normalized store, surfaces each one's headline status
// (incl. the needs-approval / needs-input badge derived from its uiRequests
// queue), and lets the user switch between them (keeping all children alive) or
// close one (disposing that child only — transcript untouched). Selecting a row
// opens it in the center pane via the active-session wiring.
//
// Persisted-but-not-live sessions (restored on boot, D3r) render below the live
// rows as muted "hibernated" rows: clicking one resumes it (hydrating its
// transcript from JSONL), and a failed resume becomes a disabled error row with
// Retry / Remove affordances. The "New chat" action lives in the sidebar above
// this list, not in the list itself.

import type { OpenSessionDescriptor } from "@shared/ipc";
import { MessageSquarePlus, Moon, X } from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { SessionActionsMenu } from "@/components/session/SessionActionsMenu";
import { Badge, type BadgeVariant, EmptyState, Spinner } from "@/components/ui";
import { WorkspaceColorDot } from "@/components/workspace/WorkspaceColor";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { workspaceColorForCwd, workspaceColorValue } from "@/lib/workspaces";
import { type LiveSessionState, useChatStore } from "@/store/chat";
import {
  deriveSessionBadgeKind,
  type SessionBadgeKind,
  type SessionStatus,
  sessionStatus,
} from "@/store/session-reducer";
import { useSettingsStore } from "@/store/settings";

const BADGE: Record<
  SessionBadgeKind,
  { label: string; variant: BadgeVariant; spinner?: boolean }
> = {
  ready: { label: "Ready", variant: "success" },
  starting: { label: "Starting", variant: "warn" },
  streaming: { label: "Streaming", variant: "accent", spinner: true },
  compacting: { label: "Compacting", variant: "accent", spinner: true },
  "needs-approval": { label: "Needs approval", variant: "warn" },
  "needs-input": { label: "Needs input", variant: "warn" },
  error: { label: "Error", variant: "danger" },
  exited: { label: "Exited", variant: "muted" },
};

/** Headline status badge shared by the list rows and the active-pane header. */
export function SessionStatusBadge({
  status,
  uiRequests,
  isCompacting,
}: Pick<LiveSessionState, "status" | "uiRequests" | "isCompacting">) {
  const b = BADGE[deriveSessionBadgeKind({ status, uiRequests, isCompacting })];
  return (
    <Badge variant={b.variant}>
      {b.spinner ? (
        <span className="flex items-center gap-1.5">
          <Spinner size={12} />
          {b.label}
        </span>
      ) : (
        b.label
      )}
    </Badge>
  );
}

function basename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) || trimmed : trimmed;
}

function rowTitle(s: LiveSessionState): string {
  if (s.alias && s.alias.trim() !== "") return s.alias;
  if (s.sessionName && s.sessionName.trim() !== "") return s.sessionName;
  if (s.cwd) return basename(s.cwd);
  return "Untitled session";
}

function modelLabel(s: LiveSessionState): string {
  const m = s.model;
  if (!m) return "—";
  return m.name ?? `${m.provider}/${m.id}`;
}

/**
 * Confirm-then-close. Prompts before discarding a session that is mid-stream so
 * an in-flight turn is not killed accidentally; lives here (not in the store) so
 * the store stays side-effect-pure of window dialogs. Used by the list rows and
 * the workspace's Cmd+W shortcut.
 */
export function closeSessionWithConfirm(id: string): void {
  const store = useChatStore.getState();
  const session = store.openSessions[id];
  if (!session) return;
  if (
    session.status === "streaming" &&
    !window.confirm(
      `“${rowTitle(session)}” is still streaming. Close it anyway?`,
    )
  ) {
    return;
  }
  void store.closeSession(id);
}

/** Roving-tabindex props spread onto each list item's primary button. */
interface ListItemNav {
  "data-rail-item": string;
  tabIndex: number;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onFocus: () => void;
}

export function SessionList() {
  // Subscribe shallowly to the id lists so the list container re-renders only
  // when sessions open/close — each row subscribes to its own slice for live
  // status updates (including background, non-active sessions).
  const ids = useChatStore(useShallow((s) => Object.keys(s.openSessions)));
  const hibernatedIds = useChatStore(
    useShallow((s) => Object.keys(s.hibernatedSessions)),
  );
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const total = ids.length + hibernatedIds.length;

  // Roving tabindex: the list is one Tab stop and Up/Down move focus between
  // rows (Enter/Space activate via the native buttons). The ordered id list is
  // the live rows, then the hibernated rows.
  const listRef = useRef<HTMLElement>(null);
  const order = useMemo(() => [...ids, ...hibernatedIds], [ids, hibernatedIds]);
  const [rovingId, setRovingId] = useState<string>(activeSessionId ?? "");

  // Keep the tab stop valid as rows open/close; default it to the active session.
  useEffect(() => {
    setRovingId((cur) => {
      if (order.includes(cur)) return cur;
      if (activeSessionId && order.includes(activeSessionId))
        return activeSessionId;
      return order[0] ?? "";
    });
  }, [order, activeSessionId]);

  const focusItem = (id: string) => {
    setRovingId(id);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-rail-item="${CSS.escape(id)}"]`)
      ?.focus();
  };

  const onItemKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const currentId = e.currentTarget.getAttribute("data-rail-item");
    const idx = currentId ? order.indexOf(currentId) : -1;
    const current = idx >= 0 ? order[idx] : undefined;
    if (current === undefined) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(order[Math.min(idx + 1, order.length - 1)] ?? current);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(order[Math.max(idx - 1, 0)] ?? current);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(order[0] ?? current);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(order[order.length - 1] ?? current);
    }
  };

  const navProps = (id: string): ListItemNav => ({
    "data-rail-item": id,
    tabIndex: id === rovingId ? 0 : -1,
    onKeyDown: onItemKeyDown,
    onFocus: () => setRovingId(id),
  });

  return (
    <aside
      ref={listRef}
      aria-label="Sessions"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="scrollbar flex-1 space-y-1 overflow-y-auto px-3 pb-2">
        {total === 0 ? (
          <EmptyState
            icon={<MessageSquarePlus className="h-6 w-6" />}
            title="No open sessions"
            hint="Start a chat to spawn a session — it will appear here so you can switch between live agents."
          />
        ) : (
          <>
            {ids.map((id) => (
              <SessionListRow
                key={id}
                sessionId={id}
                active={id === activeSessionId}
                nav={navProps(id)}
              />
            ))}
            {hibernatedIds.length > 0 && (
              <p
                className="px-1 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint"
                aria-hidden="true"
              >
                Hibernated
              </p>
            )}
            {hibernatedIds.map((id) => (
              <HibernatedListRow key={id} sessionId={id} nav={navProps(id)} />
            ))}
          </>
        )}
      </div>
      {total > 0 && <SessionStatusLegend />}
    </aside>
  );
}

/**
 * One entry in the status legend: a Live Dot in a fixed neutral hue (slate) so
 * the fill — solid / hollow ring / faded — reads independently of any workspace
 * color, paired with its label.
 */
function LegendItem({
  status,
  label,
}: {
  status: SessionStatus;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <WorkspaceColorDot color="slate" status={status} pulse={false} />
      {label}
    </span>
  );
}

/**
 * Footer legend decoding the Live-Dot fills used across the session index:
 * live (solid) · idle (hollow ring) · done (faded).
 */
function SessionStatusLegend() {
  return (
    <fieldset
      aria-label="Session status legend"
      className="flex items-center gap-3 border-x-0 border-b-0 border-t border-border-subtle px-4 py-2 text-[9.5px] lowercase text-ink-faint"
    >
      <LegendItem status="running" label="live" />
      <LegendItem status="idle" label="idle" />
      <LegendItem status="done" label="done" />
    </fieldset>
  );
}

function SessionListRow({
  sessionId,
  active,
  nav,
}: {
  sessionId: string;
  active: boolean;
  nav: ListItemNav;
}) {
  const session = useChatStore((s) => s.openSessions[sessionId]);
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const patch = useChatStore((s) => s._patch);
  const workspaces = useSettingsStore((s) => s.settings?.workspaces);
  if (!session) return null;

  const percent = session.contextUsage
    ? Math.round(session.contextUsage.percent)
    : null;
  const color = workspaceColorForCwd(workspaces, session.cwd);
  const colorValue = workspaceColorValue(color);
  const status = sessionStatus({ live: true, status: session.status });
  // The 3-fill dot carries the normal lifecycle (running/idle); surface a text
  // badge for the states it cannot express — the user-blocking ones plus
  // exited/spawning, which would otherwise collapse into a plain idle row.
  const badgeKind = deriveSessionBadgeKind({
    status: session.status,
    uiRequests: session.uiRequests,
    isCompacting: session.isCompacting,
  });
  const showStatusBadge =
    badgeKind === "needs-approval" ||
    badgeKind === "needs-input" ||
    badgeKind === "error" ||
    badgeKind === "exited" ||
    badgeKind === "starting";
  // Title ramp encodes the live-row hierarchy directly: active = strong
  // (--t1/600), other inactive = muted (--t2/500). Hibernated rows carry the
  // done/faded ramp in HibernatedListRow.
  const titleRamp = active
    ? "text-ink font-semibold"
    : "text-ink-muted font-medium";

  return (
    <div className="group relative">
      <button
        type="button"
        {...nav}
        aria-current={active ? "true" : undefined}
        onClick={() => setActiveSession(sessionId)}
        className={cn(
          "flex w-full gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          active
            ? "border-border-subtle bg-bg-hover"
            : "border-transparent hover:border-border-subtle hover:bg-bg-hover",
        )}
      >
        <WorkspaceColorDot color={color} status={status} className="mt-1.5" />
        <span className="min-w-0 flex-1">
          <span className={cn("flex items-center pr-14 text-sm", titleRamp)}>
            <span className="truncate">{rowTitle(session)}</span>
          </span>

          <span className="mt-0.5 block truncate font-mono text-xs text-ink-muted">
            {modelLabel(session)}
          </span>

          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
            {status === "running" ? (
              <span
                className="font-mono lowercase"
                style={colorValue ? { color: colorValue } : undefined}
              >
                live
              </span>
            ) : (
              session.lastActivityAt > 0 && (
                <span className="font-mono">
                  {formatRelativeTime(session.lastActivityAt)}
                </span>
              )
            )}
            {showStatusBadge && (
              <SessionStatusBadge
                status={session.status}
                uiRequests={session.uiRequests}
                isCompacting={session.isCompacting}
              />
            )}
            {percent !== null && <span>{percent}% context</span>}
            {session.queuedCount > 0 && (
              <Badge variant="muted">{session.queuedCount} queued</Badge>
            )}
          </span>
        </span>
      </button>

      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <SessionActionsMenu
          triggerTabIndex={-1}
          target={{
            path: session.sessionFile,
            title: session.alias ?? session.sessionName ?? null,
            archived: false,
            liveSessionId: sessionId,
          }}
          onClose={() => closeSessionWithConfirm(sessionId)}
          onChanged={(r) => {
            if (r.kind === "renamed") {
              patch(sessionId, (s) => ({
                ...s,
                alias: r.title || undefined,
              }));
            }
          }}
          className="h-6 w-6"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close session"
          title="Close session (⌘W)"
          onClick={() => closeSessionWithConfirm(sessionId)}
          className="flex h-6 w-6 items-center justify-center rounded text-ink-faint hover:bg-bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function hibernatedTitle(descriptor: OpenSessionDescriptor): string {
  if (descriptor.title && descriptor.title.trim() !== "")
    return descriptor.title;
  if (descriptor.cwd) return basename(descriptor.cwd);
  return "Untitled session";
}

/**
 * A persisted-but-not-live session row. Muted styling distinguishes it from the
 * live rows; clicking it resumes (hydrating from JSONL). A failed resume renders
 * a disabled error row with Retry / Remove (Remove drops it from the open list).
 */
function HibernatedListRow({
  sessionId,
  nav,
}: {
  sessionId: string;
  nav: ListItemNav;
}) {
  const row = useChatStore((s) => s.hibernatedSessions[sessionId]);
  const resumeSession = useChatStore((s) => s.resumeSession);
  const removeHibernated = useChatStore((s) => s.removeHibernated);
  const workspaces = useSettingsStore((s) => s.settings?.workspaces);
  if (!row) return null;
  const { descriptor, resuming, error } = row;
  const title = hibernatedTitle(descriptor);
  const color = workspaceColorForCwd(workspaces, descriptor.cwd);

  if (error) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <span className="block truncate text-sm font-medium text-ink">
            {title}
          </span>
          <Badge variant="danger">Resume failed</Badge>
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-ink-muted" title={error}>
          {error}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            {...nav}
            onClick={() => void resumeSession(sessionId)}
            className="rounded px-2 py-1 text-xs font-medium text-accent hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Retry
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => void removeHibernated(sessionId)}
            className="rounded px-2 py-1 text-xs font-medium text-ink-muted hover:bg-bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative">
      <button
        type="button"
        {...nav}
        disabled={resuming}
        onClick={() => void resumeSession(sessionId)}
        title="Resume session"
        className={cn(
          "flex w-full gap-2.5 rounded-lg border border-transparent px-3 py-2 text-left opacity-80 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          resuming
            ? "cursor-default"
            : "hover:border-border-subtle hover:bg-bg-hover hover:opacity-100",
        )}
      >
        <WorkspaceColorDot color={color} status="done" className="mt-1.5" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 truncate pr-8 text-sm font-medium text-ink-muted">
            <Moon size={13} className="shrink-0 text-ink-faint" />
            <span className="truncate">{title}</span>
          </span>

          <span className="mt-0.5 block truncate font-mono text-xs text-ink-faint">
            {descriptor.model ?? "—"}
          </span>

          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
            {resuming ? (
              <Badge variant="accent">
                <span className="flex items-center gap-1.5">
                  <Spinner size={12} />
                  Resuming
                </span>
              </Badge>
            ) : (
              <Badge variant="muted">Hibernated</Badge>
            )}
            <span className="ml-auto font-mono text-ink-muted">
              {formatRelativeTime(descriptor.lastActiveAt)}
            </span>
          </span>
        </span>
      </button>

      {!resuming && (
        <div className="absolute right-1.5 top-1.5 flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Remove session from list"
            title="Remove from list"
            onClick={() => void removeHibernated(sessionId)}
            className="flex h-6 w-6 items-center justify-center rounded text-ink-faint hover:bg-bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

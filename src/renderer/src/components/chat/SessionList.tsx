// The session list for the left sidebar's Chats surface (AGE-632, grouped by
// workspace in AGE-807). Every workspace with at least one open or hibernated
// session renders as its own section — the selected workspace's group first and
// accent-marked, so all active projects are visible at once instead of hiding
// behind the switcher dropdown. Clicking a non-selected group's header points
// new chats at that workspace (same semantics as picking it in the switcher).
//
// Rows surface each session's headline status (incl. the needs-approval /
// needs-input badge derived from its uiRequests queue) and let the user switch
// between them (keeping all children alive) or close one (disposing that child
// only — transcript untouched). Persisted-but-not-live sessions render as muted
// "hibernated" rows inside their workspace group: clicking one resumes it, and
// a failed resume becomes a disabled error row with Retry / Remove affordances.
// The "New chat" action lives in the sidebar tool row above this list.

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
import {
  projectLabel,
  workspaceColorForCwd,
  workspaceColorValue,
} from "@/lib/workspaces";
import { useAppStore } from "@/store/app";
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

export function basename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) || trimmed : trimmed;
}

export function rowTitle(s: LiveSessionState): string {
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

/** One workspace section of the list: its identity plus member session ids. */
interface WorkspaceGroup {
  /** Grouping key — the members' cwd; "" collects sessions with no cwd. */
  cwd: string;
  label: string;
  liveIds: string[];
  hibernatedIds: string[];
}

/**
 * Group live + hibernated session ids by their workspace cwd. The selected
 * workspace's group sorts first (it is the sidebar's anchor context); the rest
 * follow in label order; cwd-less sessions collect under "Other" last.
 */
export function groupSessionsByWorkspace(
  liveCwdById: Record<string, string>,
  hibernatedCwdById: Record<string, string>,
  selectedProject: string | null,
  labelFor: (cwd: string) => string,
): WorkspaceGroup[] {
  const groups = new Map<string, WorkspaceGroup>();
  const groupFor = (cwd: string): WorkspaceGroup => {
    let g = groups.get(cwd);
    if (!g) {
      g = {
        cwd,
        label: cwd === "" ? "Other" : labelFor(cwd),
        liveIds: [],
        hibernatedIds: [],
      };
      groups.set(cwd, g);
    }
    return g;
  };
  for (const [id, cwd] of Object.entries(liveCwdById)) {
    groupFor(cwd).liveIds.push(id);
  }
  for (const [id, cwd] of Object.entries(hibernatedCwdById)) {
    groupFor(cwd).hibernatedIds.push(id);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.cwd === selectedProject) return -1;
    if (b.cwd === selectedProject) return 1;
    if (a.cwd === "") return 1;
    if (b.cwd === "") return -1;
    return a.label.localeCompare(b.label);
  });
}

export function SessionList() {
  // Subscribe shallowly to id→cwd maps so the list container re-renders only
  // when sessions open/close or move workspace — each row subscribes to its
  // own slice for live status updates (including background sessions).
  const liveCwdById = useChatStore(
    useShallow((s) =>
      Object.fromEntries(
        Object.entries(s.openSessions).map(([id, v]) => [id, v.cwd ?? ""]),
      ),
    ),
  );
  const hibernatedCwdById = useChatStore(
    useShallow((s) =>
      Object.fromEntries(
        Object.entries(s.hibernatedSessions).map(([id, v]) => [
          id,
          v.descriptor.cwd ?? "",
        ]),
      ),
    ),
  );
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const selectedProject = useAppStore((s) => s.selectedProject);
  const workspaces = useSettingsStore((s) => s.settings?.workspaces);
  const total =
    Object.keys(liveCwdById).length + Object.keys(hibernatedCwdById).length;

  // AGE-807 — every workspace with sessions is visible as its own section.
  const groups = useMemo(
    () =>
      groupSessionsByWorkspace(
        liveCwdById,
        hibernatedCwdById,
        selectedProject,
        (cwd) =>
          workspaces?.find((w) => w.cwd === cwd)?.label ?? projectLabel(cwd),
      ),
    [liveCwdById, hibernatedCwdById, selectedProject, workspaces],
  );

  // Roving tabindex: the list is one Tab stop and Up/Down move focus between
  // rows (Enter/Space activate via the native buttons). The ordered id list
  // follows the rendered order: per group, live rows then hibernated rows.
  const listRef = useRef<HTMLElement>(null);
  const order = useMemo(
    () => groups.flatMap((g) => [...g.liveIds, ...g.hibernatedIds]),
    [groups],
  );
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

  // Headers are chrome, not content: with one group in the selected workspace
  // the context block above already names it, so the header row is skipped.
  const showHeaders =
    groups.length > 1 || (groups[0] && groups[0].cwd !== selectedProject);

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
          groups.map((group) => (
            <section
              key={group.cwd || "__other__"}
              aria-label={`${group.label} sessions`}
            >
              {showHeaders && (
                <WorkspaceGroupHeader
                  group={group}
                  selected={group.cwd === selectedProject}
                />
              )}
              {group.liveIds.map((id) => (
                <SessionListRow
                  key={id}
                  sessionId={id}
                  active={id === activeSessionId}
                  nav={navProps(id)}
                />
              ))}
              {group.hibernatedIds.map((id) => (
                <HibernatedListRow key={id} sessionId={id} nav={navProps(id)} />
              ))}
            </section>
          ))
        )}
      </div>
      {total > 0 && <SessionStatusLegend />}
    </aside>
  );
}

/**
 * A workspace section header (AGE-807). The selected workspace's header is a
 * static marker; any other workspace's header is a button that points new
 * chats at that workspace — the same semantics as picking it in the switcher.
 */
function WorkspaceGroupHeader({
  group,
  selected,
}: {
  group: WorkspaceGroup;
  selected: boolean;
}) {
  const setSelectedProject = useAppStore((s) => s.setSelectedProject);
  const recordWorkspace = useSettingsStore((s) => s.recordWorkspace);
  const workspaces = useSettingsStore((s) => s.settings?.workspaces);
  const color = group.cwd
    ? workspaceColorForCwd(workspaces, group.cwd)
    : undefined;

  const body = (
    <>
      <WorkspaceColorDot color={color} className="h-2 w-2" />
      <span className="truncate">{group.label}</span>
    </>
  );
  const base =
    "flex w-full min-w-0 items-center gap-1.5 px-1 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide";

  if (selected || !group.cwd) {
    return (
      <p className={cn(base, selected ? "text-ink" : "text-ink-faint")}>
        {body}
      </p>
    );
  }
  return (
    <button
      type="button"
      aria-label={`Switch to ${group.label}`}
      title={`Point new chats at ${group.label}`}
      onClick={() => {
        setSelectedProject(group.cwd);
        void recordWorkspace(group.cwd);
      }}
      className={cn(
        base,
        "rounded text-ink-faint transition-colors hover:text-ink",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
      )}
    >
      {body}
    </button>
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
          "flex w-full gap-2.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
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

          {/* AGE-807 density: one mono meta line — model · live/recency ·
              context — instead of a dedicated model row. */}
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-ink-faint">
            <span className="truncate text-ink-muted">
              {modelLabel(session)}
            </span>
            {status === "running" ? (
              <span
                className="lowercase"
                style={colorValue ? { color: colorValue } : undefined}
              >
                live
              </span>
            ) : (
              session.lastActivityAt > 0 && (
                <span>{formatRelativeTime(session.lastActivityAt)}</span>
              )
            )}
            {percent !== null && <span>{percent}%</span>}
            {showStatusBadge && (
              <SessionStatusBadge
                status={session.status}
                uiRequests={session.uiRequests}
                isCompacting={session.isCompacting}
              />
            )}
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

export function hibernatedTitle(descriptor: OpenSessionDescriptor): string {
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

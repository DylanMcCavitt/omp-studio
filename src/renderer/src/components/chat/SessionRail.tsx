// The session list rail for the chat workspace. Lists every open session from
// the normalized store, surfaces each one's headline status (incl. the
// needs-approval / needs-input badge derived from its uiRequests queue), and
// lets the user switch between them (keeping all children alive) or close one
// (disposing that child only — transcript untouched). A "New chat" draft row at
// the top clears the active session so the StartPanel shows.

import { MessageSquarePlus, Plus, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { SessionActionsMenu } from "@/components/session/SessionActionsMenu";
import { Badge, type BadgeVariant, EmptyState, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { type LiveSessionState, useChatStore } from "@/store/chat";
import {
  deriveSessionBadgeKind,
  type SessionBadgeKind,
} from "@/store/session-reducer";

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

/** Headline status badge shared by the rail rows and the active-pane header. */
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
 * the store stays side-effect-pure of window dialogs. Used by the rail rows and
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

export function SessionRail() {
  // Subscribe shallowly to the id list so the rail container re-renders only
  // when sessions open/close — each row subscribes to its own slice for live
  // status updates (including background, non-active sessions).
  const ids = useChatStore(useShallow((s) => Object.keys(s.openSessions)));
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const newChat = useChatStore((s) => s.newChat);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border-subtle bg-bg-panel/40">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Sessions
        </span>
        <span className="text-xs text-ink-faint">{ids.length}</span>
      </div>

      <div className="px-2">
        <button
          type="button"
          onClick={newChat}
          aria-current={activeSessionId === null ? "true" : undefined}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
            activeSessionId === null
              ? "border-accent/50 bg-accent-soft text-accent"
              : "border-border-subtle text-ink-muted hover:bg-bg-hover hover:text-ink",
          )}
        >
          <Plus size={15} className="shrink-0" />
          New chat
        </button>
      </div>

      <div className="scrollbar mt-2 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {ids.length === 0 ? (
          <EmptyState
            icon={<MessageSquarePlus className="h-6 w-6" />}
            title="No open sessions"
            hint="Start a chat to spawn a session — it will appear here so you can switch between live agents."
          />
        ) : (
          ids.map((id) => (
            <SessionRailRow
              key={id}
              sessionId={id}
              active={id === activeSessionId}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function SessionRailRow({
  sessionId,
  active,
}: {
  sessionId: string;
  active: boolean;
}) {
  const session = useChatStore((s) => s.openSessions[sessionId]);
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const patch = useChatStore((s) => s._patch);
  if (!session) return null;

  const percent = session.contextUsage
    ? Math.round(session.contextUsage.percent)
    : null;

  return (
    <div className="group relative">
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={() => setActiveSession(sessionId)}
        className={cn(
          "block w-full rounded-lg border px-3 py-2 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          active
            ? "border-accent/50 bg-accent-soft"
            : "border-transparent hover:border-border-subtle hover:bg-bg-hover",
        )}
      >
        <span
          className={cn(
            "block truncate pr-14 text-sm font-medium",
            active ? "text-accent" : "text-ink",
          )}
        >
          {rowTitle(session)}
        </span>

        <span className="mt-0.5 block truncate font-mono text-xs text-ink-muted">
          {modelLabel(session)}
        </span>

        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
          <SessionStatusBadge
            status={session.status}
            uiRequests={session.uiRequests}
            isCompacting={session.isCompacting}
          />
          {percent !== null && <span>{percent}% context</span>}
          {session.queuedCount > 0 && (
            <Badge variant="muted">{session.queuedCount} queued</Badge>
          )}
          {session.lastActivityAt > 0 && (
            <span className="ml-auto">
              {formatRelativeTime(session.lastActivityAt)}
            </span>
          )}
        </span>
      </button>

      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <SessionActionsMenu
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

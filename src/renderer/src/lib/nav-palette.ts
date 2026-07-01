// AGE-700 — pure data + filtering for the ⌘K navigation palette. Kept free of
// React/store imports so the grouping, status derivation, and substring filter
// are unit-testable from plain inputs. The palette component (components/nav/
// NavPalette) builds the two groups from the live stores and renders them.

import type {
  OpenSessionDescriptor,
  Workspace,
  WorkspaceColorKey,
} from "@shared/ipc";
import { basename, hibernatedTitle } from "@/components/chat/SessionList";
import {
  projectLabel,
  sortWorkspaces,
  workspaceColorForCwd,
} from "@/lib/workspaces";
import type { HibernatedSession, LiveSessionSummary } from "@/store/chat";
import { type SessionStatus, sessionStatus } from "@/store/session-reducer";

/** A Workspaces-group row: hue = identity, leads with an identity Live Dot. */
export interface WorkspaceNavItem {
  kind: "workspace";
  id: string;
  label: string;
  cwd: string;
  color: WorkspaceColorKey | undefined;
  /** The workspace new chats currently point at (mirrors the switcher's check). */
  current: boolean;
}

/** A Recent-sessions row: leads with a status Live Dot (running/idle/done). */
export interface SessionNavItem {
  kind: "session";
  id: string;
  title: string;
  status: SessionStatus;
  /** True for a live (open) session, false for a hibernated/closed one. */
  live: boolean;
  workspaceLabel: string;
  color: WorkspaceColorKey | undefined;
  /** Epoch ms used to order recents most-recent-first. */
  lastActiveAt: number;
}

export type NavItem = WorkspaceNavItem | SessionNavItem;

/** Build the Workspaces group, ordered like the switcher (pinned, then recent). */
export function workspaceNavItems(
  workspaces: readonly Workspace[] | undefined,
  selectedProject: string | null,
): WorkspaceNavItem[] {
  return sortWorkspaces(workspaces ?? []).map((w) => ({
    kind: "workspace",
    id: w.id,
    label: w.label,
    cwd: w.cwd,
    color: w.color,
    current: w.cwd === selectedProject,
  }));
}

function liveTitle(s: LiveSessionSummary): string {
  if (s.alias && s.alias.trim() !== "") return s.alias;
  if (s.sessionName && s.sessionName.trim() !== "") return s.sessionName;
  if (s.cwd) return basename(s.cwd);
  return s.sessionId;
}

/**
 * Build the Recent sessions group from the live + hibernated stores, newest
 * first. Status is derived (never stored): live+streaming = running, live+idle =
 * idle, hibernated/closed = done.
 */
export function sessionNavItems(
  openSessions: Record<string, LiveSessionSummary>,
  hibernatedSessions: Record<string, HibernatedSession>,
  workspaces: readonly Workspace[] | undefined,
): SessionNavItem[] {
  const live: SessionNavItem[] = Object.values(openSessions).map((s) => ({
    kind: "session",
    id: s.sessionId,
    title: liveTitle(s),
    status: sessionStatus({ live: true, status: s.status }),
    live: true,
    workspaceLabel: s.cwd
      ? (workspaces?.find((w) => w.cwd === s.cwd)?.label ?? projectLabel(s.cwd))
      : "—",
    color: workspaceColorForCwd(workspaces, s.cwd),
    lastActiveAt: s.lastActivityAt,
  }));
  const hibernated: SessionNavItem[] = Object.values(hibernatedSessions).map(
    ({ descriptor }: { descriptor: OpenSessionDescriptor }) => ({
      kind: "session",
      id: descriptor.studioSessionId,
      title: hibernatedTitle(descriptor),
      status: sessionStatus({ live: false }),
      live: false,
      workspaceLabel:
        workspaces?.find((w) => w.cwd === descriptor.cwd)?.label ??
        projectLabel(descriptor.cwd),
      color: workspaceColorForCwd(workspaces, descriptor.cwd),
      lastActiveAt: Date.parse(descriptor.lastActiveAt) || 0,
    }),
  );
  return [...live, ...hibernated].sort(
    (a, b) => b.lastActiveAt - a.lastActiveAt,
  );
}

/** Case-insensitive substring match against any of `fields`; empty query matches all. */
function matches(query: string, fields: string[]): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return fields.some((f) => f.toLowerCase().includes(q));
}

/** Filter the Workspaces group by name or path. */
export function filterWorkspaceItems(
  items: WorkspaceNavItem[],
  query: string,
): WorkspaceNavItem[] {
  return items.filter((w) => matches(query, [w.label, w.cwd]));
}

/** Filter the Recent sessions group by title or workspace name. */
export function filterSessionItems(
  items: SessionNavItem[],
  query: string,
): SessionNavItem[] {
  return items.filter((s) => matches(query, [s.title, s.workspaceLabel]));
}

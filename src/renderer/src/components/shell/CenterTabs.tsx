// The center surface (AGE-634 tabs + AGE-801 pane host + AGE-777 split panes).
// The center renders the PANE MODEL (store/panes.ts): a split tree of chat /
// file / subagent panes, each an independent session-scoped surface. The
// default state is one chat pane that follows the active session — visually
// and behaviorally identical to the pre-pane shell.
//
// AGE-777 chrome: split nodes render as resizable PanelGroups; once a second
// pane opens, every pane grows a slim header (title + close) so users always
// know which chat/subagent a pane shows, the focused pane is ring-highlighted,
// and every pane doubles as a drop target for subagents dragged from the
// Subagent tree (drop opens that subagent's inspector beside the target pane).
// Closing a pane only removes the pane — the underlying session is never
// disposed unless the user explicitly closes the session itself.
//
// The legacy center tab strip (an always-present "Chat" tab plus one tab per
// open file) still lives on the DEFAULT pane only: file tabs opened from the
// Files sidebar toggle within the main pane, while additional panes from the
// pane model render beside it in the split tree. Every pane and tab stays
// MOUNTED and is toggled with `hidden`, so switching preserves the chat (a
// live stream keeps running) and each editor's cursor/scroll/undo. Closing a
// dirty file confirms via the store wrapper.

import type { SubagentInfo, SubagentSnapshot } from "@shared/rpc";
import {
  FileText,
  MessageSquare,
  MessageSquareDashed,
  Users,
  X,
} from "lucide-react";
import { type DragEvent, Fragment, type ReactNode, useState } from "react";
import { PanelGroup, Panel as ResizablePanel } from "react-resizable-panels";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { SubagentInspector } from "@/components/chat/SubagentInspector";
import { subagentLabel } from "@/components/chat/SubagentTree";
import { FileEditor } from "@/components/files/FileEditor";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { EmptyState, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useChatStore, useSession } from "@/store/chat";
import {
  type CenterTab,
  CHAT_TAB,
  closeFileWithConfirm,
  fileBasename,
  useFilesStore,
} from "@/store/files";
import {
  MAIN_PANE_ID,
  type PaneEntry,
  type PaneLayout,
  usePaneStore,
} from "@/store/panes";
import ChatWorkspace from "@/views/Chat";
import { rowTitle } from "../chat/SessionList";
import {
  openPaneWithFeedback,
  readSubagentDragData,
  SUBAGENT_DRAG_MIME,
} from "./pane-actions";

const TAB_BASE =
  "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
const TAB_ACTIVE = "bg-bg-hover text-ink";
const TAB_INACTIVE = "text-ink-muted hover:bg-bg-hover/60 hover:text-ink";

export function CenterTabs() {
  const layout = usePaneStore((s) => s.layout);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PaneTree node={layout} />
    </div>
  );
}

// Render a split-tree node: leaves become PaneViews; splits become resizable
// PanelGroups (AGE-777) with a drag handle between each pair of children.
function PaneTree({ node }: { node: PaneLayout }) {
  if (node.kind === "leaf") {
    return <PaneView paneId={node.paneId} />;
  }
  const horizontal = node.direction === "row";
  return (
    <PanelGroup
      direction={horizontal ? "horizontal" : "vertical"}
      className="h-full min-h-0 min-w-0"
    >
      {node.children.map((child, i) => {
        // The tree is rebuilt on structural change; index identity is stable
        // between rebuilds and leaf children carry their own paneId keys.
        const key = child.kind === "leaf" ? child.paneId : `split-${i}`;
        return (
          <Fragment key={key}>
            {i > 0 && (
              <ResizeHandle
                direction={horizontal ? "horizontal" : "vertical"}
                ariaLabel="Resize panes"
              />
            )}
            <ResizablePanel
              id={key}
              order={i}
              defaultSize={100 / node.children.length}
              minSize={10}
              className="min-h-0 min-w-0"
            >
              <PaneTree node={child} />
            </ResizablePanel>
          </Fragment>
        );
      })}
    </PanelGroup>
  );
}

// One pane. Chat panes render a session-scoped ChatWorkspace (pinned via the
// pane's sessionId, or following the active session when unset); subagent
// panes render that subagent's inspector; file panes render a single editor.
// A crash inside one pane must never blank its siblings, so each pane carries
// its own error boundary.
function PaneView({ paneId }: { paneId: string }) {
  const pane = usePaneStore((s) => s.panes[paneId]);
  const focusPane = usePaneStore((s) => s.focusPane);
  const multiPane = usePaneStore((s) => Object.keys(s.panes).length > 1);
  const focused = usePaneStore((s) => s.focusedPaneId === paneId);
  // dragenter/dragleave fire per descendant crossing; a depth counter keeps
  // the drop overlay steady until the drag truly leaves this pane.
  const [dragDepth, setDragDepth] = useState(0);
  if (!pane) return null;

  const onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(SUBAGENT_DRAG_MIME)) return;
    e.preventDefault();
    setDragDepth((d) => d + 1);
  };
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(SUBAGENT_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(SUBAGENT_DRAG_MIME)) return;
    setDragDepth((d) => Math.max(0, d - 1));
  };
  const onDrop = (e: DragEvent) => {
    setDragDepth(0);
    const payload = readSubagentDragData(e.dataTransfer);
    if (!payload) return;
    e.preventDefault();
    openPaneWithFeedback(
      { kind: "subagent", ...payload },
      { besideId: paneId, direction: "row" },
    );
  };

  return (
    // Focus routing (keyboard shortcuts target the focused pane) is pointer-
    // driven; the pane surface itself is not an interactive control.
    <section
      aria-label={paneLabel(pane)}
      data-pane-id={paneId}
      data-focused={multiPane && focused ? "true" : undefined}
      onFocusCapture={() => focusPane(paneId)}
      onPointerDownCapture={() => focusPane(paneId)}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-col",
        multiPane && focused && "ring-1 ring-inset ring-accent/40",
      )}
    >
      {multiPane && <PaneHeader pane={pane} />}
      <div className="min-h-0 min-w-0 flex-1">
        <AppErrorBoundary
          resetKey={`${pane.kind}:${pane.sessionId ?? ""}:${pane.path ?? ""}:${pane.subagentId ?? ""}:${paneId}`}
        >
          {pane.kind === "chat" ? (
            paneId === MAIN_PANE_ID ? (
              <MainPaneWithFileTabs sessionId={pane.sessionId} />
            ) : (
              <ChatWorkspace sessionId={pane.sessionId} />
            )
          ) : pane.kind === "subagent" && pane.sessionId && pane.subagentId ? (
            <SubagentPane
              paneId={paneId}
              sessionId={pane.sessionId}
              subagentId={pane.subagentId}
            />
          ) : pane.path ? (
            <FileEditor path={pane.path} />
          ) : null}
        </AppErrorBoundary>
      </div>
      {dragDepth > 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-accent/10 ring-2 ring-inset ring-accent">
          <span className="rounded-md bg-bg-raised px-3 py-1.5 text-xs font-medium text-ink shadow-lg">
            Open in split pane
          </span>
        </div>
      )}
    </section>
  );
}

function paneLabel(pane: PaneEntry): string {
  if (pane.kind === "file") {
    return pane.path ? `File pane: ${fileBasename(pane.path)}` : "File pane";
  }
  if (pane.kind === "subagent") return "Subagent pane";
  return pane.sessionId ? "Chat pane" : "Main chat pane";
}

// AGE-777 — per-pane chrome, shown only once a second pane exists (the single-
// pane shell stays chrome-free). Carries the pane's identity (which chat /
// subagent / file) and the close affordance. The MAIN pane is permanent shell
// chrome (it owns the legacy file tab strip), so it has no close button; live
// status stays with the surfaces themselves (chat header / inspector header).
function PaneHeader({ pane }: { pane: PaneEntry }) {
  const closePane = usePaneStore((s) => s.closePane);
  return (
    <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg-raised px-2">
      <PaneTitle pane={pane} />
      {pane.id !== MAIN_PANE_ID && (
        <IconButton
          label="Close pane"
          onClick={() => closePane(pane.id)}
          className="h-6 w-6 shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </IconButton>
      )}
    </div>
  );
}

function PaneTitle({ pane }: { pane: PaneEntry }) {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  // Chat panes show the session they render (pinned, or the active one the
  // default pane follows); subagent panes show the subagent's label.
  const chatSessionId =
    pane.kind === "chat" ? (pane.sessionId ?? activeSessionId) : null;
  const chatTitle = useSession(chatSessionId, (s) => (s ? rowTitle(s) : null));
  const subagentTitle = useSession(
    pane.kind === "subagent" ? (pane.sessionId ?? null) : null,
    (s) => {
      const roster = (s?.subagents ?? []) as unknown as SubagentSnapshot[];
      const sub = roster.find((x) => x.id === pane.subagentId);
      return sub ? subagentLabel(sub) : null;
    },
  );

  const Icon =
    pane.kind === "file"
      ? FileText
      : pane.kind === "subagent"
        ? Users
        : MessageSquare;
  const title =
    pane.kind === "file"
      ? pane.path
        ? fileBasename(pane.path)
        : "File"
      : pane.kind === "subagent"
        ? (subagentTitle ?? "Subagent")
        : (chatTitle ?? "No chat open");

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-medium text-ink-muted">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate text-ink">{title}</span>
    </span>
  );
}

const EMPTY_SUBAGENTS: SubagentInfo[] = [];

// A pane pinned to one subagent's inspector (AGE-777). "Back" swaps the pane
// in place to the parent session's transcript — it never closes the pane or
// touches the session. If the subagent vanishes from the roster (parent
// session closed), degrade to an empty state rather than crash the pane.
function SubagentPane({
  paneId,
  sessionId,
  subagentId,
}: {
  paneId: string;
  sessionId: string;
  subagentId: string;
}) {
  const replacePane = usePaneStore((s) => s.replacePane);
  const roster = useSession(
    sessionId,
    (s) => s?.subagents ?? EMPTY_SUBAGENTS,
  ) as unknown as SubagentSnapshot[];
  const subagent = roster.find((x) => x.id === subagentId);
  if (!subagent) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={<MessageSquareDashed className="h-6 w-6" />}
          title="Subagent unavailable"
          hint="Its parent session is no longer open."
        />
      </div>
    );
  }
  return (
    <SubagentInspector
      subagent={subagent}
      sessionId={sessionId}
      onBack={() => replacePane(paneId, { kind: "chat", sessionId })}
    />
  );
}

// The default pane keeps the legacy center tab strip: chat + one tab per open
// file, all mounted, toggled with `hidden`. Extra panes never grow a strip —
// their content is fixed at open time; their chrome is the PaneHeader above.
function MainPaneWithFileTabs({ sessionId }: { sessionId?: string }) {
  const order = useFilesStore((s) => s.order);
  const activeTab = useFilesStore((s) => s.activeTab);
  const hasFiles = order.length > 0;
  // With no files the chat owns the surface; otherwise it shows only when focused.
  const chatActive = !hasFiles || activeTab === CHAT_TAB;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {hasFiles && <TabStrip order={order} activeTab={activeTab} />}
      <div className="relative min-h-0 min-w-0 flex-1">
        <TogglePane active={chatActive}>
          <ChatWorkspace sessionId={sessionId} />
        </TogglePane>
        {order.map((path) => (
          <TogglePane key={path} active={activeTab === path}>
            <FileEditor path={path} />
          </TogglePane>
        ))}
      </div>
    </div>
  );
}

/**
 * A mounted-but-toggled pane: the inactive pane is removed from layout with the
 * native `hidden` attribute (so the chat keeps streaming and each editor keeps
 * its cursor/scroll/undo across switches). `hidden` is used over a `display`
 * utility because the pane carries no competing `display` class, so the UA
 * `display:none` always wins.
 */
function TogglePane({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      hidden={!active}
      aria-hidden={!active}
      className="absolute inset-0 min-h-0 min-w-0"
    >
      {children}
    </div>
  );
}

function TabStrip({
  order,
  activeTab,
}: {
  order: string[];
  activeTab: CenterTab;
}) {
  const setActiveTab = useFilesStore((s) => s.setActiveTab);
  return (
    <div
      role="tablist"
      aria-label="Open tabs"
      className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-subtle bg-bg-raised px-1.5"
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === CHAT_TAB}
        onClick={() => setActiveTab(CHAT_TAB)}
        className={cn(
          TAB_BASE,
          activeTab === CHAT_TAB ? TAB_ACTIVE : TAB_INACTIVE,
        )}
      >
        <MessageSquare size={14} className="shrink-0" />
        Chat
      </button>
      {order.map((path) => (
        <FileTabButton
          key={path}
          path={path}
          active={activeTab === path}
          onSelect={() => setActiveTab(path)}
        />
      ))}
    </div>
  );
}

function FileTabButton({
  path,
  active,
  onSelect,
}: {
  path: string;
  active: boolean;
  onSelect: () => void;
}) {
  const dirty = useFilesStore((s) => s.tabs[path]?.dirty === true);
  const name = fileBasename(path);
  return (
    // Presentational wrapper so the select + close buttons stay siblings (never
    // nested interactives); the close button overlays the select button's right
    // padding so a click on it never selects the tab.
    <div className="relative flex shrink-0 items-stretch">
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onSelect}
        title={path}
        className={cn(TAB_BASE, "pr-7", active ? TAB_ACTIVE : TAB_INACTIVE)}
      >
        <FileText size={14} className="shrink-0 text-ink-faint" />
        <span className="max-w-[11rem] truncate">{name}</span>
        {dirty && (
          <span
            role="img"
            aria-label="Unsaved changes"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
          />
        )}
      </button>
      <button
        type="button"
        aria-label={`Close ${name}`}
        onClick={() => closeFileWithConfirm(path)}
        className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-ink-faint transition-colors hover:bg-bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// The live agent chat view. With no active session it shows a minimal empty
// state — new chats start from the left sidebar (or this view's New chat
// button). With an active session it shows the transcript + composer on the left
// and model / thinking / plan / subagent rails on the right, reading the active
// session's slice from the normalized multi-session store.

import type { ChatUiRequestEvent } from "@shared/ipc";
import type { SubagentInfo, SubagentSnapshot } from "@shared/rpc";
import {
  Check,
  Gauge,
  GripVertical,
  ListTodo,
  type LucideIcon,
  MessageSquarePlus,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo } from "react";
import { PanelGroup, Panel as ResizablePanel } from "react-resizable-panels";
import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { ModelControl } from "@/components/chat/ModelControl";
import { SessionStatusBadge } from "@/components/chat/SessionList";
import {
  ContextMeterChip,
  SessionStatsPanel,
} from "@/components/chat/SessionStatsPanel";
import { SubagentInspector } from "@/components/chat/SubagentInspector";
import { SubagentTree } from "@/components/chat/SubagentTree";
import { ThinkingControl } from "@/components/chat/ThinkingControl";
import { TodoPanel } from "@/components/chat/TodoPanel";
import { UiRequestLayer } from "@/components/chat/UiRequestLayer";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { useDragReorder } from "@/components/layout/useDragReorder";
import { usePersistedPanelLayout } from "@/components/layout/usePersistedPanelLayout";
import {
  Button,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  CHAT_RAIL_MAX_PCT,
  CHAT_RAIL_MIN_PCT,
  CHAT_TRANSCRIPT_MIN_PCT,
  DEFAULT_CHAT_RAIL_WIDTH_PCT,
  type RailPanelId,
  type RailPanelState,
  reorder,
  resolveRailPanels,
  roundPct,
  setRailPanelVisible,
} from "@/lib/layout";
import { useActiveSession, useChatStore } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";
import { useShellStore } from "@/store/shell";

/** Stable empty queue so the no-active-session selectors keep a steady ref. */
const NO_UI: ChatUiRequestEvent[] = [];

/** Stable empty roster so the no-subagent selector keeps a steady ref. */
const NO_SUBAGENTS: SubagentInfo[] = [];

export default function ChatWorkspace() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  // Cmd/Ctrl+W (close active session) is handled by the global shortcut manager
  // (lib/useShortcuts), wired once in App — no per-view listener here. The
  // session list + New chat action live in the left sidebar (AGE-632), not here.
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* Mounted at the workspace root so the active session's pending UI
          requests survive session switches and render as focused modals. */}
      <UiRequestLayer />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {activeSessionId ? (
          <ChatSession key={activeSessionId} sessionId={activeSessionId} />
        ) : (
          <NoActiveSession />
        )}
      </div>
    </div>
  );
}

// The no-active-session center: a minimal empty state. The old StartPanel card
// (project/model picker + prompt) is gone — new chats spawn from the sidebar (or
// the button here) in the active workspace with the default model.
function NoActiveSession() {
  const newChat = useChatStore((s) => s.newChat);
  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState
        icon={<MessageSquarePlus className="h-6 w-6" />}
        title="No chat open"
        hint="Pick one from the sidebar or start a new chat."
        action={
          <Button variant="primary" onClick={newChat}>
            <MessageSquarePlus className="h-4 w-4" />
            New chat
          </Button>
        }
      />
    </div>
  );
}

const RAIL_PANEL_TITLE: Record<RailPanelId, string> = {
  stats: "Usage",
  todos: "Plan",
  subagents: "Subagents",
};

const RAIL_PANEL_ICON: Record<RailPanelId, LucideIcon> = {
  stats: Gauge,
  todos: ListTodo,
  subagents: Users,
};

/** Everything a rail panel needs to render its live controls. */
interface RailContext {
  sessionId: string;
  /** Pop into a subagent's full-view transcript (center column). */
  onInspect: (subagentId: string) => void;
}

function ChatSession({ sessionId }: { sessionId: string }) {
  const open = useChatStore((s) => Boolean(s.openSessions[sessionId]));
  const openSession = useChatStore((s) => s.openSession);
  const status = useActiveSession((s) => s?.status ?? "idle");
  const model = useActiveSession((s) => s?.model ?? null);
  const thinkingLevel = useActiveSession((s) => s?.thinkingLevel ?? "medium");
  const setModel = useChatStore((s) => s.setModel);
  const setThinking = useChatStore((s) => s.setThinking);
  const error = useActiveSession((s) => s?.error);
  const uiRequests = useActiveSession((s) => s?.uiRequests ?? NO_UI);
  const isCompacting = useActiveSession((s) => s?.isCompacting ?? false);
  const persistedRailCollapsed = useSettingsStore(
    (s) => s.settings?.layout?.chatRailCollapsed ?? false,
  );
  const settingsLoaded = useSettingsStore((s) => s.settings != null);
  const setLayout = useSettingsStore((s) => s.setLayout);
  const shellPanelOpen = useShellStore((s) => s.openPanelId != null);
  const closeShellPanel = useShellStore((s) => s.closePanel);
  const inspectedId = useChatStore((s) => s.inspectedSubagentId);
  const setInspected = useChatStore((s) => s.setInspectedSubagent);
  const subagents = useActiveSession(
    (s) => s?.subagents ?? NO_SUBAGENTS,
  ) as unknown as SubagentSnapshot[];
  const inspected = inspectedId
    ? subagents.find((s) => s.id === inspectedId)
    : undefined;

  // Safety net: if the active session isn't registered yet (e.g. selected from
  // another surface), open it now. start() registers before activating, so this
  // no-ops for freshly created chats and on session switches.
  useEffect(() => {
    if (open) return;
    let cancelled = false;
    void (async () => {
      try {
        const state = await window.omp.chat.getState(sessionId);
        if (!cancelled) await openSession(sessionId, state);
      } catch {
        // The bridge may not hold this session id; leave the store untouched.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, open, openSession]);

  const transcript = (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5">
        <ModelControl model={model} onChange={setModel} />
        <ThinkingControl level={thinkingLevel} onChange={setThinking} />
        <SessionStatusBadge
          status={status}
          uiRequests={uiRequests}
          isCompacting={isCompacting}
        />
        <ContextMeterChip />
      </header>
      {error && status === "error" && (
        <div className="border-b border-danger/30 bg-danger/10 px-4 py-1.5 text-xs text-danger">
          {error}
        </div>
      )}
      <MessageList />
      <Composer />
    </div>
  );

  // Pop into a subagent's live transcript in place of the main chat; the rail
  // tree's Eye sets the id, the inspector's Back clears it.
  const center =
    inspected != null ? (
      <SubagentInspector
        subagent={inspected}
        sessionId={sessionId}
        onBack={() => setInspected(null)}
      />
    ) : (
      transcript
    );

  // A shell rail panel (Terminal/Files/etc.) owns the far-right column. Showing
  // the chat's own Panels rail beside it wedges a narrow, often-sparse strip
  // between the transcript and the opened panel (the "dead middle band" of
  // AGE-669) and stops the transcript reclaiming the freed width. Collapse to
  // the icon strip whenever the chat rail is collapsed OR a shell panel is open;
  // expanding then closes the shell panel so the two rails never stack.
  if (persistedRailCollapsed || shellPanelOpen) {
    return (
      <div className="flex h-full min-h-0">
        <div className="min-w-0 flex-1">{center}</div>
        <RailIconStrip
          onExpand={() => {
            if (shellPanelOpen) closeShellPanel();
            if (persistedRailCollapsed) setLayout({ chatRailCollapsed: false });
          }}
        />
      </div>
    );
  }

  const rail = (
    <RightRail
      sessionId={sessionId}
      onInspect={setInspected}
      onCollapse={() => setLayout({ chatRailCollapsed: true })}
    />
  );

  return (
    <ChatRailSplit
      key={settingsLoaded ? "ready" : "boot"}
      transcript={center}
      rail={rail}
    />
  );
}

function ChatRailSplit({
  transcript,
  rail,
}: {
  transcript: ReactNode;
  rail: ReactNode;
}) {
  const { initialLayout, groupRef, onLayout, reset } = usePersistedPanelLayout({
    defaultLayout: [
      100 - DEFAULT_CHAT_RAIL_WIDTH_PCT,
      DEFAULT_CHAT_RAIL_WIDTH_PCT,
    ],
    read: (l) =>
      l.chatRailWidthPct != null
        ? [100 - l.chatRailWidthPct, l.chatRailWidthPct]
        : undefined,
    toPatch: ([, railPct = DEFAULT_CHAT_RAIL_WIDTH_PCT]) => ({
      chatRailWidthPct: roundPct(railPct),
    }),
  });

  return (
    <PanelGroup
      ref={groupRef}
      direction="horizontal"
      onLayout={onLayout}
      className="flex h-full min-h-0"
    >
      <ResizablePanel
        order={1}
        defaultSize={initialLayout[0]}
        minSize={CHAT_TRANSCRIPT_MIN_PCT}
        className="flex min-h-0 min-w-0 overflow-hidden"
      >
        {transcript}
      </ResizablePanel>
      <ResizeHandle ariaLabel="Resize panel rail" onReset={reset} />
      <ResizablePanel
        order={2}
        defaultSize={initialLayout[1]}
        minSize={CHAT_RAIL_MIN_PCT}
        maxSize={CHAT_RAIL_MAX_PCT}
        className="flex min-h-0 min-w-0 overflow-hidden"
      >
        {rail}
      </ResizablePanel>
    </PanelGroup>
  );
}

function RightRail({
  onCollapse,
  ...ctx
}: RailContext & { onCollapse: () => void }) {
  const panelsSetting = useSettingsStore(
    (s) => s.settings?.layout?.chatRailPanels,
  );
  const setLayout = useSettingsStore((s) => s.setLayout);
  const panels = useMemo(
    () => resolveRailPanels(panelsSetting),
    [panelsSetting],
  );
  const visible = panels.filter((p) => p.visible);

  const dnd = useDragReorder((from, to) => {
    const fromId = visible[from]?.id;
    const toId = visible[to]?.id;
    if (!fromId || !toId) return;
    setLayout({
      chatRailPanels: reorder(
        panels,
        panels.findIndex((p) => p.id === fromId),
        panels.findIndex((p) => p.id === toId),
      ),
    });
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-panel/40">
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Panels
        </span>
        <div className="flex items-center gap-0.5">
          <RailCustomizeMenu
            panels={panels}
            onToggle={(id, vis) =>
              setLayout({
                chatRailPanels: setRailPanelVisible(panels, id, vis),
              })
            }
          />
          <IconButton
            label="Collapse panel rail"
            onClick={onCollapse}
            className="h-7 w-7"
          >
            <PanelRightClose className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      <div className="scrollbar flex-1 space-y-4 overflow-y-auto p-4">
        {visible.length === 0 ? (
          <EmptyState
            icon={<MoreHorizontal className="h-5 w-5" />}
            title="No panels shown"
            hint="Enable panels from the Customize menu."
          />
        ) : (
          visible.map((panel, index) => (
            <div
              key={panel.id}
              {...dnd.zoneProps(index)}
              className={cn(
                "rounded-xl",
                dnd.dragIndex === index && "opacity-50",
                dnd.overIndex === index &&
                  dnd.dragIndex !== index &&
                  "ring-2 ring-accent/40",
              )}
            >
              {renderRailPanel(
                panel.id,
                ctx,
                <RailDragHandle
                  label={RAIL_PANEL_TITLE[panel.id]}
                  handleProps={dnd.handleProps(index)}
                />,
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RailDragHandle({
  label,
  handleProps,
}: {
  label: string;
  handleProps: React.ComponentProps<"button">;
}) {
  return (
    <button
      type="button"
      {...handleProps}
      aria-label={`Reorder ${label}`}
      title="Drag to reorder"
      className="-ml-1 flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-ink-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  );
}

function RailCustomizeMenu({
  panels,
  onToggle,
}: {
  panels: RailPanelState[];
  onToggle: (id: RailPanelId, visible: boolean) => void;
}) {
  return (
    <Menu
      align="end"
      aria-label="Customize panels"
      trigger={({ open, toggle, triggerRef }) => (
        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Customize panels"
          title="Customize panels"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}
    >
      {panels.map((p) => (
        <MenuItem
          key={p.id}
          icon={
            p.visible ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <span className="block h-3.5 w-3.5" />
            )
          }
          onClick={() => onToggle(p.id, !p.visible)}
        >
          {RAIL_PANEL_TITLE[p.id]}
        </MenuItem>
      ))}
    </Menu>
  );
}

function RailIconStrip({ onExpand }: { onExpand: () => void }) {
  const panelsSetting = useSettingsStore(
    (s) => s.settings?.layout?.chatRailPanels,
  );
  const panels = useMemo(
    () => resolveRailPanels(panelsSetting),
    [panelsSetting],
  );
  const visible = panels.filter((p) => p.visible);
  return (
    <div className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-l border-border-subtle bg-bg-panel/40 py-2">
      <IconButton
        label="Expand panel rail"
        onClick={onExpand}
        className="h-9 w-9"
      >
        <PanelRightOpen className="h-4 w-4" />
      </IconButton>
      {visible.length > 0 && <div className="my-1 h-px w-6 bg-border-subtle" />}
      {visible.map((panel) => {
        const Icon = RAIL_PANEL_ICON[panel.id];
        return (
          <IconButton
            key={panel.id}
            label={RAIL_PANEL_TITLE[panel.id]}
            onClick={onExpand}
            className="h-9 w-9"
          >
            <Icon className="h-4 w-4" />
          </IconButton>
        );
      })}
    </div>
  );
}

function renderRailPanel(
  id: RailPanelId,
  ctx: RailContext,
  handle: ReactNode,
): ReactNode {
  switch (id) {
    case "stats":
      return (
        <SessionStatsPanel sessionId={ctx.sessionId} headerLeading={handle} />
      );
    case "todos":
      return <TodoPanel headerLeading={handle} />;
    case "subagents":
      return <SubagentTree headerLeading={handle} onInspect={ctx.onInspect} />;
  }
}

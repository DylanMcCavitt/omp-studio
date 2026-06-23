// Feature 4 — the per-session subagent workflow tree. The roster from
// `chat.getSubagents` (SubagentSnapshot at runtime) is nested into a real tree:
// a subagent whose `parentToolCallId` was emitted by another subagent nests
// under it, everything else hangs off the session root. Each node shows the
// agent label, its source + status badges, and (when running) a live ticker
// driven by the reduced `AgentProgress`. Disclosure uses the shared Collapsible
// primitive (no hand-rolled <details>); the Eye action drills into the inspector.

import type {
  AgentProgress,
  AgentSource,
  SubagentInfo,
  SubagentSnapshot,
  ToolExecutionFrame,
} from "@shared/rpc";
import { Eye, Users } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { BadgeVariant } from "@/components/ui";
import {
  Badge,
  Collapsible,
  EmptyState,
  IconButton,
  Panel,
} from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { useActiveSession } from "@/store/chat";
import type { SubagentLiveState } from "@/store/session-reducer";
import { SubagentInspector } from "./SubagentInspector";

export type SubagentStatus = AgentProgress["status"];

/** Badge tint per subagent run status. */
export const STATUS_VARIANT: Record<SubagentStatus, BadgeVariant> = {
  pending: "muted",
  running: "accent",
  completed: "success",
  failed: "danger",
  aborted: "danger",
};

/** Badge tint per agent-definition source. */
export const SOURCE_VARIANT: Record<AgentSource, BadgeVariant> = {
  bundled: "muted",
  user: "accent",
  project: "warn",
};

/** Best human label for a subagent row / inspector header. */
export function subagentLabel(sub: SubagentSnapshot): string {
  return (
    sub.description?.trim() ||
    sub.task?.trim() ||
    sub.agent ||
    sub.id ||
    "agent"
  );
}

interface SubagentNode {
  sub: SubagentSnapshot;
  progress?: AgentProgress;
  children: SubagentNode[];
}

/**
 * Nest a flat snapshot roster into a tree. A subagent's `parentToolCallId` is
 * the tool call that spawned it; we resolve that to the subagent which *emitted*
 * the call (scanning each child's reduced event log). Calls made by the session
 * itself never match a subagent, so those subagents become roots. Unresolvable
 * links (e.g. the spawning frame aged out of the capped buffer) also fall back
 * to root, so no subagent is ever dropped. Siblings sort by `index`.
 */
export function buildSubagentTree(
  subagents: SubagentSnapshot[],
  events: Record<string, SubagentLiveState>,
): SubagentNode[] {
  const ownerByToolCall = new Map<string, string>();
  for (const sub of subagents) {
    for (const frame of events[sub.id]?.events ?? []) {
      if (
        frame.type === "tool_execution_start" ||
        frame.type === "tool_execution_update" ||
        frame.type === "tool_execution_end"
      ) {
        const tcId = (frame as ToolExecutionFrame).toolCallId;
        if (typeof tcId === "string") ownerByToolCall.set(tcId, sub.id);
      }
    }
  }

  const nodes = new Map<string, SubagentNode>();
  for (const sub of subagents) {
    nodes.set(sub.id, {
      sub,
      progress: events[sub.id]?.progress ?? sub.progress,
      children: [],
    });
  }

  const roots: SubagentNode[] = [];
  for (const sub of subagents) {
    const node = nodes.get(sub.id);
    if (!node) continue;
    const parentId = sub.parentToolCallId
      ? ownerByToolCall.get(sub.parentToolCallId)
      : undefined;
    const parent =
      parentId && parentId !== sub.id ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const byIndex = (a: SubagentNode, b: SubagentNode) =>
    (a.sub.index ?? 0) - (b.sub.index ?? 0);
  roots.sort(byIndex);
  for (const node of nodes.values()) node.children.sort(byIndex);
  return roots;
}

function NodeTicker({ progress }: { progress: AgentProgress }) {
  return (
    <div className="space-y-0.5 text-xs text-ink-faint">
      {progress.lastIntent && (
        <div className="truncate italic">{progress.lastIntent}</div>
      )}
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        {progress.currentTool && (
          <span className="font-mono text-ink-muted">
            {progress.currentTool}
          </span>
        )}
        <span>{progress.toolCount} tools</span>
        <span>{formatNumber(progress.tokens)} tok</span>
      </div>
    </div>
  );
}

function NodeView({
  node,
  onSelect,
}: {
  node: SubagentNode;
  onSelect: (id: string) => void;
}) {
  const { sub, progress, children } = node;
  const actions = (
    <>
      <Badge variant={SOURCE_VARIANT[sub.agentSource]}>{sub.agentSource}</Badge>
      <Badge variant={STATUS_VARIANT[sub.status]}>{sub.status}</Badge>
      <IconButton
        label={`Inspect ${subagentLabel(sub)}`}
        onClick={() => onSelect(sub.id)}
        className="h-6 w-6"
      >
        <Eye className="h-3.5 w-3.5" />
      </IconButton>
    </>
  );

  // A node with neither children nor progress has nothing to disclose, so it
  // renders as a static row (aligned past where the chevron would sit) rather
  // than an empty Collapsible.
  if (children.length === 0 && !progress) {
    return (
      <div className="flex items-center gap-2 py-1 pl-[1.375rem]">
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          {subagentLabel(sub)}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
      </div>
    );
  }

  return (
    <Collapsible
      title={subagentLabel(sub)}
      actions={actions}
      defaultOpen
      bodyClassName="space-y-1 pl-[1.375rem] pt-1"
    >
      {progress && <NodeTicker progress={progress} />}
      {children.map((child) => (
        <NodeView key={child.sub.id} node={child} onSelect={onSelect} />
      ))}
    </Collapsible>
  );
}

const EMPTY_SUBAGENTS: SubagentInfo[] = [];
const EMPTY_EVENTS: Record<string, SubagentLiveState> = {};

export function SubagentTree({
  headerLeading,
}: {
  headerLeading?: ReactNode;
} = {}) {
  const roster = useActiveSession((s) => s?.subagents ?? EMPTY_SUBAGENTS);
  const events = useActiveSession((s) => s?.subagentEvents ?? EMPTY_EVENTS);
  const sessionId = useActiveSession((s) => s?.sessionId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // chat.getSubagents returns the richer SubagentSnapshot at runtime; the slice
  // field type still reads as the legacy SubagentInfo. Cast once here (same
  // reference — erased at runtime, so memo deps stay stable).
  const subagents = roster as unknown as SubagentSnapshot[];
  const tree = useMemo(
    () => buildSubagentTree(subagents, events),
    [subagents, events],
  );
  const selected = selectedId
    ? subagents.find((s) => s.id === selectedId)
    : undefined;

  if (selected && sessionId) {
    return (
      <SubagentInspector
        subagent={selected}
        sessionId={sessionId}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <Panel
      title="Subagents"
      collapsible
      persistKey="chat.rail.subagents"
      headerLeading={headerLeading}
    >
      {tree.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="No subagents"
          hint="Spawned agents appear here."
        />
      ) : (
        <div className="space-y-1">
          {tree.map((node) => (
            <NodeView key={node.sub.id} node={node} onSelect={setSelectedId} />
          ))}
        </div>
      )}
    </Panel>
  );
}

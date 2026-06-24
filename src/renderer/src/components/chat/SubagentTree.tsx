// Feature 4 — the per-session subagent workflow tree. The roster from
// `chat.getSubagents` (SubagentSnapshot at runtime) is nested into a real tree:
// a subagent whose `parentToolCallId` was emitted by another subagent nests
// under it, everything else hangs off the session root. Each node shows the
// agent label, its source + status badges, and (when running) a live ticker
// driven by the reduced `AgentProgress`. Disclosure uses the shared Collapsible
// primitive (no hand-rolled <details>); the Eye action calls `onInspect` to open it.

import type {
  AgentProgress,
  AgentSource,
  SubagentInfo,
  SubagentSnapshot,
  ToolExecutionFrame,
} from "@shared/rpc";
import { Eye, Users } from "lucide-react";
import { type ReactNode, useMemo } from "react";
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

/** Max characters for a row/header label before it is truncated. */
const LABEL_MAX = 80;

/** The boilerplate prefix every delegated worker prompt opens with. */
const TASK_BOILERPLATE =
  /^\s*Complete the assignment below,?\s*thoroughly:?\s*/i;

function truncateLabel(text: string): string {
  return text.length > LABEL_MAX
    ? `${text.slice(0, LABEL_MAX).trimEnd()}…`
    : text;
}

/** First non-empty line of a block, sans leading markdown / list / punctuation. */
function firstMeaningfulLine(block: string): string {
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.replace(/^[\s#>*\-–—:.]+/, "").trim();
    if (line) return line;
  }
  return "";
}

/**
 * Distil a concise title from a worker's verbose assignment prompt: drop the
 * "Complete the assignment…" boilerplate, prefer the first clause of a
 * `# Target` section, else the first meaningful line. Never the whole prompt.
 */
function labelFromTask(task: string): string {
  const body = task.replace(TASK_BOILERPLATE, "");
  const target = body.match(/#+\s*Target\b[ \t:]*([\s\S]*?)(?:\r?\n\s*#|$)/i);
  const targetText = target?.[1];
  const candidate =
    (targetText && firstMeaningfulLine(targetText)) ||
    firstMeaningfulLine(body);
  return candidate.replace(/\s+/g, " ").trim();
}

/** Best human label for a subagent row / inspector header. */
export function subagentLabel(sub: SubagentSnapshot): string {
  const description = sub.description?.trim();
  if (description) return truncateLabel(description);

  const task = sub.task?.trim();
  if (task) {
    const label = labelFromTask(task);
    if (label) return truncateLabel(label);
  }

  return sub.agent || sub.id || "agent";
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
  onInspect,
}: {
  node: SubagentNode;
  onInspect: (id: string) => void;
}) {
  const { sub, progress, children } = node;
  const actions = (
    <>
      <Badge variant={SOURCE_VARIANT[sub.agentSource]}>{sub.agentSource}</Badge>
      <Badge variant={STATUS_VARIANT[sub.status]}>{sub.status}</Badge>
      <IconButton
        label={`Inspect ${subagentLabel(sub)}`}
        onClick={() => onInspect(sub.id)}
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
        <NodeView key={child.sub.id} node={child} onInspect={onInspect} />
      ))}
    </Collapsible>
  );
}

const EMPTY_SUBAGENTS: SubagentInfo[] = [];
const EMPTY_EVENTS: Record<string, SubagentLiveState> = {};

export function SubagentTree({
  headerLeading,
  onInspect,
}: {
  headerLeading?: ReactNode;
  onInspect: (subagentId: string) => void;
}) {
  const roster = useActiveSession((s) => s?.subagents ?? EMPTY_SUBAGENTS);
  const events = useActiveSession((s) => s?.subagentEvents ?? EMPTY_EVENTS);

  // chat.getSubagents returns the richer SubagentSnapshot at runtime; the slice
  // field type still reads as the legacy SubagentInfo. Cast once here (same
  // reference — erased at runtime, so memo deps stay stable).
  const subagents = roster as unknown as SubagentSnapshot[];
  const tree = useMemo(
    () => buildSubagentTree(subagents, events),
    [subagents, events],
  );

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
            <NodeView key={node.sub.id} node={node} onInspect={onInspect} />
          ))}
        </div>
      )}
    </Panel>
  );
}

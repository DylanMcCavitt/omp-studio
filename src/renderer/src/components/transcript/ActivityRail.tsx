// AGE-708 — Activity rail: a 248px right-column run-timeline of tool steps for
// long tool-heavy runs, rendered in the Live Dot status language (AGE-699).
//
// Steps are *derived* from the already-flowing transcript tool frames — assistant
// `toolCall` blocks resolved by either a reconciled `toolResult` message or the
// per-session live `toolRuns` record, so a step settles mid-stream. There is no
// session data model and nothing is persisted; this is a presentation-only view.
// The Focused layout (the existing MessageList) is left untouched; the rail is an
// additive column the header toggle shows or hides.

import type { WorkspaceColorKey } from "@shared/ipc";
import type { OmpMessage, ToolCallBlock, ToolResultMessage } from "@shared/rpc";
import { WorkspaceColorDot } from "@/components/workspace/WorkspaceColor";
import { cn } from "@/lib/cn";
import { workspaceColor } from "@/lib/workspaces";
import {
  type ActivityRunState,
  type SessionStatus,
  toContentBlocks,
} from "@/store/session-reducer";
import { argsPreview } from "./TranscriptView";

/** Which transcript layout the main header toggle selects. */
export type TranscriptMode = "focused" | "activity";

/** A single tool step's run state, mapped onto the Live Dot status triad. */
export type ActivityStepStatus = "done" | "running" | "queued";

/** One node on the Activity-rail timeline, derived from a transcript tool call. */
export interface ActivityStep {
  /** The tool call id (stable across frames; used as the React key). */
  id: string;
  /** Tool name shown as the node title. */
  title: string;
  /** Machine-readable detail line (args preview, or "error" on a failed call). */
  meta: string;
  status: ActivityStepStatus;
}

/** Map a step's run state onto the Live Dot fill (queued reuses the idle ring). */
const DOT_STATUS: Record<ActivityStepStatus, SessionStatus> = {
  done: "done",
  running: "running",
  queued: "idle",
};

/**
 * Derive the run-timeline from a session's transcript + live tool-run state.
 * Pure and framework-free: every assistant `toolCall` becomes a node, and its
 * status comes from whichever completion signal is available first —
 *
 *  - a reconciled `toolResult` message (authoritative, but only after turn end);
 *  - else the live `toolRuns` record the reducer keeps from the `tool_execution_*`
 *    frames, so a step goes `done`/`running` mid-stream without waiting on the
 *    end-of-turn reconcile (AGE-708);
 *  - else `queued`.
 */
export function deriveActivitySteps(
  messages: OmpMessage[],
  toolRuns: Record<string, ActivityRunState>,
): ActivityStep[] {
  const results = new Map<string, ToolResultMessage>();
  for (const m of messages) {
    if (m.role === "toolResult") results.set(m.toolCallId, m);
  }

  const steps: ActivityStep[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const block of toContentBlocks(m.content)) {
      if (block.type !== "toolCall") continue;
      const tc = block as ToolCallBlock;
      const result = results.get(tc.id);
      const run = toolRuns[tc.id];
      // A reconciled result wins; otherwise fall back to the live run record.
      const errored = result?.isError ?? run === "error";
      let status: ActivityStepStatus;
      if (result || run === "done" || run === "error") status = "done";
      else if (run === "running") status = "running";
      else status = "queued";
      steps.push({
        id: tc.id,
        title: tc.name,
        meta: errored ? "error" : argsPreview(tc.arguments),
        status,
      });
    }
  }

  return steps;
}

/** Footer summary, e.g. "3 done · 1 running"; omits any zero-count state. */
export function summarizeSteps(steps: ActivityStep[]): string {
  const counts: Record<ActivityStepStatus, number> = {
    done: 0,
    running: 0,
    queued: 0,
  };
  for (const s of steps) counts[s.status] += 1;
  const parts: string[] = [];
  if (counts.done) parts.push(`${counts.done} done`);
  if (counts.running) parts.push(`${counts.running} running`);
  if (counts.queued) parts.push(`${counts.queued} queued`);
  return parts.join(" · ");
}

const MODES: { value: TranscriptMode; label: string }[] = [
  { value: "focused", label: "Focused" },
  { value: "activity", label: "Activity rail" },
];

/**
 * The 2-segment Focused | Activity-rail control for the main transcript header.
 * Controlled; mirrors the sidebar's segmented toggle pattern (`aria-pressed`).
 */
export function TranscriptModeToggle({
  value,
  onChange,
}: {
  value: TranscriptMode;
  onChange: (mode: TranscriptMode) => void;
}) {
  return (
    <fieldset
      aria-label="Transcript layout"
      className="flex shrink-0 gap-1 rounded-lg border-0 bg-bg-panel p-1"
    >
      {MODES.map(({ value: v, label }) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(v)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              active
                ? "bg-bg-raised text-ink shadow-sm"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        );
      })}
    </fieldset>
  );
}

/** A single timeline node: status dot on the guideline + title + meta line. */
function ActivityNode({
  step,
  color,
}: {
  step: ActivityStep;
  color: WorkspaceColorKey | undefined;
}) {
  const running = step.status === "running";
  const done = step.status === "done";
  const queued = step.status === "queued";
  const swatch = workspaceColor(color)?.value;
  return (
    <li
      data-step-status={step.status}
      className={cn(
        "relative flex gap-2.5 pl-1",
        queued && "opacity-50",
        done && "opacity-60",
      )}
    >
      {/* Status dot, centered on the vertical guideline. */}
      <span className="relative z-10 mt-1 flex h-2 w-2 shrink-0 items-center justify-center">
        <WorkspaceColorDot color={color} status={DOT_STATUS[step.status]} />
      </span>
      <div className="min-w-0 flex-1 pb-3">
        <div
          className={cn(
            "truncate font-mono text-xs",
            running ? "font-semibold text-ink" : "text-ink-muted",
          )}
        >
          {step.title}
        </div>
        {step.meta && (
          <div
            className="truncate font-mono text-[10.5px] text-ink-faint"
            style={running && swatch ? { color: swatch } : undefined}
          >
            {step.meta}
          </div>
        )}
        {running && (
          <div
            className="mt-0.5 animate-omp-blink font-mono text-[10.5px]"
            style={swatch ? { color: swatch } : undefined}
          >
            running…
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * The Activity rail column. Renders a vertical guideline with one node per tool
 * step and a footer count. Fixed 248px wide per the spec; the caller decides
 * whether to mount it (the header toggle).
 */
export function ActivityRail({
  steps,
  color,
}: {
  steps: ActivityStep[];
  color: WorkspaceColorKey | undefined;
}) {
  const summary = summarizeSteps(steps);
  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-l border-border-subtle bg-bg-panel/40">
      <div className="border-b border-border-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
        Run activity
      </div>
      <div className="scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {steps.length === 0 ? (
          <div className="font-mono text-xs text-ink-faint">
            No tool steps yet.
          </div>
        ) : (
          <ol className="relative">
            {/* The vertical guideline behind the dots. */}
            <span
              aria-hidden
              className="absolute bottom-2 left-[7px] top-2 w-px bg-border-subtle"
            />
            {steps.map((step) => (
              <ActivityNode key={step.id} step={step} color={color} />
            ))}
          </ol>
        )}
      </div>
      <div className="border-t border-border-subtle px-3 py-2 font-mono text-[10.5px] text-ink-muted">
        {summary || "0 steps"}
      </div>
    </aside>
  );
}

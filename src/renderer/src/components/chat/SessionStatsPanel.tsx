// Right-rail session usage panel + the compact header context-meter chip.
//
// Both surfaces read the active session's permissive `SessionStats` snapshot
// (tokens/cost/contextUsage + unknown future keys) plus slice-level fields
// (message count, queued follow-ups, compaction state). Only fields actually
// present are rendered, so an empty/unknown stats snapshot degrades gracefully
// rather than showing zeros. Stats refresh on turn end and after compaction
// (driven by the store); the panel adds a manual refresh button and the
// `Compact…` action that opens the CompactDialog.

import type { ContextUsage, SessionStats } from "@shared/rpc";
import { Minimize2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { CompactDialog } from "@/components/chat/CompactDialog";
import { Button, IconButton, Panel, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { useActiveSession, useChatStore } from "@/store/chat";

/** Derived numeric view of the active session's stats, read permissively. */
interface StatsView {
  contextUsage?: ContextUsage;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
}

/** First finite numeric value among the candidate keys, else undefined. */
function readNumber(
  stats: SessionStats | undefined,
  keys: string[],
): number | undefined {
  if (!stats) return undefined;
  for (const key of keys) {
    const value = stats[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

/** Read the active session's stats slice into a stable derived view. */
function useStatsView(): StatsView {
  const stats = useActiveSession((s) => s?.stats);
  const sliceContext = useActiveSession((s) => s?.contextUsage);
  return {
    contextUsage: stats?.contextUsage ?? sliceContext,
    totalTokens: readNumber(stats, ["tokens", "totalTokens", "total_tokens"]),
    inputTokens: readNumber(stats, [
      "inputTokens",
      "input_tokens",
      "promptTokens",
      "prompt_tokens",
    ]),
    outputTokens: readNumber(stats, [
      "outputTokens",
      "output_tokens",
      "completionTokens",
      "completion_tokens",
    ]),
    cost: readNumber(stats, ["cost", "totalCost", "total_cost"]),
  };
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, percent));
}

/** Bar fill colour escalates as the context window fills. */
function meterColor(percent: number): string {
  if (percent >= 90) return "bg-danger";
  if (percent >= 70) return "bg-warn";
  return "bg-accent";
}

/** `$0.0123` for sub-dollar amounts, `$1.23` once it crosses a dollar. */
function formatCost(cost: number): string {
  return cost >= 1 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(4)}`;
}

/** Compact token count for the header chip, e.g. `12.3k`. */
function formatCompactTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  const thousands = tokens / 1000;
  return `${thousands.toFixed(thousands >= 100 ? 0 : 1)}k`;
}

function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-mono tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function ContextMeter({ usage }: { usage: ContextUsage }) {
  const pct = clampPercent(usage.percent);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-muted">Context</span>
        <span className="font-mono tabular-nums text-ink-muted">
          {Math.round(pct)}%
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-bg-hover"
        role="progressbar"
        aria-label="Context window usage"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full rounded-full transition-all", meterColor(pct))}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[0.7rem] tabular-nums text-ink-faint">
        {formatNumber(usage.tokens)} / {formatNumber(usage.contextWindow)}{" "}
        tokens
      </div>
    </div>
  );
}

/**
 * Compact context-meter chip for the chat pane header: a tiny usage bar plus
 * token/cost when known. Reads the active session, so it renders nothing until
 * any usage is available.
 */
export function ContextMeterChip() {
  const view = useStatsView();
  const usage = view.contextUsage;
  const tokens = view.totalTokens ?? usage?.tokens;
  const cost = view.cost;
  if (!usage && tokens == null && cost == null) return null;

  return (
    <div className="ml-auto flex items-center gap-2 text-xs text-ink-faint">
      {usage && (
        <span
          className="flex items-center gap-1.5"
          title={`${formatNumber(usage.tokens)} / ${formatNumber(
            usage.contextWindow,
          )} context tokens`}
        >
          <span className="block h-1.5 w-14 overflow-hidden rounded-full bg-bg-hover">
            <span
              className={cn(
                "block h-full rounded-full",
                meterColor(clampPercent(usage.percent)),
              )}
              style={{ width: `${clampPercent(usage.percent)}%` }}
            />
          </span>
          <span className="tabular-nums">
            {Math.round(clampPercent(usage.percent))}%
          </span>
        </span>
      )}
      {tokens != null && (
        <span className="tabular-nums">{formatCompactTokens(tokens)} tok</span>
      )}
      {cost != null && <span className="tabular-nums">{formatCost(cost)}</span>}
    </div>
  );
}

export function SessionStatsPanel({ sessionId }: { sessionId: string }) {
  const view = useStatsView();
  const messageCount = useActiveSession((s) => s?.messages.length ?? 0);
  const queuedCount = useActiveSession((s) => s?.queuedCount ?? 0);
  const isCompacting = useActiveSession((s) => s?.isCompacting ?? false);
  const compacting = useActiveSession((s) => s?.compacting ?? false);
  const refreshStats = useChatStore((s) => s.refreshStats);
  const [refreshing, setRefreshing] = useState(false);
  const [showCompact, setShowCompact] = useState(false);

  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshStats(sessionId);
    } finally {
      setRefreshing(false);
    }
  };

  const busy = compacting || isCompacting;
  const hasUsage =
    Boolean(view.contextUsage) ||
    view.totalTokens != null ||
    view.inputTokens != null ||
    view.outputTokens != null ||
    view.cost != null;

  return (
    <Panel
      title="Usage"
      actions={
        <IconButton
          label="Refresh stats"
          onClick={() => void onRefresh()}
          disabled={refreshing}
          className="h-7 w-7"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
          />
        </IconButton>
      }
      bodyClassName="space-y-3 p-4"
    >
      {busy && (
        <div className="flex items-center gap-2 rounded-md border border-thinking/30 bg-thinking/10 px-2.5 py-1.5 text-xs text-thinking">
          <Spinner size={12} className="text-thinking" />
          Compacting context…
        </div>
      )}

      {view.contextUsage && <ContextMeter usage={view.contextUsage} />}

      <dl className="space-y-1.5 text-sm">
        {view.totalTokens != null && (
          <StatRow
            label="Total tokens"
            value={formatNumber(view.totalTokens)}
          />
        )}
        {view.inputTokens != null && (
          <StatRow
            label="Input tokens"
            value={formatNumber(view.inputTokens)}
          />
        )}
        {view.outputTokens != null && (
          <StatRow
            label="Output tokens"
            value={formatNumber(view.outputTokens)}
          />
        )}
        {view.cost != null && (
          <StatRow label="Est. cost" value={formatCost(view.cost)} />
        )}
        <StatRow label="Messages" value={formatNumber(messageCount)} />
        <StatRow label="Queued follow-ups" value={formatNumber(queuedCount)} />
      </dl>

      {!hasUsage && !busy && (
        <p className="text-xs text-ink-faint">
          No usage stats yet — they populate after the first turn.
        </p>
      )}

      <Button
        variant="subtle"
        size="sm"
        className="w-full justify-center"
        onClick={() => setShowCompact(true)}
        disabled={busy}
      >
        <Minimize2 className="h-3.5 w-3.5" />
        Compact…
      </Button>

      {showCompact && (
        <CompactDialog
          sessionId={sessionId}
          onClose={() => setShowCompact(false)}
        />
      )}
    </Panel>
  );
}

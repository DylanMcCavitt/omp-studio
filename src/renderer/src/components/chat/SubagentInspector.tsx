// Feature 4 — the subagent drill-in pane. Renders the selected subagent's
// transcript (via the shared TranscriptView) plus a live progress/event feed,
// degrading honestly per the matrix:
//   - no sessionFile        → progress-only (ticker + feed, "no transcript yet")
//   - completed + file      → readSession() once; empty/failed → EmptyState
//   - live + file           → chat.getSubagentMessages cursor, appended on each
//                             incoming frame (event-driven, never polled); a
//                             reset clears + restarts the buffer (store-owned).
// "Open in Sessions" hands the absolute sessionFile to the existing focusSession
// plumbing for the full-width history view.

import type { AgentProgress, RpcFrame, SubagentSnapshot } from "@shared/rpc";
import {
  ArrowLeft,
  MessageSquareDashed,
  SquareArrowOutUpRight,
  TriangleAlert,
} from "lucide-react";
import { useEffect } from "react";
import { TranscriptView } from "@/components/transcript/TranscriptView";
import { Badge, EmptyState, IconButton, Panel, Spinner } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { useAppStore } from "@/store/app";
import { useActiveSession, useChatStore } from "@/store/chat";
import { SOURCE_VARIANT, STATUS_VARIANT, subagentLabel } from "./SubagentTree";

const EMPTY_FRAMES: RpcFrame[] = [];

function ProgressDetail({ progress }: { progress: AgentProgress }) {
  return (
    <div className="space-y-1 rounded-md border border-border-subtle bg-bg-raised p-2 text-xs">
      {progress.lastIntent && (
        <div className="italic text-ink-muted">{progress.lastIntent}</div>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-ink-faint">
        {progress.currentTool && (
          <span>
            tool{" "}
            <span className="font-mono text-ink-muted">
              {progress.currentTool}
            </span>
          </span>
        )}
        <span>{progress.toolCount} tools</span>
        <span>{formatNumber(progress.tokens)} tok</span>
        <span>{progress.requests} req</span>
      </div>
    </div>
  );
}

function EventFeed({ events }: { events: RpcFrame[] }) {
  if (events.length === 0) return null;
  // Newest first, bounded — these are already capped in the reducer.
  const recent = events.slice(-40).reverse();
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-ink-muted">Live events</div>
      <div className="scrollbar max-h-40 space-y-0.5 overflow-y-auto">
        {recent.map((frame, i) => {
          const tool = (frame as { toolName?: string }).toolName;
          const label =
            tool && frame.type.startsWith("tool_execution")
              ? `${frame.type} · ${tool}`
              : frame.type;
          return (
            <div key={i} className="truncate font-mono text-xs text-ink-faint">
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LiveTranscript({
  sessionId,
  subagentId,
  sessionFile,
}: {
  sessionId: string;
  subagentId: string;
  sessionFile: string;
}) {
  const openInspector = useChatStore((s) => s.openSubagentInspector);
  const closeInspector = useChatStore((s) => s.closeSubagentInspector);
  const insp = useChatStore((s) => s._subagentInspector);

  // Watch this subagent's live JSONL while the pane is open; the store pumps the
  // cursor on each incoming frame and drops the buffer on unmount.
  useEffect(() => {
    openInspector(sessionId, subagentId, { sessionFile, live: true });
    return () => closeInspector();
  }, [sessionId, subagentId, sessionFile, openInspector, closeInspector]);

  if (
    !insp ||
    insp.subagentId !== subagentId ||
    insp.sessionId !== sessionId ||
    (!insp.started && insp.loading)
  ) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }
  if (insp.error && insp.messages.length === 0) {
    return (
      <EmptyState
        icon={<TriangleAlert className="h-6 w-6" />}
        title="Couldn't read the live transcript"
        hint={insp.error}
      />
    );
  }
  return (
    <>
      <TranscriptView
        messages={insp.messages}
        emptyTitle="Waiting for the subagent's first messages…"
      />
      {insp.error && (
        <p className="mt-2 text-xs text-ink-faint">
          Live updates paused — {insp.error}
        </p>
      )}
    </>
  );
}

function CompletedTranscript({ sessionFile }: { sessionFile: string }) {
  const { data, loading, error } = useAsync(
    () => window.omp.readSession(sessionFile),
    [sessionFile],
  );
  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }
  // readSession degrades to an empty placeholder rather than throwing, so an
  // empty result is also a "couldn't read it" — surface it, never a blank pane.
  if (error || !data || data.messages.length === 0) {
    return (
      <EmptyState
        icon={<TriangleAlert className="h-6 w-6" />}
        title="Transcript unavailable"
        hint={
          error ?? "The subagent's session file is empty or could not be read."
        }
      />
    );
  }
  return <TranscriptView messages={data.messages} />;
}

export function SubagentInspector({
  subagent,
  sessionId,
  onBack,
}: {
  subagent: SubagentSnapshot;
  sessionId: string;
  onBack: () => void;
}) {
  const id = subagent.id;
  const { status, sessionFile } = subagent;
  const live = status === "running" || status === "pending";
  const progress =
    useActiveSession((s) => s?.subagentEvents[id]?.progress) ??
    subagent.progress;
  const events = useActiveSession(
    (s) => s?.subagentEvents[id]?.events ?? EMPTY_FRAMES,
  );
  const focusSession = useAppStore((s) => s.focusSession);

  return (
    <Panel
      title={subagentLabel(subagent)}
      actions={
        <>
          <IconButton label="Back to subagents" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
          {sessionFile && (
            <IconButton
              label="Open in Sessions"
              onClick={() =>
                focusSession({ path: sessionFile, messageIndex: -1 })
              }
            >
              <SquareArrowOutUpRight className="h-4 w-4" />
            </IconButton>
          )}
        </>
      }
      bodyClassName="scrollbar max-h-[28rem] space-y-3 overflow-y-auto p-4"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={SOURCE_VARIANT[subagent.agentSource]}>
          {subagent.agentSource}
        </Badge>
        <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>
        <span className="font-mono text-xs text-ink-faint">
          {subagent.agent}
        </span>
      </div>

      {progress && <ProgressDetail progress={progress} />}

      {!sessionFile ? (
        <EmptyState
          icon={<MessageSquareDashed className="h-6 w-6" />}
          title="Transcript not available yet"
          hint="This subagent hasn't written a session file."
        />
      ) : live ? (
        <LiveTranscript
          sessionId={sessionId}
          subagentId={id}
          sessionFile={sessionFile}
        />
      ) : (
        <CompletedTranscript sessionFile={sessionFile} />
      )}

      {live && <EventFeed events={events} />}
    </Panel>
  );
}

// AGE-779 — the agent drop routing chooser. Dropping an agent on the composer
// no longer commits to anything: this card previews the exact steering prompt
// and offers explicit targets — Steer (insert editable text, the pre-AGE-779
// path), Queue (follow-up while streaming), Run in parallel (fresh session in
// the same workspace, first prompt = the preview), and Open in pane (parallel
// session pinned into a split pane, never replacing this chat). Esc, the
// backdrop, or Cancel dismiss as a clean no-op.
//
// The chooser is rendered by the chat Composer inside a `relative` wrapper and
// anchors above the input like the slash palette. Routing goes through the
// chat store (`send`, `startParallelChat`) and `openPaneWithFeedback` — no
// parallel DnD or spawn lane.

import { Columns2, ListEnd, MessagesSquare, Navigation } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { openPaneWithFeedback } from "@/components/shell/pane-actions";
import { Button } from "@/components/ui";
import { type AgentDragPayload, agentSteeringText } from "@/lib/agentDrag";
import { useChatStore, useSession } from "@/store/chat";
import { layoutPaneIds, MAX_PANES, usePaneStore } from "@/store/panes";
import { toast } from "@/store/toast";

export interface AgentDropChooserProps {
  payload: AgentDragPayload;
  /** The session of the composer the agent was dropped on. */
  sessionId: string;
  /** Adopt the steering text into the composer (editable, not submitted). */
  onSteer: (text: string) => void;
  /** Dismiss the chooser (after a route or as a cancel no-op). */
  onClose: () => void;
}

function ChooserOption({
  icon,
  title,
  description,
  disabledReason,
  disabled,
  onClick,
  autoFocusRef,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  /** Shown instead of `description` while the option is unavailable. */
  disabledReason?: string;
  disabled: boolean;
  onClick: () => void;
  autoFocusRef?: RefObject<HTMLButtonElement>;
}) {
  return (
    <button
      ref={autoFocusRef}
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="mt-0.5 shrink-0 text-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{title}</span>
        <span className="block line-clamp-2 text-xs text-ink-muted">
          {disabled && disabledReason ? disabledReason : description}
        </span>
      </span>
    </button>
  );
}

export function AgentDropChooser({
  payload,
  sessionId,
  onSteer,
  onClose,
}: AgentDropChooserProps) {
  const streaming = useSession(sessionId, (s) => s?.status === "streaming");
  const cwd = useSession(sessionId, (s) => s?.cwd);
  const send = useChatStore((s) => s.send);
  const startParallelChat = useChatStore((s) => s.startParallelChat);
  const panesAvailable = usePaneStore(
    (s) => layoutPaneIds(s.layout).length < MAX_PANES,
  );
  const [busy, setBusy] = useState(false);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const text = agentSteeringText(payload);

  // Keyboard path: focus the first option so ↹/Enter work immediately and Esc
  // (handled on the dialog) can dismiss without touching the mouse.
  useEffect(() => {
    firstOptionRef.current?.focus();
  }, []);

  // Serialize routing: one click commits one route, then the chooser closes.
  const route = (fn: () => Promise<void> | void) => () => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        await fn();
      } finally {
        setBusy(false);
        onClose();
      }
    })();
  };

  const startParallel = async (): Promise<string | null> => {
    const id = await startParallelChat(text, { cwd });
    if (!id) {
      toast.error("Couldn't start a parallel chat", {
        detail:
          useChatStore.getState().createError ??
          "No workspace is available to spawn in.",
      });
    }
    return id;
  };

  return (
    <>
      {/* Click-away backdrop — dismissing is a safe no-op. */}
      <button
        type="button"
        aria-label="Dismiss agent routing"
        className="fixed inset-0 z-30 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={`Route agent ${payload.name}`}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        className="absolute inset-x-0 bottom-full z-40 mb-2 overflow-hidden rounded-xl border border-border-strong bg-bg-panel shadow-panel"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink"
            title={`${payload.name} (${payload.source})`}>
            Drop <span className="font-mono">{payload.name}</span>
            <span className="ml-1.5 text-xs font-normal text-ink-muted">
              {payload.source} agent
            </span>
          </span>
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
        </div>

        {/* The exact prompt every target uses — no hidden steering text. */}
        <div className="border-b border-border px-3 py-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-faint">
            Prompt preview
          </div>
          <pre className="scrollbar max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-bg-raised px-2.5 py-1.5 font-mono text-xs text-ink-muted [overflow-wrap:anywhere]">
            {text}
          </pre>
        </div>

        <div className="p-1.5">
          <ChooserOption
            autoFocusRef={firstOptionRef}
            icon={<Navigation className="h-4 w-4" />}
            title="Steer current response"
            description="Insert the prompt into the composer to edit — nothing is sent until you submit."
            disabled={busy}
            onClick={route(() => {
              onSteer(text);
            })}
          />
          <ChooserOption
            icon={<ListEnd className="h-4 w-4" />}
            title="Queue after current response"
            description="Send the prompt now as a follow-up; it runs when the current response finishes."
            disabledReason="Nothing is streaming — steer instead, or run in parallel."
            disabled={busy || !streaming}
            onClick={route(async () => {
              const ok = await send(text, undefined, sessionId);
              if (ok) {
                toast.success(`Queued ${payload.name} after this response`);
              } else {
                toast.error("Couldn't queue the prompt");
              }
            })}
          />
          <ChooserOption
            icon={<MessagesSquare className="h-4 w-4" />}
            title="Run in parallel"
            description="Start a new chat in this workspace and send the prompt there. This chat stays put."
            disabled={busy}
            onClick={route(async () => {
              const id = await startParallel();
              if (id) {
                toast.success(`Started ${payload.name} in a parallel chat`, {
                  action: {
                    label: "Show",
                    onClick: () => useChatStore.getState().openChat(id),
                  },
                });
              }
            })}
          />
          <ChooserOption
            icon={<Columns2 className="h-4 w-4" />}
            title="Open in pane"
            description="Run in parallel and pin the new chat in a split pane beside this one."
            disabledReason={`Pane limit reached — up to ${MAX_PANES} panes can be open.`}
            disabled={busy || !panesAvailable}
            onClick={route(async () => {
              const id = await startParallel();
              if (id) openPaneWithFeedback({ kind: "chat", sessionId: id });
            })}
          />
        </div>
      </div>
    </>
  );
}

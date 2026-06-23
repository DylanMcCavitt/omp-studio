// Manual context-compaction dialog. Compaction summarizes the session's context
// to reclaim window space; it changes only what the agent keeps in context — the
// on-disk JSONL transcript is never modified. Optional instructions steer how the
// summary is written. While the command is in flight an overlay blocks input and
// the panel/badge reflect the compacting state via the slice's `compacting` flag.

import { Minimize2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { useActiveSession, useChatStore } from "@/store/chat";

export function CompactDialog({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const compact = useChatStore((s) => s.compact);
  const compacting = useActiveSession((s) => s?.compacting ?? false);
  const [instructions, setInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Focus the instructions field on open, trap Tab, and restore focus on close.
  const dialogRef = useFocusTrap<HTMLDivElement>();

  // Escape cancels (unless mid-compaction).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const busy = submitting || compacting;

  const onCompact = async () => {
    if (busy) return;
    setSubmitting(true);
    try {
      await compact(sessionId, instructions.trim() || undefined);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compact-title"
        aria-describedby="compact-note"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-xl border border-border bg-bg-panel p-5 shadow-panel focus:outline-none"
      >
        <div className="mb-3 flex items-center gap-2 text-ink">
          <Minimize2 className="h-5 w-5 shrink-0 text-accent" />
          <h2 id="compact-title" className="text-sm font-semibold">
            Compact context
          </h2>
        </div>
        <p id="compact-note" className="mb-4 text-sm text-ink-muted">
          Compaction summarizes this session's context to free up the context
          window. It changes only what the agent keeps in context — your saved
          transcript on disk is not modified.
        </p>

        <label
          htmlFor="compact-instructions"
          className="mb-1.5 block text-xs font-medium text-ink-muted"
        >
          Custom instructions (optional)
        </label>
        <textarea
          id="compact-instructions"
          data-autofocus
          value={instructions}
          rows={3}
          disabled={busy}
          placeholder="e.g. Keep the API design decisions and open TODOs…"
          onChange={(e) => setInstructions(e.target.value)}
          className="scrollbar w-full resize-none rounded-lg border border-border-subtle bg-bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none disabled:opacity-50"
        />

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void onCompact()}
            disabled={busy}
          >
            <span className="flex items-center gap-1.5">
              {busy && <Spinner size={12} />}
              {busy ? "Compacting…" : "Compact"}
            </span>
          </Button>
        </div>

        {busy && (
          <div className="absolute inset-0 grid place-items-center rounded-xl bg-bg-panel/70">
            <div className="flex items-center gap-2 text-sm text-ink-muted">
              <Spinner size={16} />
              Compacting context…
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Modal for renaming a session. Renaming sets a studio-side display alias keyed
// by the JSONL path — it never rewrites the on-disk transcript. An empty name
// clears any custom alias and restores the session's original header title.
// Matches the app's existing modal behaviour (focus on open, Escape to cancel).

import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

export function RenameSessionDialog({
  initialTitle,
  onSubmit,
  onClose,
}: {
  initialTitle: string | null;
  /** Persist the new title (trimmed); an empty string clears the alias. */
  onSubmit: (title: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialTitle ?? "");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(value.trim());
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-title"
        aria-describedby="rename-note"
        className="w-full max-w-md rounded-xl border border-border bg-bg-panel p-5 shadow-panel"
      >
        <div className="mb-3 flex items-center gap-2 text-ink">
          <Pencil className="h-5 w-5 shrink-0 text-accent" />
          <h2 id="rename-title" className="text-sm font-semibold">
            Rename session
          </h2>
        </div>
        <p id="rename-note" className="mb-4 text-sm text-ink-muted">
          Sets a studio display name for this session. Your saved transcript on
          disk is not modified. Leave it blank to clear a custom name.
        </p>

        <label
          htmlFor="rename-input"
          className="mb-1.5 block text-xs font-medium text-ink-muted"
        >
          Name
        </label>
        <input
          id="rename-input"
          ref={inputRef}
          value={value}
          disabled={submitting}
          placeholder="e.g. Auth refactor"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          className="w-full rounded-lg border border-border-subtle bg-bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none disabled:opacity-50"
        />

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="subtle" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={submitting}
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Editor dialog (method "editor"). A multiline textarea prefilled from the
// request's `prefill`. Enter inserts a newline; Cmd/Ctrl+Enter submits the
// value as {value}; Esc cancels.

import type { ExtensionUiRequest, ExtensionUiResponse } from "@shared/rpc";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { asString } from "./logic";
import { ModalShell } from "./ModalShell";

export interface EditorRequestDialogProps {
  request: ExtensionUiRequest;
  onResolve(response: ExtensionUiResponse): void;
}

export function EditorRequestDialog({
  request,
  onResolve,
}: EditorRequestDialogProps) {
  const [value, setValue] = useState(asString(request.prefill) ?? "");

  return (
    <ModalShell
      title={asString(request.title) ?? "Edit text"}
      message={asString(request.message)}
      kicker={<Badge variant="accent">Editor</Badge>}
      onDismiss={() => onResolve({ cancelled: true })}
      onSubmit={() => onResolve({ value })}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => onResolve({ cancelled: true })}
          >
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onResolve({ value })}>
            Submit
          </Button>
        </>
      }
    >
      <textarea
        data-autofocus
        value={value}
        rows={8}
        onChange={(e) => setValue(e.target.value)}
        className="scrollbar w-full resize-none rounded-lg border border-border-subtle bg-bg-raised px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />
      <p className="mt-2 text-xs text-ink-faint">
        Press <kbd className="font-mono">⌘/Ctrl + Enter</kbd> to submit.
      </p>
    </ModalShell>
  );
}

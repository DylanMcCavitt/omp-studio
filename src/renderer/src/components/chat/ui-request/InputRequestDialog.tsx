// Input dialog (method "input"). A single-line text field; Enter or Cmd/Ctrl+
// Enter submit the current value as {value}, Esc cancels. The placeholder comes
// from the request when provided.

import type { ExtensionUiRequest, ExtensionUiResponse } from "@shared/rpc";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { asString } from "./logic";
import { ModalShell } from "./ModalShell";

export interface InputRequestDialogProps {
  request: ExtensionUiRequest;
  onResolve(response: ExtensionUiResponse): void;
}

export function InputRequestDialog({
  request,
  onResolve,
}: InputRequestDialogProps) {
  const [value, setValue] = useState("");

  return (
    <ModalShell
      title={asString(request.title) ?? "Enter a value"}
      message={asString(request.message)}
      kicker={<Badge variant="accent">Input</Badge>}
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
      <input
        data-autofocus
        type="text"
        value={value}
        placeholder={asString(request.placeholder)}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onResolve({ value });
          }
        }}
        className="w-full rounded-lg border border-border-subtle bg-bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />
    </ModalShell>
  );
}

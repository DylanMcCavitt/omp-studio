// Select dialog (method "select"). Renders the request's `options` as a
// keyboard-navigable listbox: Up/Down move the highlight, Enter or Cmd/Ctrl+
// Enter submit the highlighted option as {value}, Esc cancels. The response
// value is the chosen option string (matching omp's select contract).

import type { ExtensionUiRequest, ExtensionUiResponse } from "@shared/rpc";
import { useEffect, useRef, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { asString } from "./logic";
import { ModalShell } from "./ModalShell";

export interface SelectRequestDialogProps {
  request: ExtensionUiRequest;
  onResolve(response: ExtensionUiResponse): void;
}

export function SelectRequestDialog({
  request,
  onResolve,
}: SelectRequestDialogProps) {
  const options = Array.isArray(request.options)
    ? request.options.filter((o): o is string => typeof o === "string")
    : [];
  const [highlighted, setHighlighted] = useState(0);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Keep the highlighted row in view as the user arrows through a long list.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const submit = (index: number) => {
    const value = options[index];
    if (value !== undefined) onResolve({ value });
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlighted(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlighted(options.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit(highlighted);
    }
  };

  return (
    <ModalShell
      title={asString(request.title) ?? "Choose an option"}
      kicker={<Badge variant="accent">Select</Badge>}
      onDismiss={() => onResolve({ cancelled: true })}
      onSubmit={() => submit(highlighted)}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => onResolve({ cancelled: true })}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={options.length === 0}
            onClick={() => submit(highlighted)}
          >
            Select
          </Button>
        </>
      }
    >
      {options.length === 0 ? (
        <p className="text-sm text-ink-muted">No options were provided.</p>
      ) : (
        <div
          role="listbox"
          aria-label={asString(request.title) ?? "Options"}
          tabIndex={0}
          data-autofocus
          onKeyDown={onListKeyDown}
          className="scrollbar max-h-64 space-y-1 overflow-y-auto rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {options.map((option, index) => (
            <button
              key={option}
              ref={index === highlighted ? activeRef : undefined}
              type="button"
              role="option"
              aria-selected={index === highlighted}
              onClick={() => setHighlighted(index)}
              onDoubleClick={() => submit(index)}
              className={cn(
                "block w-full truncate rounded-md px-3 py-2 text-left text-sm",
                index === highlighted
                  ? "bg-accent-soft text-accent"
                  : "text-ink hover:bg-bg-hover",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

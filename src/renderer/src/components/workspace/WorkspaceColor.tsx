// AGE-671 — shared per-workspace color UI: a small swatch dot and the swatch
// picker reused by the Add dialog (inline) and the Manage-workspaces row (in a
// Popover). The curated key persists on the Workspace; `workspaceColorValue`
// maps it to its renderer-only CSS swatch.

import type { WorkspaceColorKey } from "@shared/ipc";
import { Ban } from "lucide-react";
import { cn } from "@/lib/cn";
import { WORKSPACE_COLORS, workspaceColorValue } from "@/lib/workspaces";

/** A small round swatch for a workspace color; a hollow ring when none is set. */
export function WorkspaceColorDot({
  color,
  className,
}: {
  color: WorkspaceColorKey | undefined;
  className?: string;
}) {
  const value = workspaceColorValue(color);
  return (
    <span
      aria-hidden
      className={cn(
        "h-2.5 w-2.5 shrink-0 rounded-full",
        value
          ? "ring-1 ring-inset ring-black/20"
          : "border border-border-strong",
        className,
      )}
      style={value ? { backgroundColor: value } : undefined}
    />
  );
}

/** A row of selectable color swatches plus a "no color" option (controlled). */
export function WorkspaceColorPicker({
  value,
  onChange,
}: {
  value: WorkspaceColorKey | undefined;
  onChange: (color: WorkspaceColorKey | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-label="No color"
        aria-pressed={value == null}
        onClick={() => onChange(undefined)}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full border border-border-strong text-ink-faint transition-colors hover:text-ink",
          value == null && "ring-2 ring-accent ring-offset-1 ring-offset-bg",
        )}
      >
        <Ban className="h-3.5 w-3.5" />
      </button>
      {WORKSPACE_COLORS.map((c) => (
        <button
          key={c.key}
          type="button"
          aria-label={c.label}
          aria-pressed={value === c.key}
          onClick={() => onChange(c.key)}
          style={{ backgroundColor: c.value }}
          className={cn(
            "h-6 w-6 rounded-full ring-1 ring-inset ring-black/20 transition-transform hover:scale-110",
            value === c.key &&
              "ring-2 ring-accent ring-offset-1 ring-offset-bg",
          )}
        />
      ))}
    </div>
  );
}

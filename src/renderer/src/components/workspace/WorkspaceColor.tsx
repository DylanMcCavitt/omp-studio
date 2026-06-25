// AGE-671/AGE-699 — shared per-workspace color UI: the Live Dot and the swatch
// picker reused by the Add dialog (inline) and the Manage-workspaces row (in a
// Popover). The curated key persists on the Workspace; `workspaceColor` maps it
// to its renderer-only swatch + derived Live-Dot tokens (glow/border).

import type { WorkspaceColorKey } from "@shared/ipc";
import { Ban } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { WORKSPACE_COLORS, workspaceColor } from "@/lib/workspaces";
import type { SessionStatus } from "@/store/session-reducer";

/**
 * A small round Live Dot (AGE-699): hue = workspace identity, fill = status.
 *
 * Identity mode (no `status`) keeps AGE-671 behavior — a solid swatch when a
 * color is set, a hollow ring when not — at today's 10px so existing callers
 * (switcher, picker, session rows) are visually unchanged.
 *
 * Status mode (`status` set; needs a `color`) renders the three fills:
 *   - running: solid swatch + an expanding `ompPulse` ring in the workspace glow
 *   - idle:    hollow ring (`inset 0 0 0 1.5px <ws>`)
 *   - done:    solid swatch faded to .3
 * Status dots default to 8px; pass `size` (7–9) to override. Falls back to
 * identity rendering when a status is requested without a color.
 */
export function WorkspaceColorDot({
  color,
  status,
  size,
  className,
}: {
  color: WorkspaceColorKey | undefined;
  status?: SessionStatus;
  size?: number;
  className?: string;
}) {
  const tokens = workspaceColor(color);
  const value = tokens?.value;
  // Identity mode keeps the legacy Tailwind size (h-2.5 w-2.5 = 10px); status
  // dots default to the spec's 8px. An explicit `size` overrides either.
  const px = size ?? (status === undefined ? undefined : 8);
  const sizeClass = px === undefined ? "h-2.5 w-2.5" : undefined;
  const sizeStyle: CSSProperties =
    px === undefined ? {} : { width: px, height: px };

  if (status && value && tokens) {
    let style: CSSProperties;
    let stateClass: string | undefined;
    if (status === "running") {
      style = {
        ...sizeStyle,
        backgroundColor: value,
        "--omp-glow": tokens.glow,
      } as CSSProperties;
      stateClass = "animate-omp-pulse";
    } else if (status === "idle") {
      style = { ...sizeStyle, boxShadow: `inset 0 0 0 1.5px ${value}` };
    } else {
      style = { ...sizeStyle, backgroundColor: value, opacity: 0.3 };
    }
    return (
      <span
        aria-hidden
        data-status={status}
        className={cn(
          "shrink-0 rounded-full",
          sizeClass,
          stateClass,
          className,
        )}
        style={style}
      />
    );
  }

  // Identity mode (AGE-671): solid swatch when set, hollow ring when not.
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0 rounded-full",
        sizeClass,
        value
          ? "ring-1 ring-inset ring-black/20"
          : "border border-border-strong",
        className,
      )}
      style={{ ...sizeStyle, ...(value ? { backgroundColor: value } : {}) }}
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

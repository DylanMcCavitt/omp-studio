// The draggable divider between two resizable panels (feature 5). Thin wrapper
// over `react-resizable-panels`' PanelResizeHandle that gives it our cockpit
// styling: a transparent hit target with a hairline grip that tints on
// hover/drag (driven by the lib's `data-resize-handle-state` attribute) and a
// double-click-to-reset affordance the parent wires to its default layout.

import { PanelResizeHandle } from "react-resizable-panels";
import { cn } from "@/lib/cn";

export interface ResizeHandleProps {
  /** Orientation of the parent PanelGroup — sets the handle's resize axis. */
  direction?: "horizontal" | "vertical";
  /** Restore the default split (wired to PanelGroup's imperative setLayout). */
  onReset?: () => void;
  /** Accessible name for the separator. */
  ariaLabel?: string;
  className?: string;
}

export function ResizeHandle({
  direction = "horizontal",
  onReset,
  ariaLabel,
  className,
}: ResizeHandleProps) {
  const horizontal = direction === "horizontal";
  return (
    <PanelResizeHandle
      onDoubleClick={onReset}
      aria-label={ariaLabel}
      title={onReset ? "Drag to resize · double-click to reset" : undefined}
      className={cn(
        "group/resize relative flex shrink-0 items-center justify-center outline-none transition-colors",
        horizontal ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize",
        "data-[resize-handle-state=hover]:bg-accent/20 data-[resize-handle-state=drag]:bg-accent/30",
        "focus-visible:bg-accent/30",
        className,
      )}
    >
      <div
        className={cn(
          "rounded-full bg-border-strong transition-colors group-hover/resize:bg-accent group-focus-visible/resize:bg-accent",
          horizontal ? "h-8 w-0.5" : "h-0.5 w-8",
        )}
      />
    </PanelResizeHandle>
  );
}

// Anchored floating panel: a render-prop trigger + content, with dismissal
// (outside-click + Esc + focus return) delegated to `useDismiss`. Self-contained
// uncontrolled state by default; pass `open`/`onOpenChange` to control it. The
// sanctioned base for Menu and Combobox — no new popover should re-roll this.

import {
  useCallback,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@/lib/cn";
import { useDismiss } from "./useDismiss";

export interface PopoverRenderProps {
  open: boolean;
  /** Toggle open/closed (wire to the trigger's onClick). */
  toggle: () => void;
  /** Close and return focus to the trigger (used on selection). */
  close: () => void;
  /** Attach to the trigger element so outside-click treats it as inside. */
  triggerRef: RefObject<HTMLButtonElement>;
}

export interface PopoverProps {
  /** Render the trigger; spread `triggerRef`/`toggle` onto a focusable control. */
  trigger: (props: PopoverRenderProps) => ReactNode;
  /** Panel content; a function receives `close` for selection-driven dismissal. */
  children: ReactNode | ((props: { close: () => void }) => ReactNode);
  /** Horizontal edge to anchor the panel to. */
  align?: "start" | "end";
  /** Controlled open state. Omit for uncontrolled. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Class for the relative wrapper (e.g. `w-full` for full-width triggers). */
  className?: string;
  /** Class for the floating panel. */
  contentClassName?: string;
  contentRole?: string;
  "aria-label"?: string;
}

export function Popover({
  trigger,
  children,
  align = "start",
  open: openProp,
  onOpenChange,
  className,
  contentClassName,
  contentRole,
  "aria-label": ariaLabel,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Outside-click dismissal must not refocus the trigger (focus follows the
  // click); Escape and selection do, via `useDismiss`/`close` respectively.
  const dismiss = useCallback(() => setOpen(false), [setOpen]);
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, [setOpen]);
  const toggle = useCallback(() => setOpen(!open), [setOpen, open]);

  useDismiss({
    open,
    onDismiss: dismiss,
    refs: [triggerRef, contentRef],
    returnFocusTo: triggerRef,
  });

  return (
    <div className={cn("relative inline-flex", className)}>
      {trigger({ open, toggle, close, triggerRef })}
      {open && (
        <div
          ref={contentRef}
          role={contentRole}
          aria-label={ariaLabel}
          className={cn(
            "absolute top-full z-30 mt-1 min-w-full animate-fade-in overflow-hidden rounded-lg border border-border-strong bg-bg-panel shadow-panel",
            align === "end" ? "right-0" : "left-0",
            contentClassName,
          )}
        >
          {typeof children === "function" ? children({ close }) : children}
        </div>
      )}
    </div>
  );
}

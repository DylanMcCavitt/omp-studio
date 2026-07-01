// Anchored floating panel: a render-prop trigger + content, with dismissal
// (outside-click + Esc + focus return) delegated to `useDismiss`. Self-contained
// uncontrolled state by default; pass `open`/`onOpenChange` to control it. The
// sanctioned base for Menu and Combobox — no new popover should re-roll this.

import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useDismiss } from "./useDismiss";

const VIEWPORT_MARGIN = 8;
const FLOATING_GAP = 4;

export type PopoverPlacement = "bottom" | "top" | "auto";

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
  /**
   * Render through document.body and position in viewport coordinates. Use this
   * for controls near scroll/overflow/window edges; inline mode preserves legacy
   * full-width menu/combobox behaviour.
   */
  portal?: boolean;
  /** Vertical placement for portaled content. */
  placement?: PopoverPlacement;
  /** Class for the relative wrapper (e.g. `w-full` for full-width triggers). */
  className?: string;
  /** Class for the floating panel. */
  contentClassName?: string;
  contentRole?: string;
}

interface FloatingPosition {
  top: number;
  left: number;
  minWidth: number;
  visible: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function Popover({
  trigger,
  children,
  align = "start",
  open: openProp,
  onOpenChange,
  portal = false,
  placement = "bottom",
  className,
  contentClassName,
  contentRole,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [floatingPosition, setFloatingPosition] =
    useState<FloatingPosition | null>(null);
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

  const updateFloatingPosition = useCallback(() => {
    if (!portal || !open) return;
    const triggerEl = triggerRef.current;
    const contentEl = contentRef.current;
    if (!triggerEl || !contentEl) return;

    const triggerRect = triggerEl.getBoundingClientRect();
    const contentRect = contentEl.getBoundingClientRect();
    const contentWidth =
      contentRect.width || contentEl.offsetWidth || triggerRect.width;
    const contentHeight = contentRect.height || contentEl.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const spaceBelow =
      viewportHeight - triggerRect.bottom - FLOATING_GAP - VIEWPORT_MARGIN;
    const spaceAbove = triggerRect.top - FLOATING_GAP - VIEWPORT_MARGIN;
    const placeAbove =
      placement === "top" ||
      (placement === "auto" &&
        contentHeight > spaceBelow &&
        spaceAbove > spaceBelow);

    const rawTop = placeAbove
      ? triggerRect.top - FLOATING_GAP - contentHeight
      : triggerRect.bottom + FLOATING_GAP;
    const maxTop = Math.max(
      VIEWPORT_MARGIN,
      viewportHeight - contentHeight - VIEWPORT_MARGIN,
    );
    const top = clamp(rawTop, VIEWPORT_MARGIN, maxTop);

    const rawLeft =
      align === "end" ? triggerRect.right - contentWidth : triggerRect.left;
    const maxLeft = Math.max(
      VIEWPORT_MARGIN,
      viewportWidth - contentWidth - VIEWPORT_MARGIN,
    );
    const left = clamp(rawLeft, VIEWPORT_MARGIN, maxLeft);
    const minWidth = triggerRect.width;

    setFloatingPosition((prev) => {
      if (
        prev?.top === top &&
        prev.left === left &&
        prev.minWidth === minWidth &&
        prev.visible
      ) {
        return prev;
      }
      return { top, left, minWidth, visible: true };
    });
  }, [align, open, placement, portal]);

  useDismiss({
    open,
    onDismiss: dismiss,
    refs: [triggerRef, contentRef],
    returnFocusTo: triggerRef,
  });

  useLayoutEffect(() => {
    updateFloatingPosition();
  });

  useEffect(() => {
    if (!portal || !open) return;
    const update = () => updateFloatingPosition();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, portal, updateFloatingPosition]);

  const floatingStyle: CSSProperties | undefined = portal
    ? {
        left: floatingPosition?.left ?? 0,
        minWidth: floatingPosition?.minWidth,
        top: floatingPosition?.top ?? 0,
        visibility: floatingPosition?.visible ? undefined : "hidden",
      }
    : undefined;

  const content = (
    <div
      ref={contentRef}
      role={contentRole}
      style={floatingStyle}
      className={cn(
        portal
          ? "fixed z-50 animate-fade-in overflow-hidden rounded-lg border border-border-strong bg-bg-panel shadow-panel"
          : "absolute top-full z-30 mt-1 min-w-full animate-fade-in overflow-hidden rounded-lg border border-border-strong bg-bg-panel shadow-panel",
        portal ? undefined : align === "end" ? "right-0" : "left-0",
        contentClassName,
      )}
    >
      {typeof children === "function" ? children({ close }) : children}
    </div>
  );

  return (
    <div className={cn("relative inline-flex", className)}>
      {trigger({ open, toggle, close, triggerRef })}
      {open && (portal ? createPortal(content, document.body) : content)}
    </div>
  );
}

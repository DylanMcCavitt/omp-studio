// Shared dismissal mechanics for the §3 floating primitives (Popover, and the
// Menu/Combobox built on it). Wires the three behaviours every hand-rolled
// popover used to re-implement: outside-pointer dismissal, Escape, and focus
// return to the trigger on keyboard dismissal. Factored out so popovers stop
// copy-pasting these listeners.

import { type RefObject, useEffect, useRef } from "react";

export interface UseDismissOptions {
  /** Only while open are the document listeners attached. */
  open: boolean;
  /** Called when the user clicks outside or presses Escape. */
  onDismiss: () => void;
  /** Elements considered "inside" — a pointerdown within any is not a dismiss. */
  refs: ReadonlyArray<RefObject<HTMLElement | null>>;
  /** Focused after an Escape dismissal (typically the trigger). */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

export function useDismiss({
  open,
  onDismiss,
  refs,
  returnFocusTo,
}: UseDismissOptions): void {
  // Keep the latest values in refs so the effect only re-subscribes on `open`
  // changes, not on every render (the `refs` array is a fresh literal each time
  // but holds the same stable ref objects).
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;

    const isInside = (target: Node | null) =>
      !!target &&
      refsRef.current.some((r) => !!r.current && r.current.contains(target));

    const onPointerDown = (e: PointerEvent) => {
      if (!isInside(e.target as Node | null)) onDismissRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismissRef.current();
        returnFocusTo?.current?.focus();
      }
    };

    // Capture phase: catch the pointerdown even if a child stops propagation.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, returnFocusTo]);
}

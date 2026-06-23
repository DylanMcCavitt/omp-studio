// The single focus-trap primitive behind every modal and palette (G2). Attach
// the returned ref to the overlay container and, while mounted/active, it:
//   - remembers the element that had focus before the overlay opened;
//   - moves focus to the element marked [data-autofocus] (falling back to the
//     first focusable, then the container itself) so the default action is the
//     keyboard's first stop — the approval dialog points this at Deny;
//   - keeps Tab / Shift+Tab cycling within the container (wrapping at the edges)
//     so focus can never escape into the dimmed app behind the overlay;
//   - restores focus to the original trigger when the overlay unmounts/deactivates.
//
// Living here means each dialog inherits the behaviour instead of re-implementing
// it: ModalShell (and the four C3 dialogs through it), the compact/rename
// dialogs, the global search overlay, and the slash-command palette all share
// this one hook.

import { type RefObject, useEffect, useRef } from "react";

// Candidate focusable elements. The JS filter below drops anything disabled,
// aria-hidden, or explicitly removed from the tab order (tabIndex < 0) — the
// latter matters for overlays whose backdrop is a tabIndex={-1} button. Relying
// on the live `tabIndex` property (not a CSS visibility check) keeps this working
// under jsdom, which performs no layout.
const FOCUSABLE_SELECTOR =
  "a[href], button, input, select, textarea, [tabindex]";

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.getAttribute("aria-hidden") !== "true" &&
      el.tabIndex >= 0,
  );
}

export interface FocusTrapOptions {
  /** When false the trap is inert (no focus changes, no Tab handling). Default true. */
  active?: boolean;
  /** Restore focus to the pre-open element on teardown. Default true. */
  restoreFocus?: boolean;
}

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
  options: FocusTrapOptions = {},
): RefObject<T> {
  const { active = true, restoreFocus = true } = options;
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Initial focus: the marked default action, else the first focusable, else
    // the container (which carries tabIndex={-1} on every overlay).
    const initial =
      container.querySelector<HTMLElement>("[data-autofocus]") ??
      focusableWithin(container)[0] ??
      container;
    initial.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusableWithin(container);
      if (items.length === 0) {
        // Nothing tabbable inside — keep focus pinned to the container.
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !container.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      if (restoreFocus) previouslyFocused?.focus?.();
    };
  }, [active, restoreFocus]);

  return containerRef;
}

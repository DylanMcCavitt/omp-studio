// Streams the on-screen rect of the browser placeholder back to main so it can
// keep the sandboxed `WebContentsView` overlaid exactly on top of it. The view
// lives in main's content layer (not the DOM), so the renderer is the only
// thing that knows where the placeholder ends up after layout, a window resize,
// or any ancestor scroll — we observe all three and push the measured rect to
// `window.omp.browser.setBounds`.
//
// Bounds are in window-relative DIP, which equals CSS pixels here: the renderer
// fills the BrowserWindow content area, so `getBoundingClientRect()` viewport
// coordinates map 1:1 onto `setBounds`. Inactive (`viewId === null`) is a no-op.

import { type RefObject, useEffect } from "react";

export function useBrowserBounds(
  viewId: string | null,
  ref: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!viewId || !el) return;

    const report = () => {
      const r = el.getBoundingClientRect();
      window.omp.browser.setBounds(viewId, {
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      });
    };

    // Report the initial rect, then on every source that can move it.
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener("resize", report);
    // Capture phase so a scroll on ANY ancestor (not just window) re-measures.
    window.addEventListener("scroll", report, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      window.removeEventListener("scroll", report, true);
    };
  }, [viewId, ref]);
}

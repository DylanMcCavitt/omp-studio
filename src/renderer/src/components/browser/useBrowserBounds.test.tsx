// AGE-624 — the bounds-reporting hook. It must (1) push the placeholder rect to
// `window.omp.browser.setBounds` on mount AND when the ResizeObserver fires
// (layout/resize), and (2) do nothing while there is no live view (viewId null)
// so we never position a view that doesn't exist. jsdom has no ResizeObserver,
// so we install a fake that captures the callback to drive it deterministically.

import type { OmpApi } from "@shared/ipc";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { useBrowserBounds } from "./useBrowserBounds";

let resizeCb: (() => void) | null = null;

class FakeResizeObserver {
  constructor(cb: () => void) {
    resizeCb = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function Harness({ viewId }: { viewId: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useBrowserBounds(viewId, ref);
  return <div ref={ref} data-testid="placeholder" />;
}

beforeEach(() => {
  resizeCb = null;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    FakeResizeObserver;
  Object.assign(window.omp, {
    browser: { setBounds: vi.fn() },
  } as unknown as Partial<OmpApi>);
});

it("reports the placeholder rect to setBounds on mount and on resize", () => {
  render(<Harness viewId="v1" />);

  // jsdom getBoundingClientRect is all-zero; the hook still reports a rect.
  expect(window.omp.browser.setBounds).toHaveBeenCalledTimes(1);
  expect(window.omp.browser.setBounds).toHaveBeenCalledWith("v1", {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  // A layout/resize the observer reports re-measures and re-pushes.
  resizeCb?.();
  expect(window.omp.browser.setBounds).toHaveBeenCalledTimes(2);
});

it("does nothing while there is no live view", () => {
  render(<Harness viewId={null} />);
  expect(window.omp.browser.setBounds).not.toHaveBeenCalled();
});

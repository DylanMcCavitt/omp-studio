// Global setup for the renderer component-test harness (Vitest + jsdom + RTL).
//
//   - Registers jest-dom's custom matchers (toBeInTheDocument, toHaveFocus, …)
//     on Vitest's `expect`.
//   - Unmounts every rendered tree after each test so focus state, portals, and
//     the document body don't leak between cases.
//   - Patches the handful of DOM APIs jsdom omits that focus-sensitive
//     components reach for at runtime.

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom does not implement scrollIntoView; the select dialog and slash palette
// call it to keep the active row visible. Make it a no-op so those paths run.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// `Promise.withResolvers` (used by the image reader) is missing on Node < 22.
// CI runs the gate on Node 20 as well, so polyfill it for the test runtime only.
if (
  typeof (Promise as { withResolvers?: unknown }).withResolvers !== "function"
) {
  (
    Promise as unknown as {
      withResolvers: <T>() => {
        promise: Promise<T>;
        resolve: (value: T | PromiseLike<T>) => void;
        reject: (reason?: unknown) => void;
      };
    }
  ).withResolvers = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// A minimal `window.omp` so importing renderer stores (which type the bridge as
// always-present) never trips over an undefined global if a code path reads it.
// Tests that assert bridge calls install their own spies on top.
if (!("omp" in window)) {
  Object.defineProperty(window, "omp", {
    configurable: true,
    writable: true,
    value: { chat: { close: vi.fn() } },
  });
}

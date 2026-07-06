import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  MESSAGE_ANCHOR_ATTR,
  useMessageVisibility,
} from "./useMessageVisibility";

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  private readonly callback: IntersectionObserverCallback;
  readonly observedTargets = new Set<Element>();

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observedTargets.add(target);
  }

  unobserve(target: Element) {
    this.observedTargets.delete(target);
  }

  disconnect() {
    this.observedTargets.clear();
  }

  // Deliver only entries for targets actually under observation — emitting
  // for an unobserved element must be a silent no-op, so tests prove the
  // hook's (re)observe path rather than bypassing it.
  emit(entries: Partial<IntersectionObserverEntry>[]) {
    const delivered = entries.filter(
      (entry) => entry.target && this.observedTargets.has(entry.target),
    );
    if (delivered.length === 0) return;
    this.callback(delivered as IntersectionObserverEntry[], this as never);
  }
}

afterEach(() => {
  MockIntersectionObserver.instances = [];
  vi.unstubAllGlobals();
});

describe("useMessageVisibility", () => {
  it("exposes the topmost visible anchor and all visible ids", async () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    const root = document.createElement("div");
    const first = document.createElement("div");
    first.setAttribute(MESSAGE_ANCHOR_ATTR, "msg:1");
    const second = document.createElement("div");
    second.setAttribute(MESSAGE_ANCHOR_ATTR, "msg:2");
    root.append(first, second);
    document.body.append(root);

    const scrollRootRef = { current: root };
    const { result } = renderHook(() =>
      useMessageVisibility(scrollRootRef, ["msg:1", "msg:2"]),
    );

    const observer = MockIntersectionObserver.instances[0];
    observer?.emit([
      { target: first, intersectionRatio: 0.5 },
      { target: second, intersectionRatio: 0.25 },
    ]);

    await waitFor(() => {
      expect(result.current.visibleMessageIds).toEqual(["msg:1", "msg:2"]);
      expect(result.current.currentAnchorId).toBe("msg:1");
    });

    root.remove();
  });

  it("keeps one observer when re-rendered with a fresh array of identical ids", () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    const root = document.createElement("div");
    const first = document.createElement("div");
    first.setAttribute(MESSAGE_ANCHOR_ATTR, "msg:1");
    root.append(first);
    document.body.append(root);

    const scrollRootRef = { current: root };
    const { rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useMessageVisibility(scrollRootRef, ids),
      { initialProps: { ids: ["msg:1"] } },
    );

    // Regression: array identity in the effect deps looped render → effect →
    // setState → render until the vitest worker OOMed.
    rerender({ ids: ["msg:1"] });
    rerender({ ids: ["msg:1"] });

    expect(MockIntersectionObserver.instances).toHaveLength(1);
    root.remove();
  });

  it("prunes departed rows and tracks newly mounted ones (virtualized scroll)", async () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    const root = document.createElement("div");
    const first = document.createElement("div");
    first.setAttribute(MESSAGE_ANCHOR_ATTR, "msg:1");
    root.append(first);
    document.body.append(root);

    const scrollRootRef = { current: root };
    const { result } = renderHook(() =>
      useMessageVisibility(scrollRootRef, ["msg:1", "msg:2"]),
    );

    const observer = MockIntersectionObserver.instances[0];
    observer?.emit([{ target: first, intersectionRatio: 1 }]);
    await waitFor(() => expect(result.current.currentAnchorId).toBe("msg:1"));

    // Virtuoso scrolls msg:1 out of the DOM and mounts msg:2 in its place.
    const second = document.createElement("div");
    second.setAttribute(MESSAGE_ANCHOR_ATTR, "msg:2");
    first.remove();
    root.append(second);

    // The MutationObserver prunes msg:1's stale ratio…
    await waitFor(() => expect(result.current.visibleMessageIds).toEqual([]));
    // …and the newly observed msg:2 becomes current once it intersects.
    observer?.emit([{ target: second, intersectionRatio: 0.8 }]);
    await waitFor(() => expect(result.current.currentAnchorId).toBe("msg:2"));

    root.remove();
  });

  it("disconnects observers on unmount", () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const disconnect = vi.fn();
    MockIntersectionObserver.prototype.disconnect = disconnect;

    const root = document.createElement("div");
    const scrollRootRef = { current: root };
    const { unmount } = renderHook(() =>
      useMessageVisibility(scrollRootRef, ["msg:1"]),
    );

    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});

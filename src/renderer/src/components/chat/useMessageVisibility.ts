import { type RefObject, useEffect, useState } from "react";

export const MESSAGE_ANCHOR_ATTR = "data-message-anchor";

export function messageAnchorSelector(id: string): string {
  return `[${MESSAGE_ANCHOR_ATTR}="${CSS.escape(id)}"]`;
}

/**
 * Tracks which transcript rows intersect the MessageList scroll container.
 * `currentAnchorId` is the topmost visible row in transcript order;
 * `visibleMessageIds` lists every row with a non-zero intersection ratio.
 *
 * The transcript is virtualized (react-virtuoso), so rows mount and unmount
 * as the user scrolls: a MutationObserver re-walks the container on DOM
 * changes, observing newly mounted rows and unobserving departed ones —
 * otherwise ratios go stale and the IntersectionObserver pins detached nodes.
 */
export function useMessageVisibility(
  scrollRootRef: RefObject<HTMLElement | null>,
  messageIds: readonly string[],
): {
  currentAnchorId: string | null;
  visibleMessageIds: string[];
} {
  const [visibleMessageIds, setVisibleMessageIds] = useState<string[]>([]);
  const [currentAnchorId, setCurrentAnchorId] = useState<string | null>(null);
  // Content key: MessageList rebuilds the ids array every render, so the
  // effect keys on joined content — array identity in the dep list would
  // re-run the effect (and its setState) every render and loop.
  const messageKey = messageIds.join("\0");

  useEffect(() => {
    const root = scrollRootRef.current;
    const ids = messageKey === "" ? [] : messageKey.split("\0");
    if (!root || ids.length === 0) {
      setVisibleMessageIds((prev) => (prev.length === 0 ? prev : []));
      setCurrentAnchorId(null);
      return;
    }

    const ratios = new Map<string, number>();

    const sync = () => {
      const visible = ids.filter((id) => (ratios.get(id) ?? 0) > 0);
      // Identity bailout: observer callbacks fire often; only commit state
      // when the visible set actually changed so they can never drive a
      // render loop.
      setVisibleMessageIds((prev) =>
        prev.length === visible.length &&
        prev.every((id, i) => id === visible[i])
          ? prev
          : visible,
      );
      setCurrentAnchorId(visible[0] ?? null);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).getAttribute(
            MESSAGE_ANCHOR_ATTR,
          );
          if (id) ratios.set(id, entry.intersectionRatio);
        }
        sync();
      },
      {
        root,
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      },
    );

    const observed = new Map<HTMLElement, string>();

    /** (Re)observe mounted rows, release unmounted ones. True if state moved. */
    const observeCurrent = (): boolean => {
      let changed = false;
      for (const [element] of observed) {
        if (!element.isConnected) {
          observer.unobserve(element);
          observed.delete(element);
          changed = true;
        }
      }
      const present = new Set<string>();
      for (const element of root.querySelectorAll<HTMLElement>(
        `[${MESSAGE_ANCHOR_ATTR}]`,
      )) {
        const id = element.getAttribute(MESSAGE_ANCHOR_ATTR);
        if (!id) continue;
        present.add(id);
        if (!observed.has(element)) {
          observed.set(element, id);
          observer.observe(element);
        }
      }
      for (const id of ratios.keys()) {
        if (!present.has(id)) {
          ratios.delete(id);
          changed = true;
        }
      }
      return changed;
    };

    const mutations = new MutationObserver(() => {
      if (observeCurrent()) sync();
    });
    mutations.observe(root, { childList: true, subtree: true });

    observeCurrent();
    sync();

    return () => {
      mutations.disconnect();
      observer.disconnect();
    };
  }, [scrollRootRef, messageKey]);

  return { currentAnchorId, visibleMessageIds };
}

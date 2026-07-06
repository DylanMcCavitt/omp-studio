import { type RefObject, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import {
  bucketForAnchor,
  bucketMessageIds,
  MESSAGE_SCROLLER_BUCKET_THRESHOLD,
} from "./messageScrollerBuckets";

export const MESSAGE_SCROLLER_MIN_MESSAGES = 10;
export const MESSAGE_SCROLLER_MIN_VIEWPORT_MULTIPLIER = 2;

export interface MessageScrollerProps {
  scrollRootRef: RefObject<HTMLElement | null>;
  messageIds: readonly string[];
  currentAnchorId: string | null;
  onNavigate: (anchorId: string) => void;
}

function shouldShowScroller(
  scrollRoot: HTMLElement | null,
  messageCount: number,
): boolean {
  if (!scrollRoot || messageCount < MESSAGE_SCROLLER_MIN_MESSAGES) return false;
  return (
    scrollRoot.scrollHeight >=
    scrollRoot.clientHeight * MESSAGE_SCROLLER_MIN_VIEWPORT_MULTIPLIER
  );
}

export function MessageScroller({
  scrollRootRef,
  messageIds,
  currentAnchorId,
  onNavigate,
}: MessageScrollerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) {
      setVisible(false);
      return;
    }

    const update = () => {
      setVisible(shouldShowScroller(root, messageIds.length));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    root.addEventListener("scroll", update, { passive: true });

    return () => {
      observer.disconnect();
      root.removeEventListener("scroll", update);
    };
  }, [scrollRootRef, messageIds.length]);

  const buckets = useMemo(() => {
    const maxBuckets =
      messageIds.length > MESSAGE_SCROLLER_BUCKET_THRESHOLD
        ? MESSAGE_SCROLLER_BUCKET_THRESHOLD
        : messageIds.length;
    return bucketMessageIds(messageIds, maxBuckets);
  }, [messageIds]);

  const activeBucketId = useMemo(
    () => bucketForAnchor(buckets, messageIds, currentAnchorId),
    [buckets, messageIds, currentAnchorId],
  );

  if (!visible || buckets.length === 0) return null;

  return (
    <nav
      aria-label="Message position"
      className="pointer-events-none absolute inset-y-3 right-1.5 z-10 flex w-2 justify-center"
    >
      <div className="pointer-events-auto flex max-h-full flex-col gap-0.5 rounded-full bg-bg/40 px-0.5 py-1 backdrop-blur-[1px]">
        {buckets.map((bucket) => {
          const active = bucket.id === activeBucketId;
          return (
            <button
              key={bucket.id}
              type="button"
              aria-label={
                bucket.count > 1
                  ? `Jump to message group (${bucket.count} messages)`
                  : "Jump to message"
              }
              aria-current={active ? "true" : undefined}
              title={
                bucket.count > 1
                  ? `${bucket.count} messages`
                  : "Jump to message"
              }
              onClick={() => onNavigate(bucket.anchorId)}
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
                bucket.count > 1 && "h-2",
                active
                  ? "bg-ink-muted shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
                  : "bg-ink-faint/50 hover:bg-ink-faint",
              )}
            />
          );
        })}
      </div>
    </nav>
  );
}

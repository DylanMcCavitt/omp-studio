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
      className="pointer-events-none absolute inset-y-3 right-2 z-10 flex w-6 items-center justify-center"
    >
      <div className="pointer-events-auto flex max-h-full flex-col items-center gap-1.5">
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
              // Horizontal tick marks (shadcn MessageScroller style): a slim
              // dash per bucket; the active one widens and brightens.
              className={cn(
                "h-[3px] w-3 shrink-0 rounded-full transition-all",
                active ? "w-4 bg-ink" : "bg-ink-faint/60 hover:bg-ink-muted",
              )}
            />
          );
        })}
      </div>
    </nav>
  );
}

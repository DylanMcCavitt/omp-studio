export const MESSAGE_SCROLLER_BUCKET_THRESHOLD = 50;
export const MESSAGE_SCROLLER_MAX_BUCKETS = 50;

export interface MessageScrollerBucket {
  /** Stable bucket id for React keys. */
  id: string;
  /** First message anchor in this bucket — scroll target on click. */
  anchorId: string;
  /** Number of transcript rows represented by this segment. */
  count: number;
}

/** Evenly bucket message ids when the transcript exceeds the density cap. */
export function bucketMessageIds(
  messageIds: readonly string[],
  maxBuckets = MESSAGE_SCROLLER_MAX_BUCKETS,
): MessageScrollerBucket[] {
  if (messageIds.length === 0) return [];
  if (messageIds.length <= maxBuckets) {
    return messageIds.map((anchorId) => ({
      id: anchorId,
      anchorId,
      count: 1,
    }));
  }

  const targetBuckets = maxBuckets;
  const baseSize = Math.floor(messageIds.length / targetBuckets);
  let remainder = messageIds.length % targetBuckets;
  const buckets: MessageScrollerBucket[] = [];
  let index = 0;

  for (let bucketIndex = 0; bucketIndex < targetBuckets; bucketIndex++) {
    const size = baseSize + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    const slice = messageIds.slice(index, index + size);
    const anchorId = slice[0];
    if (!anchorId) break;
    buckets.push({
      id: `bucket:${index}`,
      anchorId,
      count: slice.length,
    });
    index += size;
  }

  return buckets;
}

export function bucketForAnchor(
  buckets: readonly MessageScrollerBucket[],
  messageIds: readonly string[],
  anchorId: string | null,
): string | null {
  if (!anchorId || buckets.length === 0 || messageIds.length === 0) return null;
  const index = messageIds.indexOf(anchorId);
  if (index < 0) return buckets[0]?.id ?? null;
  if (buckets.length === messageIds.length) return anchorId;

  let cursor = 0;
  for (const bucket of buckets) {
    const end = cursor + bucket.count;
    if (index >= cursor && index < end) return bucket.id;
    cursor = end;
  }

  return buckets[buckets.length - 1]?.id ?? null;
}

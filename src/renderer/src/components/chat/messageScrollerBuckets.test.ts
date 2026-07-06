import { describe, expect, it } from "vitest";
import { bucketForAnchor, bucketMessageIds } from "./messageScrollerBuckets";

describe("bucketMessageIds", () => {
  it("returns one segment per message when under the cap", () => {
    const ids = ["a", "b", "c"];
    expect(bucketMessageIds(ids, 50)).toEqual([
      { id: "a", anchorId: "a", count: 1 },
      { id: "b", anchorId: "b", count: 1 },
      { id: "c", anchorId: "c", count: 1 },
    ]);
  });

  it("evenly buckets long transcripts", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `msg:${i}`);
    const buckets = bucketMessageIds(ids, 50);
    expect(buckets).toHaveLength(50);
    expect(buckets[0]?.anchorId).toBe("msg:0");
    expect(buckets[49]?.anchorId).toBe("msg:118");
    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(120);
  });
});

describe("bucketForAnchor", () => {
  it("maps the current anchor onto its bucket", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `msg:${i}`);
    const buckets = bucketMessageIds(ids, 50);
    expect(bucketForAnchor(buckets, ids, "msg:10")).toBe("bucket:9");
    expect(bucketForAnchor(buckets, ids, "msg:99")).toBe("bucket:98");
  });
});

import { expect, test } from "bun:test";
import { getMemoryUsage } from "../src/main/services/memory-usage";

test("getMemoryUsage sums app RSS and injected OMP tree RSS", async () => {
  const snapshot = await getMemoryUsage([101, 202], {
    appRssBytes: () => 1_000,
    processTreeRssBytes: async (pids) => {
      expect(pids).toEqual([101, 202]);
      return 2_500;
    },
  });

  expect(snapshot).toEqual({
    totalBytes: 3_500,
    appBytes: 1_000,
    ompBytes: 2_500,
    ompInstanceCount: 2,
    generatedAt: expect.any(String),
  });
});

test("getMemoryUsage defaults to zero OMP instances when none are live", async () => {
  const snapshot = await getMemoryUsage([], {
    appRssBytes: () => 512,
    processTreeRssBytes: async () => 0,
  });

  expect(snapshot.totalBytes).toBe(512);
  expect(snapshot.ompBytes).toBe(0);
  expect(snapshot.ompInstanceCount).toBe(0);
});

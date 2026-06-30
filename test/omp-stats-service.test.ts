import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import * as cli from "../src/main/services/cli";
import { getOmpStats } from "../src/main/services/omp-stats";

interface RunnerCall {
  bin: string;
  args: string[];
  opts?: { maxBytes?: number; timeoutMs?: number };
}

const calls: RunnerCall[] = [];
const realRunCli = cli.runCli;
const realRunJson = cli.runJson;
let nextResult: Record<string, unknown> | null = null;

beforeAll(() => {
  mock.module("../src/main/services/cli", () => ({
    runCli: realRunCli,
    runJson: async (
      bin: string,
      args: string[],
      opts?: { maxBytes?: number; timeoutMs?: number },
    ) => {
      calls.push({ bin, args, opts });
      return nextResult;
    },
  }));
});

afterAll(() => {
  mock.module("../src/main/services/cli", () => ({
    runCli: realRunCli,
    runJson: realRunJson,
  }));
});

afterEach(() => {
  calls.length = 0;
  nextResult = null;
});

test("getOmpStats reads the local OMP stats JSON through the CLI seam", async () => {
  nextResult = {
    overall: { totalRequests: 12, totalCost: 0.42 },
    byModel: [{ provider: "openai", model: "gpt-5.5", totalRequests: 12 }],
  };

  const stats = await getOmpStats();

  expect(calls).toHaveLength(1);
  expect(calls[0]?.args).toEqual(["stats", "--json"]);
  expect(calls[0]?.opts?.maxBytes).toBeGreaterThan(0);
  expect(stats?.overall?.totalRequests).toBe(12);
  expect(typeof stats?.generatedAt).toBe("string");
});

test("getOmpStats degrades to null when the CLI result is unavailable", async () => {
  nextResult = null;

  await expect(getOmpStats()).resolves.toBeNull();
});

test("getOmpStats rejects unsupported stats shapes", async () => {
  nextResult = {};
  await expect(getOmpStats()).resolves.toBeNull();

  nextResult = { byModel: { provider: "openai" } };
  await expect(getOmpStats()).resolves.toBeNull();
});

test("parseJsonOutput accepts bracketed warnings before JSON", () => {
  const parsed = cli.parseJsonOutput<{ ok: boolean }>(
    '[WARN] extension skipped\nSyncing session files...\n{"ok":true}',
  );

  expect(parsed).toEqual({ ok: true });
});

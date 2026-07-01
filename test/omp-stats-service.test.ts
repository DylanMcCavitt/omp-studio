import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import * as cli from "../src/main/services/cli";
import { getOmpStats } from "../src/main/services/omp-stats";

interface RunnerCall {
  bin: string;
  args: string[];
  opts?: { maxBytes?: number; spoolOutput?: boolean; timeoutMs?: number };
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
      opts?: { maxBytes?: number; spoolOutput?: boolean; timeoutMs?: number },
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
  expect(calls[0]?.opts?.spoolOutput).toBe(true);
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

test("parseJsonOutput returns the first balanced JSON object with prelude and trailing noise", () => {
  const parsed = cli.parseJsonOutput<{
    overall: { totalRequests: number };
    byModel: Array<{ model: string; totalRequests: number }>;
  }>(
    'Synced 17 new entries\n{"overall":{"totalRequests":12},"byModel":[{"model":"gpt-{beta}","totalRequests":12}]}\n{"models":[{"id":"gpt-5.5"}]}\nDone.\n',
  );

  expect(parsed).toEqual({
    overall: { totalRequests: 12 },
    byModel: [{ model: "gpt-{beta}", totalRequests: 12 }],
  });
});

test("runCli waits for stdout to drain before resolving large fast output", async () => {
  const payloadSize = 128 * 1024;
  const result = await cli.runCli(
    process.execPath,
    [
      "-e",
      `process.stdout.write("a".repeat(8192)); process.stdout.write("b".repeat(${payloadSize - 8192}));`,
    ],
    { maxBytes: payloadSize + 1, timeoutMs: 5000 },
  );

  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toHaveLength(payloadSize);
  expect(result.stdout.slice(0, 8192)).toBe("a".repeat(8192));
  expect(result.stdout.slice(8192)).toBe("b".repeat(payloadSize - 8192));
});

test("runCli spools large fast output through temp files when requested", async () => {
  const payloadSize = 128 * 1024;
  const result = await cli.runCli(
    process.execPath,
    [
      "-e",
      `process.stdout.write("a".repeat(8192)); process.stdout.write("b".repeat(${payloadSize - 8192}));`,
    ],
    { maxBytes: payloadSize + 1, spoolOutput: true, timeoutMs: 5000 },
  );

  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toHaveLength(payloadSize);
  expect(result.stdout.slice(0, 8192)).toBe("a".repeat(8192));
  expect(result.stdout.slice(8192)).toBe("b".repeat(payloadSize - 8192));
});

test("runCli spooling resolves missing binaries without a late close crash", async () => {
  const result = await cli.runCli("/definitely/missing/omp-studio-cli", [], {
    spoolOutput: true,
    timeoutMs: 1000,
  });

  expect(result).toEqual({ stdout: "", stderr: "", code: -1 });
});

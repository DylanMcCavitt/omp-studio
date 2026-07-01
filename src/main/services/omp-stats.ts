import type { OmpStatsSnapshot } from "@shared/domain";
import { ompBinary } from "../paths";
import { runJson } from "./cli";

const MAX_STATS_BYTES = 2 * 1024 * 1024;
const STATS_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const BREAKDOWN_KEYS = [
  "byModel",
  "byFolder",
  "byAgentType",
  "timeSeries",
  "modelSeries",
  "modelPerformanceSeries",
  "costSeries",
] as const;

function normalizeRecord(
  value: unknown,
): Record<string, unknown> | undefined | null {
  if (value === undefined) return undefined;
  return isRecord(value) ? value : null;
}

function normalizeBreakdown(
  value: unknown,
): Record<string, unknown>[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  return value.filter(isRecord);
}

function normalizeStats(raw: Record<string, unknown>): OmpStatsSnapshot | null {
  const overall = normalizeRecord(raw.overall);
  if (overall === null) return null;

  const arrays: Partial<
    Record<(typeof BREAKDOWN_KEYS)[number], Record<string, unknown>[]>
  > = {};
  for (const key of BREAKDOWN_KEYS) {
    const normalized = normalizeBreakdown(raw[key]);
    if (normalized === null) return null;
    if (normalized !== undefined) arrays[key] = normalized;
  }

  if (overall === undefined && Object.keys(arrays).length === 0) return null;
  return {
    ...raw,
    ...arrays,
    overall,
    generatedAt: new Date().toISOString(),
  } as OmpStatsSnapshot;
}

/**
 * Read the local OMP stats snapshot through the OMP CLI stats engine.
 *
 * This intentionally shells out to `omp stats --json` instead of opening
 * `~/.omp/stats.db` directly: the CLI owns session-log syncing, schema details,
 * and future field additions. A missing/old CLI, timeout, capped output, or
 * unexpected shape degrades to `null` so the Dashboard can stay usable.
 */
export async function getOmpStats(): Promise<OmpStatsSnapshot | null> {
  const raw = await runJson<Record<string, unknown>>(
    ompBinary(),
    ["stats", "--json"],
    {
      maxBytes: MAX_STATS_BYTES,
      spoolOutput: true,
      timeoutMs: STATS_TIMEOUT_MS,
    },
  );
  if (!isRecord(raw)) return null;
  return normalizeStats(raw);
}

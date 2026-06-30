import type { OmpStatsSnapshot } from "@shared/domain";
import { ompBinary } from "../paths";
import { runJson } from "./cli";

const MAX_STATS_BYTES = 2 * 1024 * 1024;
const STATS_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
      timeoutMs: STATS_TIMEOUT_MS,
    },
  );
  if (!isRecord(raw)) return null;
  return { ...raw, generatedAt: new Date().toISOString() } as OmpStatsSnapshot;
}

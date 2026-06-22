import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve the `omp` binary. Packaged GUI apps on macOS inherit a minimal PATH
 * that usually excludes Homebrew / ~/.bun, so we probe the common install
 * locations before falling back to bare `omp` (PATH lookup).
 */
let cachedBinary: string | null = null;

export function ompBinary(): string {
  if (cachedBinary) return cachedBinary;
  const override = process.env.OMP_BINARY;
  if (override && existsSync(override)) {
    cachedBinary = override;
    return cachedBinary;
  }
  const candidates = [
    "/opt/homebrew/bin/omp",
    "/usr/local/bin/omp",
    join(homedir(), ".bun", "bin", "omp"),
    join(homedir(), ".local", "bin", "omp"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedBinary = candidate;
      return cachedBinary;
    }
  }
  cachedBinary = "omp";
  return cachedBinary;
}

/** Same probing strategy for the `gh` CLI. */
let cachedGh: string | null = null;

export function ghBinary(): string {
  if (cachedGh) return cachedGh;
  const candidates = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedGh = candidate;
      return cachedGh;
    }
  }
  cachedGh = "gh";
  return cachedGh;
}

export function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".omp", "agent");
}

export function sessionsDir(): string {
  return join(agentDir(), "sessions");
}

export function mcpConfigPath(): string {
  return join(agentDir(), "mcp.json");
}

/**
 * A PATH that includes the common toolchain locations, so spawned `omp`/`gh`
 * subprocesses can find their own dependencies even when launched from a
 * packaged app with a stripped environment.
 */
export function augmentedEnv(): NodeJS.ProcessEnv {
  const extra = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".bun", "bin"),
    join(homedir(), ".local", "bin"),
  ];
  const current = process.env.PATH || "";
  const parts = current.split(":").filter(Boolean);
  for (const p of extra) if (!parts.includes(p)) parts.push(p);
  return { ...process.env, PATH: parts.join(":") };
}

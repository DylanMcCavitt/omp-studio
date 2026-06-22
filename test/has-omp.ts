import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Whether a real `omp` binary is resolvable on this host.
 *
 * Mirrors src/main/paths.ts#ompBinary resolution but VERIFIES the binary
 * actually exists (rather than falling back to a bare `omp` PATH guess). This
 * lets host-dependent integration tests skip on a clean CI runner — where omp
 * is not installed, or `OMP_BINARY` is pointed at a nonexistent path — while
 * still running locally for anyone who has omp installed.
 */
export function hasOmp(): boolean {
  // An explicit override is authoritative: present iff that path exists.
  const override = process.env.OMP_BINARY;
  if (override) return existsSync(override);

  const candidates = [
    "/opt/homebrew/bin/omp",
    "/usr/local/bin/omp",
    join(homedir(), ".bun", "bin", "omp"),
    join(homedir(), ".local", "bin", "omp"),
  ];
  if (candidates.some(existsSync)) return true;

  // Bare `omp` on PATH.
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return dirs.some((dir) => existsSync(join(dir, "omp")));
}

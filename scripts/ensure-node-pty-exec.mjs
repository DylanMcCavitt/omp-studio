// Restore the executable bit on node-pty's `spawn-helper` binaries.
//
// node-pty execs a small `spawn-helper` (via posix_spawnp) to fork the pty on
// unix. Its prebuilt binaries ship with the exec bit set, but some install /
// extraction paths strip it, leaving `spawn-helper` as `-rw-r--r--` — which
// makes `terminal:create` fail at spawn time with the opaque "posix_spawnp
// failed." (no module-load error, since the .node addon itself loads fine).
//
// Run from `postinstall` so a fresh `npm install` always lands a runnable
// terminal. Idempotent, best-effort, and never fails the install: a missing
// node-pty (terminal is opt-in) or an unexpected fs error is swallowed.
//
// Covers both shapes node-pty can take: committed `prebuilds/<platform>/` and a
// source build under `build/Release/`. win32 prebuilds carry no spawn-helper, so
// the globs simply find nothing there.

import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The three exec bits (user/group/other). */
const EXEC_BITS = 0o111;

/**
 * Every `spawn-helper` path under a node-pty install: one per `prebuilds/*`
 * platform dir that has one, plus a source-built `build/Release/spawn-helper`.
 */
export function spawnHelperPaths(nodePtyDir) {
  const out = [];
  const prebuilds = join(nodePtyDir, "prebuilds");
  if (existsSync(prebuilds)) {
    for (const entry of readdirSync(prebuilds)) {
      const helper = join(prebuilds, entry, "spawn-helper");
      if (existsSync(helper)) out.push(helper);
    }
  }
  const built = join(nodePtyDir, "build", "Release", "spawn-helper");
  if (existsSync(built)) out.push(built);
  return out;
}

/**
 * Ensure one file is executable. Returns true iff the mode was changed (so the
 * already-correct common case is a cheap stat with no write).
 */
export function ensureExecutable(path) {
  const { mode } = statSync(path);
  if ((mode & EXEC_BITS) === EXEC_BITS) return false;
  chmodSync(path, mode | EXEC_BITS);
  return true;
}

/**
 * Make every node-pty spawn-helper executable. Returns the list of paths that
 * were actually changed. No-op (empty) when node-pty is absent.
 */
export function ensureNodePtyExec(nodePtyDir) {
  if (!existsSync(nodePtyDir)) return [];
  const changed = [];
  for (const helper of spawnHelperPaths(nodePtyDir)) {
    if (ensureExecutable(helper)) changed.push(helper);
  }
  return changed;
}

function main() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const nodePtyDir = join(repoRoot, "node_modules", "node-pty");
  try {
    const changed = ensureNodePtyExec(nodePtyDir);
    if (changed.length > 0) {
      console.log(
        `ensure-node-pty-exec: restored +x on ${changed.length} spawn-helper binary(ies).`,
      );
    }
  } catch (err) {
    // Best-effort: never break `npm install` over the opt-in terminal feature.
    console.warn(
      `ensure-node-pty-exec: skipped (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
}

// Only run the fs side effects when invoked as the script (postinstall), not
// when imported by a test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

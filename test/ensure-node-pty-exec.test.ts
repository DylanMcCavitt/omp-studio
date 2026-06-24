import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureExecutable,
  ensureNodePtyExec,
  spawnHelperPaths,
} from "../scripts/ensure-node-pty-exec.mjs";

const EXEC_BITS = 0o111;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "node-pty-exec-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Build a fake node-pty layout with the given relative spawn-helper paths. */
function fakeNodePty(helperRelPaths: string[]): string {
  const root = join(dir, "node-pty");
  for (const rel of helperRelPaths) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "#!/bin/sh\n");
    chmodSync(full, 0o644); // not executable
  }
  return root;
}

test("ensureExecutable sets the exec bit once and is idempotent", () => {
  const f = join(dir, "helper");
  writeFileSync(f, "x");
  chmodSync(f, 0o644);
  expect(ensureExecutable(f)).toBe(true);
  expect(statSync(f).mode & EXEC_BITS).toBe(EXEC_BITS);
  // Already executable -> no change reported.
  expect(ensureExecutable(f)).toBe(false);
});

test("spawnHelperPaths finds every prebuilds/* and build/Release helper", () => {
  const root = fakeNodePty([
    "prebuilds/darwin-arm64/spawn-helper",
    "prebuilds/darwin-x64/spawn-helper",
    "build/Release/spawn-helper",
  ]);
  const found = spawnHelperPaths(root).sort();
  expect(found).toEqual(
    [
      join(root, "prebuilds/darwin-arm64/spawn-helper"),
      join(root, "prebuilds/darwin-x64/spawn-helper"),
      join(root, "build/Release/spawn-helper"),
    ].sort(),
  );
});

test("ensureNodePtyExec chmods every helper and reports the changed ones", () => {
  const root = fakeNodePty([
    "prebuilds/darwin-arm64/spawn-helper",
    "build/Release/spawn-helper",
  ]);
  const changed = ensureNodePtyExec(root);
  expect(changed.length).toBe(2);
  for (const p of spawnHelperPaths(root)) {
    expect(statSync(p).mode & EXEC_BITS).toBe(EXEC_BITS);
  }
  // Second run is a no-op.
  expect(ensureNodePtyExec(root)).toEqual([]);
});

test("ensureNodePtyExec is a safe no-op when node-pty is absent", () => {
  expect(ensureNodePtyExec(join(dir, "does-not-exist"))).toEqual([]);
});

import { expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createChangesService,
  isContainedRelPath,
  parseFileDiff,
  parseStatusPorcelainZ,
  statusFromXY,
} from "../src/main/services/changes";

// AGE-711 — read-only local git diff service. Parser paths are exercised with
// canned git output (no git required); the integration path builds a real
// throwaway repo under the OS temp dir, so it is hermetic and never hits the
// network. It skips when `git` is unavailable.

function git(args: string, cwd: string): void {
  execSync(`git ${args}`, { stdio: ["ignore", "ignore", "ignore"], cwd });
}

function hasGit(): boolean {
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Parser unit tests (canned input — no git required)
// ---------------------------------------------------------------------------

test("parseStatusPorcelainZ maps common statuses; renames use the new path", () => {
  // NUL-separated; each entry is "XY path". A rename ("R ") emits two fields
  // — "R  new.ts" then the old path "old.ts" — so the new (current) path must
  // win and the old path must not appear as a separate entry.
  const out = [
    " M modified.ts",
    "A  added.ts",
    "D  deleted.ts",
    "?? untracked.ts",
    "R  new.ts",
    "old.ts",
    "",
  ].join("\0");
  const files = parseStatusPorcelainZ(out);
  const byPath = Object.fromEntries(files.map((f) => [f.relPath, f.status]));
  expect(byPath["modified.ts"]).toBe("modified");
  expect(byPath["added.ts"]).toBe("added");
  expect(byPath["deleted.ts"]).toBe("deleted");
  expect(byPath["untracked.ts"]).toBe("untracked");
  expect(byPath["new.ts"]).toBe("renamed");
  expect(files.some((f) => f.relPath === "old.ts")).toBe(false);
});

test("statusFromXY lets the staged char win over the unstaged char", () => {
  expect(statusFromXY("?", "?")).toBe("untracked");
  expect(statusFromXY("M", " ")).toBe("modified");
  expect(statusFromXY(" ", "M")).toBe("modified");
  expect(statusFromXY("A", "M")).toBe("added");
  expect(statusFromXY(" ", "D")).toBe("deleted");
});

test("parseFileDiff extracts hunks with add / remove / context", () => {
  const diff = [
    "diff --git a/a b/a",
    "index 1..2 100644",
    "--- a/a",
    "+++ b/a",
    "@@ -1,3 +1,4 @@",
    " keep",
    "-old",
    "+new",
    " tail",
  ].join("\n");
  const fd = parseFileDiff("a", diff);
  expect(fd.binary).toBe(false);
  expect(fd.hunks).toHaveLength(1);
  expect(fd.hunks[0]?.oldStart).toBe(1);
  expect(fd.hunks[0]?.newStart).toBe(1);
  expect(fd.hunks[0]?.lines).toEqual([
    { type: "context", text: "keep" },
    { type: "remove", text: "old" },
    { type: "add", text: "new" },
    { type: "context", text: "tail" },
  ]);
});

test("parseFileDiff flags binary changes with empty hunks", () => {
  const diff = [
    "diff --git a/x b/x",
    "index 1..2 100644",
    "Binary files a/x and b/x differ",
  ].join("\n");
  const fd = parseFileDiff("x", diff);
  expect(fd.binary).toBe(true);
  expect(fd.hunks).toEqual([]);
});

test("isContainedRelPath rejects absolute paths and parent-segment escapes", () => {
  expect(isContainedRelPath("src/a.ts")).toBe(true);
  expect(isContainedRelPath("a b/c.ts")).toBe(true);
  expect(isContainedRelPath("../escape.ts")).toBe(false);
  expect(isContainedRelPath("a/../../escape.ts")).toBe(false);
  expect(isContainedRelPath("/etc/passwd")).toBe(false);
  expect(isContainedRelPath(":(top)x")).toBe(false);
  expect(isContainedRelPath("")).toBe(false);
});

// ---------------------------------------------------------------------------
// Integration against a real temp git repo (hermetic; skips without git)
// ---------------------------------------------------------------------------

const gitTest = hasGit() ? test : test.skip;

gitTest(
  "service reports status, diffs tracked + untracked, and degrades safely",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "omp-changes-"));
    try {
      git("init -q", dir);
      git("config user.email t@t.com", dir);
      git("config user.name t", dir);
      git("config commit.gpgsign false", dir);

      // Commit a baseline, then mix an unstaged edit, a staged rename, and an
      // untracked file.
      writeFileSync(join(dir, "a.ts"), "a\nb\nc\n", "utf8");
      writeFileSync(join(dir, "stable.ts"), "s\n", "utf8");
      git("add a.ts stable.ts", dir);
      git("commit -q -m base", dir);
      writeFileSync(join(dir, "a.ts"), "a\nB\nc\n", "utf8");
      git("mv stable.ts stable-renamed.ts", dir);
      writeFileSync(join(dir, "new.ts"), "hello\n", "utf8");

      const svc = createChangesService(() => dir);

      const status = await svc.status();
      expect(status.repo).toBe(true);
      const byPath = Object.fromEntries(
        status.files.map((f) => [f.relPath, f.status]),
      );
      expect(byPath["a.ts"]).toBe("modified");
      expect(byPath["new.ts"]).toBe("untracked");
      expect(byPath["stable-renamed.ts"]).toBe("renamed");
      expect(byPath["stable.ts"]).toBeUndefined();

      // Tracked edit: combined working-tree-vs-HEAD diff with add + remove.
      const aDiff = await svc.diff("a.ts");
      expect(aDiff).not.toBeNull();
      expect(aDiff?.hunks.length).toBeGreaterThanOrEqual(1);
      const aTypes = aDiff?.hunks.flatMap((h) => h.lines.map((l) => l.type));
      expect(aTypes).toContain("add");
      expect(aTypes).toContain("remove");
      const removed = aDiff?.hunks
        .flatMap((h) => h.lines)
        .find((l) => l.type === "remove");
      expect(removed?.text).toBe("b");

      // Untracked file: the whole file renders as added (no-index fallback).
      const newDiff = await svc.diff("new.ts");
      expect(newDiff).not.toBeNull();
      const newAdds = newDiff?.hunks
        .flatMap((h) => h.lines)
        .filter((l) => l.type === "add")
        .map((l) => l.text);
      expect(newAdds).toEqual(["hello"]);

      // Path escape is refused even inside a real repo.
      expect(await svc.diff("../escape.ts")).toBeNull();

      // A directory that is not a git repo degrades to repo: false.
      const notRepo = mkdtempSync(join(tmpdir(), "omp-changes-nogit-"));
      try {
        const noGit = createChangesService(() => notRepo);
        const degraded = await noGit.status();
        expect(degraded.repo).toBe(false);
        expect(degraded.files).toEqual([]);
      } finally {
        rmSync(notRepo, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

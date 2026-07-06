import { expect, test } from "bun:test";
import { classifyBranches, parseWorktrees } from "../scripts/sync-check.mjs";

test("classifyBranches marks synced branches with valid upstream", () => {
  const output = [
    "main\torigin/main\t",
    "feature/age-100\torigin/feature/age-100\t[ahead 1]",
  ].join("\n");
  const result = classifyBranches(output);
  expect(result.synced).toEqual([
    { branch: "main", upstream: "origin/main", track: null },
    {
      branch: "feature/age-100",
      upstream: "origin/feature/age-100",
      track: "[ahead 1]",
    },
  ]);
  expect(result.goneUpstream).toEqual([]);
  expect(result.noUpstream).toEqual([]);
});

test("classifyBranches marks branches whose upstream is gone", () => {
  const output =
    "old-feature\torigin/old-feature\t[gone]\nstale\torigin/stale\t[gone]";
  const result = classifyBranches(output);
  expect(result.goneUpstream).toEqual([
    { branch: "old-feature", upstream: "origin/old-feature" },
    { branch: "stale", upstream: "origin/stale" },
  ]);
  expect(result.synced).toEqual([]);
  expect(result.noUpstream).toEqual([]);
});

test("classifyBranches marks branches without upstream", () => {
  const output = [
    "dylanmccavitt2015/age-835-platform-session-start-sync-check-script-automated-drift\t\t",
    "wip\t\t",
  ].join("\n");
  const result = classifyBranches(output);
  expect(result.noUpstream).toEqual([
    "dylanmccavitt2015/age-835-platform-session-start-sync-check-script-automated-drift",
    "wip",
  ]);
  expect(result.synced).toEqual([]);
  expect(result.goneUpstream).toEqual([]);
});

test("parseWorktrees marks healthy worktrees as ok", () => {
  const porcelain = [
    "worktree /repo/main",
    "HEAD abc123",
    "branch refs/heads/main",
    "",
    "worktree /repo/wt-age-835",
    "HEAD def456",
    "branch refs/heads/feature/age-835",
    "",
  ].join("\n");
  const fs = {
    existsSync: () => true,
    accessSync: () => {},
  };
  const worktrees = parseWorktrees(porcelain, fs);
  expect(worktrees).toHaveLength(2);
  expect(worktrees.every((wt) => wt.status === "ok")).toBe(true);
});

test("parseWorktrees marks missing worktree directories", () => {
  const porcelain = [
    "worktree /repo/main",
    "HEAD abc123",
    "branch refs/heads/main",
    "",
    "worktree /tmp/omp-wt/missing",
    "HEAD def456",
    "branch refs/heads/gone-wt",
    "",
  ].join("\n");
  const fs = {
    existsSync: (p: string) => p !== "/tmp/omp-wt/missing",
    accessSync: () => {},
  };
  const worktrees = parseWorktrees(porcelain, fs);
  const missing = worktrees.find((wt) => wt.path === "/tmp/omp-wt/missing");
  expect(missing?.status).toBe("missing_dir");
  expect(missing?.issue).toBe("directory missing");
  expect(worktrees.find((wt) => wt.path === "/repo/main")?.status).toBe("ok");
});

test("parseWorktrees marks worktrees with broken .git entries", () => {
  const porcelain = [
    "worktree /repo/broken",
    "HEAD abc123",
    "branch refs/heads/broken",
    "",
  ].join("\n");
  const fs = {
    existsSync: (p: string) =>
      p === "/repo/broken" || p === "/repo/broken/.git",
    accessSync: (p: string) => {
      if (p.endsWith(".git")) {
        const err = new Error("EACCES") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
    },
  };
  const worktrees = parseWorktrees(porcelain, fs);
  expect(worktrees[0]?.status).toBe("broken_git");
  expect(worktrees[0]?.issue).toBe(".git not readable");
});

test("parseWorktrees marks worktrees missing .git", () => {
  const porcelain = [
    "worktree /repo/no-dot-git",
    "HEAD abc123",
    "branch refs/heads/no-dot-git",
    "",
  ].join("\n");
  const fs = {
    existsSync: (p: string) => p === "/repo/no-dot-git",
    accessSync: () => {},
  };
  const worktrees = parseWorktrees(porcelain, fs);
  expect(worktrees[0]?.status).toBe("broken_git");
  expect(worktrees[0]?.issue).toBe("missing .git entry");
});

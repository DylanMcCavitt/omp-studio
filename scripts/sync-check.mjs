#!/usr/bin/env node
// Session-start drift radar: read-only git/gh checks with suggested cleanup commands.
// Pure helpers are unit-tested in test/sync-check.test.ts.

import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const defaultFs = { existsSync, accessSync };

/**
 * Classify local branches from `git for-each-ref refs/heads --format=…` output.
 * Each line: `branch<TAB>upstream<TAB>track`.
 */
export function classifyBranches(forEachRefOutput) {
  const synced = [];
  const goneUpstream = [];
  const noUpstream = [];

  for (const line of forEachRefOutput.split("\n").filter(Boolean)) {
    const [branch, upstream = "", track = ""] = line.split("\t");
    if (!upstream) {
      noUpstream.push(branch);
    } else if (track.includes("gone")) {
      goneUpstream.push({ branch, upstream });
    } else {
      synced.push({ branch, upstream, track: track.trim() || null });
    }
  }

  return { synced, goneUpstream, noUpstream };
}

/**
 * Parse `git worktree list --porcelain` and classify each registered path.
 * Optional `fs` injects { existsSync, accessSync } for unit tests.
 */
export function parseWorktrees(porcelainOutput, fs = defaultFs) {
  const worktrees = [];
  let current = null;

  for (const line of porcelainOutput.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) worktrees.push(current);
      current = {
        path: line.slice("worktree ".length),
        status: "ok",
        issue: null,
      };
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length);
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    }
  }
  if (current) worktrees.push(current);

  for (const wt of worktrees) {
    if (!fs.existsSync(wt.path)) {
      wt.status = "missing_dir";
      wt.issue = "directory missing";
      continue;
    }
    const gitPath = path.join(wt.path, ".git");
    if (!fs.existsSync(gitPath)) {
      wt.status = "broken_git";
      wt.issue = "missing .git entry";
      continue;
    }
    try {
      fs.accessSync(gitPath, constants.R_OK);
    } catch {
      wt.status = "broken_git";
      wt.issue = ".git not readable";
    }
  }

  return worktrees;
}

/** Flag open PRs whose head branch lacks an `age-` prefix (case-insensitive). */
export function classifyOpenPrs(prs) {
  return prs.filter((pr) => !/age-/i.test(pr.headRefName));
}

function execGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

function isMain() {
  const entry = process.argv[1] ?? "";
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return entry.endsWith("sync-check.mjs");
  }
}

function main() {
  const cwd = process.cwd();
  const drift = [];
  const suggestions = [];

  console.log("=== Sync check (drift radar) ===\n");

  console.log("Fetching origin (refs only)…");
  try {
    execGit(["fetch", "origin", "--prune"], cwd);
    console.log("✓ git fetch origin --prune");
  } catch (err) {
    console.log(`⚠ git fetch origin --prune failed: ${err.message}`);
    drift.push("fetch failed");
  }

  console.log("\n## main vs origin/main");
  try {
    const counts = execGit(
      ["rev-list", "--left-right", "--count", "main...origin/main"],
      cwd,
    );
    const [ahead, behind] = counts.split(/\s+/).map(Number);
    console.log(`${ahead} ahead, ${behind} behind`);
    if (ahead > 0 || behind > 0) {
      drift.push("main diverged from origin/main");
      if (behind > 0) {
        suggestions.push("git pull --rebase origin main");
      }
      if (ahead > 0) {
        suggestions.push("git push origin main");
      }
    }
  } catch (err) {
    console.log(`unavailable (${err.message})`);
    drift.push("main comparison unavailable");
  }

  console.log("\n## Working tree");
  const status = execGit(["status", "--porcelain"], cwd);
  if (status) {
    console.log("dirty / untracked:");
    console.log(status);
    drift.push("dirty working tree");
    suggestions.push("git status  # review, commit, stash, or discard");
  } else {
    console.log("clean");
  }

  console.log("\n## Registered worktrees");
  const worktrees = parseWorktrees(
    execGit(["worktree", "list", "--porcelain"], cwd),
  );
  const brokenWorktrees = worktrees.filter((wt) => wt.status !== "ok");
  if (brokenWorktrees.length > 0) {
    for (const wt of brokenWorktrees) {
      console.log(`- ${wt.path}: ${wt.issue}`);
      suggestions.push(`git worktree remove ${JSON.stringify(wt.path)}`);
    }
    drift.push("broken worktrees");
  } else {
    console.log(`${worktrees.length} registered, all paths OK`);
  }

  console.log("\n## Local branches");
  const branches = classifyBranches(
    execGit(
      [
        "for-each-ref",
        "refs/heads",
        "--format=%(refname:short)	%(upstream:short)	%(upstream:track)",
      ],
      cwd,
    ),
  );

  if (branches.goneUpstream.length > 0) {
    console.log("branches with gone upstream:");
    for (const { branch, upstream } of branches.goneUpstream) {
      console.log(`- ${branch} (was ${upstream})`);
      suggestions.push(`git branch -D ${JSON.stringify(branch)}`);
    }
    drift.push("branches with gone upstream");
  }

  if (branches.noUpstream.length > 0) {
    console.log("branches without upstream:");
    for (const branch of branches.noUpstream) {
      console.log(`- ${branch}`);
      suggestions.push(
        `git push -u origin ${JSON.stringify(branch)}  # or delete with git branch -D`,
      );
    }
    drift.push("branches without upstream");
  }

  if (branches.goneUpstream.length === 0 && branches.noUpstream.length === 0) {
    console.log("all local branches track valid upstreams");
  }

  console.log("\n## Open pull requests");
  const gh = spawnSync(
    "gh",
    ["pr", "list", "--json", "number,title,headRefName"],
    { cwd, encoding: "utf8" },
  );
  if (gh.error?.code === "ENOENT") {
    console.log("⚠ gh not found — skipping PR check");
  } else if (gh.status !== 0) {
    const detail = (gh.stderr || gh.stdout || "").trim();
    console.log(
      `⚠ gh unavailable or not authenticated — skipping PR check${detail ? `: ${detail}` : ""}`,
    );
  } else {
    const prs = JSON.parse(gh.stdout || "[]");
    const bad = classifyOpenPrs(prs);
    console.log(`${prs.length} open`);
    if (bad.length > 0) {
      console.log("heads lacking age- prefix:");
      for (const pr of bad) {
        console.log(`- #${pr.number} ${pr.title} (${pr.headRefName})`);
      }
      drift.push("open PRs without age- branch prefix");
    }
  }

  console.log("\n=== Summary ===");
  if (drift.length === 0) {
    console.log("Clean — no drift detected.");
    process.exit(0);
  }

  console.log(`Drift detected (${drift.length} issue(s)).`);
  if (suggestions.length > 0) {
    console.log("\nSuggested cleanup (not executed):");
    for (const cmd of suggestions) {
      console.log(`  ${cmd}`);
    }
  }
  process.exit(1);
}

if (isMain()) {
  main();
}

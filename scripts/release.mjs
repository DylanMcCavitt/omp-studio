#!/usr/bin/env node
// One-command release prep for OMP Studio. Bumps the version, stamps the
// CHANGELOG's "Unreleased" section into a dated release section, commits, and
// tags `vX.Y.Z`. Pushing the tag is intentionally left to a human (HITL) — the
// tag push is what triggers the Release workflow that builds + publishes.
//
//   node scripts/release.mjs patch            # 0.1.0 -> 0.1.1
//   node scripts/release.mjs minor            # 0.1.0 -> 0.2.0
//   node scripts/release.mjs major            # 0.1.0 -> 1.0.0
//   node scripts/release.mjs 0.1.0            # explicit version
//   node scripts/release.mjs patch --dry-run  # show what would change
//
// After it runs:  git push && git push origin vX.Y.Z

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const HOMEPAGE = "https://github.com/DylanMcCavitt/omp-studio";

function die(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const [maj, min, pat] = current.split(".").map(Number);
  if (bump === "major") return `${maj + 1}.0.0`;
  if (bump === "minor") return `${maj}.${min + 1}.0`;
  if (bump === "patch") return `${maj}.${min}.${pat + 1}`;
  die(`unknown bump "${bump}" (use patch|minor|major|X.Y.Z)`);
}

/** Stamp `## [Unreleased]` into a dated `## [version]` section + link refs. */
function stampChangelog(md, version, date) {
  const lines = md.split("\n");
  const idx = lines.findIndex((l) => /^##\s+\[Unreleased\]/i.test(l));
  if (idx === -1) die("CHANGELOG.md has no '## [Unreleased]' section");
  // Insert a fresh empty Unreleased above the now-dated release heading.
  lines.splice(idx + 1, 0, "", `## [${version}] - ${date}`);

  let out = lines.join("\n");
  const tagLink = `[${version}]: ${HOMEPAGE}/releases/tag/v${version}`;
  const unrelLink = `[Unreleased]: ${HOMEPAGE}/compare/v${version}...HEAD`;
  out = out.replace(/^\[Unreleased\]:.*$/m, unrelLink);
  if (!new RegExp(`^\\[${version}\\]:`, "m").test(out)) {
    out = `${out.replace(/\s*$/, "")}\n${tagLink}\n`;
  }
  if (!/^\[Unreleased\]:/m.test(out)) {
    out = `${out.replace(/\s*$/, "")}\n${unrelLink}\n`;
  }
  return out;
}

const bump = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!bump) die("usage: release.mjs <patch|minor|major|X.Y.Z> [--dry-run]");

const pkgRaw = readFileSync("package.json", "utf8");
const pkg = JSON.parse(pkgRaw);
const version = nextVersion(pkg.version, bump);
const tag = `v${version}`;
const date = new Date().toISOString().slice(0, 10);

if (!dryRun) {
  if (git(["status", "--porcelain"]))
    die("working tree not clean — commit or stash first");
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") {
    console.warn(`release: warning — on '${branch}', not 'main'`);
  }
  if (git(["tag", "-l", tag])) die(`tag ${tag} already exists`);
}

const nextPkg = pkgRaw.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
const changelog = stampChangelog(
  readFileSync("CHANGELOG.md", "utf8"),
  version,
  date,
);

console.log(`release: ${pkg.version} -> ${version}  (tag ${tag}, ${date})`);

if (dryRun) {
  const { extractSection } = await import("./changelog.mjs");
  console.log("\n--- release notes preview ---");
  console.log(extractSection(changelog, version) || "(empty)");
  console.log("--- (dry run: no files written, no commit, no tag) ---");
  process.exit(0);
}

writeFileSync("package.json", nextPkg);
writeFileSync("CHANGELOG.md", changelog);
git(["add", "package.json", "CHANGELOG.md"]);
git(["commit", "-m", `release: ${tag}`]);
git(["tag", "-a", tag, "-m", `OMP Studio ${tag}`]);

console.log(`\nCommitted + tagged ${tag}. To publish (HITL):`);
console.log("  git push && git push origin " + tag);

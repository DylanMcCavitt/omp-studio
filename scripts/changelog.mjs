#!/usr/bin/env node
// Extract one release section from CHANGELOG.md so the release pipeline can use
// it verbatim as GitHub Release notes. Pure `extractSection` (unit-tested under
// test/changelog.test.ts) + a thin CLI:
//
//   node scripts/changelog.mjs 0.1.0          # body under "## [0.1.0] ..."
//   node scripts/changelog.mjs --unreleased   # body under "## [Unreleased]"
//   node scripts/changelog.mjs 0.1.0 path.md  # explicit changelog path
//
// Exits non-zero (CLI) when the section is missing, so CI fails loudly instead
// of publishing an empty release.

import { readFileSync } from "node:fs";

const HEADING = /^##\s+\[(.+?)\]/;

/**
 * Return the markdown body beneath the `## [version]` heading, up to (but not
 * including) the next `## [` heading or EOF. Trailing link-reference lines
 * (`[x.y.z]: https://…`) are dropped. Returns `null` when no such heading.
 */
export function extractSection(markdown, version) {
  const lines = markdown.split("\n");
  const want = version.toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADING);
    if (m && m[1].toLowerCase() === want) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (HEADING.test(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines
    .slice(start, end)
    .filter((l) => !/^\[.+?\]:\s+https?:\/\//.test(l))
    .join("\n")
    .trim();
  return body;
}

function isMain() {
  const entry = process.argv[1] ?? "";
  return (
    import.meta.url === `file://${entry}` || entry.endsWith("changelog.mjs")
  );
}

if (isMain()) {
  const arg = process.argv[2];
  const path = process.argv[3] ?? "CHANGELOG.md";
  if (!arg) {
    console.error("usage: changelog.mjs <version|--unreleased> [path]");
    process.exit(2);
  }
  const version = arg === "--unreleased" ? "Unreleased" : arg.replace(/^v/, "");
  const md = readFileSync(path, "utf8");
  const section = extractSection(md, version);
  if (section == null || section === "") {
    console.error(`No CHANGELOG section for "${version}" in ${path}`);
    process.exit(1);
  }
  process.stdout.write(`${section}\n`);
}

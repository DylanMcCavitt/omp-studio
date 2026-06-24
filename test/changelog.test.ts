import { expect, test } from "bun:test";
import { extractSection } from "../scripts/changelog.mjs";

const SAMPLE = `# Changelog

## [Unreleased]

Work in progress.

## [0.2.0] - 2026-07-01

### Added

- Shiny new thing.
- Another thing.

## [0.1.0] - 2026-06-24

Initial release.

[Unreleased]: https://example.com/compare/v0.2.0...HEAD
[0.2.0]: https://example.com/releases/tag/v0.2.0
[0.1.0]: https://example.com/releases/tag/v0.1.0
`;

test("extracts a middle version section without its heading or link refs", () => {
  const section = extractSection(SAMPLE, "0.2.0");
  expect(section).toBe("### Added\n\n- Shiny new thing.\n- Another thing.");
});

test("extracts the last version section and drops trailing link references", () => {
  const section = extractSection(SAMPLE, "0.1.0");
  expect(section).toBe("Initial release.");
});

test("extracts the Unreleased section", () => {
  expect(extractSection(SAMPLE, "Unreleased")).toBe("Work in progress.");
});

test("is case-insensitive and tolerates a leading v on the query", () => {
  expect(extractSection(SAMPLE, "unreleased")).toBe("Work in progress.");
});

test("returns null for a missing version", () => {
  expect(extractSection(SAMPLE, "9.9.9")).toBeNull();
});

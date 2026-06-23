import { expect, test } from "bun:test";
import {
  clampIndex,
  commandInsertText,
  commandName,
  filterCommands,
  moveIndex,
} from "../src/renderer/src/lib/slash-commands";

// omp advertises commands without a leading slash (e.g. "compact"). These pure
// helpers drive the palette's filter + insertion.

const COMMANDS = [
  { name: "compact", description: "Compact the context window" },
  { name: "export", description: "Export the transcript to HTML" },
  { name: "model", description: "Switch the active model" },
  { name: "help" },
];

test("commandName strips a defensive leading slash", () => {
  expect(commandName({ name: "compact" })).toBe("compact");
  expect(commandName({ name: "/compact" })).toBe("compact");
  expect(commandName({ name: "//weird" })).toBe("weird");
});

test("commandInsertText always slash-prefixes with a trailing space", () => {
  // Trailing space is unconditional — we never infer a no-arg command.
  expect(commandInsertText({ name: "compact" })).toBe("/compact ");
  expect(commandInsertText({ name: "help" })).toBe("/help ");
  // A name that already carries a slash is not doubled.
  expect(commandInsertText({ name: "/export" })).toBe("/export ");
});

test("an empty query returns the list unchanged (same ref)", () => {
  expect(filterCommands(COMMANDS, "")).toBe(COMMANDS);
  expect(filterCommands(COMMANDS, "   ")).toBe(COMMANDS);
});

test("filter matches command names case-insensitively", () => {
  expect(filterCommands(COMMANDS, "co").map((c) => c.name)).toEqual([
    "compact",
  ]);
  expect(filterCommands(COMMANDS, "EXPORT").map((c) => c.name)).toEqual([
    "export",
  ]);
});

test("a leading slash in the query is ignored", () => {
  expect(filterCommands(COMMANDS, "/mod").map((c) => c.name)).toEqual([
    "model",
  ]);
});

test("filter falls back to descriptions and preserves order", () => {
  // "context" only appears in compact's description; "transcript" in export's.
  expect(filterCommands(COMMANDS, "context").map((c) => c.name)).toEqual([
    "compact",
  ]);
  // "the" appears in three descriptions → original order is preserved.
  expect(filterCommands(COMMANDS, "the").map((c) => c.name)).toEqual([
    "compact",
    "export",
    "model",
  ]);
});

test("a non-matching query yields an empty list", () => {
  expect(filterCommands(COMMANDS, "zzz")).toEqual([]);
});

test("clampIndex keeps the cursor in range and bottoms out at 0 when empty", () => {
  expect(clampIndex(5, 3)).toBe(2);
  expect(clampIndex(-1, 3)).toBe(0);
  expect(clampIndex(1, 3)).toBe(1);
  expect(clampIndex(5, 0)).toBe(0);
});

test("moveIndex navigates from the resolved index and guards the ends", () => {
  expect(moveIndex(0, "down", 3)).toBe(1);
  expect(moveIndex(2, "down", 3)).toBe(2); // already at the bottom
  expect(moveIndex(0, "up", 3)).toBe(0); // already at the top
  expect(moveIndex(2, "up", 3)).toBe(1);
  expect(moveIndex(0, "down", 0)).toBe(0); // empty list
});

test("filter-then-arrow: a stale index never selects the wrong command", () => {
  // Navigate down to index 3 in the full list...
  let index = 0;
  for (let i = 0; i < 3; i++) {
    index = moveIndex(index, "down", COMMANDS.length);
  }
  expect(index).toBe(3); // "help"

  // ...then filter to a single result. The resolved (clamped) cursor must point
  // at the only match, and Enter would select it — not the stale index 3.
  const filtered = filterCommands(COMMANDS, "compact");
  expect(filtered).toHaveLength(1);
  const resolved = clampIndex(index, filtered.length);
  expect(resolved).toBe(0);
  expect(filtered[resolved]?.name).toBe("compact");

  // ArrowUp from the resolved position stays at 0 (not 2, which the old stale
  // `index - 1` would have produced).
  expect(moveIndex(resolved, "up", filtered.length)).toBe(0);
});

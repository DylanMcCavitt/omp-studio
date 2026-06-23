import { expect, test } from "bun:test";
import {
  commandInsertText,
  commandName,
  filterCommands,
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

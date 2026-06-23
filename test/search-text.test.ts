import { expect, test } from "bun:test";
import {
  buildSnippet,
  findRanges,
  messageText,
  searchLiveSessions,
} from "../src/renderer/src/lib/searchText";
import type { OmpMessage } from "../src/shared/rpc";

test("messageText returns string content verbatim", () => {
  const msg: OmpMessage = { role: "user", content: "hello world" };
  expect(messageText(msg)).toBe("hello world");
});

test("messageText joins text blocks and ignores non-text blocks", () => {
  const msg: OmpMessage = {
    role: "assistant",
    content: [
      { type: "text", text: "first" },
      { type: "thinking", thinking: "ignored" },
      { type: "toolCall", id: "1", name: "edit", arguments: {} },
      { type: "text", text: "second" },
    ],
  };
  expect(messageText(msg)).toBe("first\nsecond");
});

test("findRanges locates all case-insensitive matches", () => {
  const ranges = findRanges("Foo foo FOO", "foo");
  expect(ranges).toEqual([
    { start: 0, end: 3 },
    { start: 4, end: 7 },
    { start: 8, end: 11 },
  ]);
});

test("findRanges returns [] for an empty needle", () => {
  expect(findRanges("anything", "")).toEqual([]);
});

test("findRanges caps at 12 ranges", () => {
  const ranges = findRanges("a".repeat(50), "a");
  expect(ranges.length).toBe(12);
});

test("buildSnippet windows around the first match with re-based ranges", () => {
  const text = `${"x".repeat(200)}NEEDLE${"y".repeat(200)}`;
  const ranges = findRanges(text, "needle");
  const built = buildSnippet(text, ranges);
  // The re-based range must point at the needle inside the snippet itself.
  const r = built.ranges[0]!;
  expect(built.snippet.slice(r.start, r.end).toLowerCase()).toBe("needle");
  // Truncated on both sides -> ellipses present.
  expect(built.snippet.startsWith("… ")).toBe(true);
  expect(built.snippet.endsWith(" …")).toBe(true);
});

test("buildSnippet flattens control whitespace length-preservingly", () => {
  const text = "alpha\n\tbeta MATCH gamma";
  const built = buildSnippet(text, findRanges(text, "match"));
  expect(built.snippet).not.toContain("\n");
  expect(built.snippet).not.toContain("\t");
  const r = built.ranges[0]!;
  expect(built.snippet.slice(r.start, r.end).toLowerCase()).toBe("match");
});

test("searchLiveSessions returns [] for an empty query", () => {
  expect(searchLiveSessions([], "")).toEqual([]);
  expect(
    searchLiveSessions([{ sessionId: "a", title: "t", messages: [] }], "   "),
  ).toEqual([]);
});

test("searchLiveSessions finds the first matching message per session", () => {
  const hits = searchLiveSessions(
    [
      {
        sessionId: "s1",
        title: "Session one",
        messages: [
          { role: "user", content: "nothing here" },
          {
            role: "assistant",
            content: [{ type: "text", text: "the WIDGET broke" }],
          },
          { role: "user", content: "another widget" },
        ],
      },
    ],
    "widget",
  );
  expect(hits.length).toBe(1);
  expect(hits[0]!.sessionId).toBe("s1");
  expect(hits[0]!.messageIndex).toBe(1);
  const r = hits[0]!.ranges[0]!;
  expect(hits[0]!.snippet.slice(r.start, r.end).toLowerCase()).toBe("widget");
});

test("searchLiveSessions falls back to a title match with messageIndex -1", () => {
  const hits = searchLiveSessions(
    [
      {
        sessionId: "s1",
        title: "Refactor the parser",
        messages: [{ role: "user", content: "no body match" }],
      },
    ],
    "parser",
  );
  expect(hits.length).toBe(1);
  expect(hits[0]!.messageIndex).toBe(-1);
  expect(hits[0]!.snippet).toBe("Refactor the parser");
});

test("searchLiveSessions omits non-matching sessions and preserves order", () => {
  const hits = searchLiveSessions(
    [
      {
        sessionId: "s1",
        title: "one",
        messages: [{ role: "user", content: "alpha" }],
      },
      {
        sessionId: "s2",
        title: "two",
        messages: [{ role: "user", content: "beta target" }],
      },
      {
        sessionId: "s3",
        title: "three",
        messages: [{ role: "user", content: "gamma" }],
      },
    ],
    "target",
  );
  expect(hits.map((h) => h.sessionId)).toEqual(["s2"]);
});

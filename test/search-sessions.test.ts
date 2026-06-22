import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSession,
  searchSessions,
} from "../src/main/services/session-store";

// Hermetic unit tests for the dependency-free transcript search. Each test runs
// against a fresh temp agent dir (via PI_CODING_AGENT_DIR) so the sessions root
// is isolated; synthetic JSONL files are written directly.

const ORIGINAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;
let agentRoot: string;
let sessionsRoot: string;

beforeEach(() => {
  agentRoot = mkdtempSync(join(tmpdir(), "omp-studio-search-"));
  process.env.PI_CODING_AGENT_DIR = agentRoot;
  sessionsRoot = join(agentRoot, "sessions");
});

afterAll(() => {
  if (ORIGINAL_AGENT_DIR === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = ORIGINAL_AGENT_DIR;
  }
});

type Msg = Record<string, unknown>;

function userMsg(text: string): Msg {
  return { role: "user", content: [{ type: "text", text }] };
}

function assistantMsg(text: string): Msg {
  return { role: "assistant", content: [{ type: "text", text }] };
}

function toolResultMsg(text: string): Msg {
  return {
    role: "toolResult",
    toolCallId: "t1",
    toolName: "read",
    content: [{ type: "text", text }],
  };
}

async function makeSession(
  project: string,
  file: string,
  header: Record<string, unknown>,
  messages: Msg[],
  mtime?: Date,
): Promise<string> {
  const dir = join(sessionsRoot, project);
  await mkdir(dir, { recursive: true });
  const path = join(dir, file);
  const lines = [JSON.stringify({ type: "session", ...header })];
  for (const message of messages) {
    lines.push(JSON.stringify({ type: "message", message }));
  }
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  if (mtime) await utimes(path, mtime, mtime);
  return path;
}

test("an empty or whitespace-only query returns no hits", async () => {
  await makeSession("proj", "a.jsonl", { id: "a" }, [userMsg("hello world")]);
  expect(await searchSessions("")).toEqual([]);
  expect(await searchSessions("   \t \n ")).toEqual([]);
});

test("matches case-insensitively with ranges that cover the query", async () => {
  await makeSession("proj", "a.jsonl", { id: "a" }, [
    userMsg("The Quick Brown Fox jumps over the lazy dog"),
  ]);

  const hits = await searchSessions("QUICK");
  expect(hits.length).toBe(1);
  const hit = hits[0]!;
  expect(hit.role).toBe("user");
  expect(hit.ranges.length).toBeGreaterThan(0);
  // Every recorded range must slice exactly to the (case-folded) query.
  for (const r of hit.ranges) {
    expect(hit.snippet.slice(r.start, r.end).toLowerCase()).toBe("quick");
  }
  expect(hit.snippet.toLowerCase()).toContain("quick");
  expect(hit.session.id).toBe("a");
});

test("records every occurrence as its own range", async () => {
  await makeSession("proj", "a.jsonl", { id: "a" }, [
    assistantMsg("ping ... ping ... ping"),
  ]);

  const hit = (await searchSessions("ping"))[0]!;
  expect(hit.ranges.length).toBe(3);
  for (const r of hit.ranges) {
    expect(hit.snippet.slice(r.start, r.end)).toBe("ping");
  }
});

test("captures the role of each matching message", async () => {
  await makeSession("proj", "a.jsonl", { id: "a" }, [
    userMsg("alpha needle one"),
    assistantMsg("beta needle two"),
    toolResultMsg("gamma needle three"),
  ]);

  const roles = (await searchSessions("needle")).map((h) => h.role).sort();
  expect(roles).toEqual(["assistant", "toolResult", "user"]);
});

test("matches plain string user content", async () => {
  await makeSession("proj", "a.jsonl", { id: "a" }, [
    { role: "user", content: "a plain string body with WIDGET inside" },
  ]);

  const hits = await searchSessions("widget");
  expect(hits.length).toBe(1);
  expect(hits[0]!.role).toBe("user");
});

test("scans text blocks only, ignoring tool-call args and image data", async () => {
  await makeSession("proj", "a.jsonl", { id: "a" }, [
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "1", name: "secretCommand", arguments: {} },
        { type: "image", data: "needlebase64payload" },
        { type: "text", text: "the visible answer" },
      ],
    },
  ]);

  expect((await searchSessions("needlebase64payload")).length).toBe(0);
  expect((await searchSessions("secretCommand")).length).toBe(0);
  expect((await searchSessions("visible")).length).toBe(1);
});

test("ranks hits from newer sessions before older ones", async () => {
  await makeSession(
    "proj",
    "old.jsonl",
    { id: "old" },
    [userMsg("a shared keyword here")],
    new Date("2026-01-01T00:00:00Z"),
  );
  await makeSession(
    "proj",
    "new.jsonl",
    { id: "new" },
    [userMsg("another shared keyword here")],
    new Date("2026-06-01T00:00:00Z"),
  );

  const hits = await searchSessions("keyword");
  expect(hits.map((h) => h.session.id)).toEqual(["new", "old"]);
  expect(hits[0]!.updatedAt > hits[1]!.updatedAt).toBe(true);
});

test("messageIndex aligns with the readSession transcript", async () => {
  const path = await makeSession("proj", "a.jsonl", { id: "a" }, [
    userMsg("first message"),
    assistantMsg("second message with a TARGET token"),
    userMsg("third message"),
  ]);

  const hits = await searchSessions("target");
  expect(hits.length).toBe(1);
  const hit = hits[0]!;
  expect(hit.messageIndex).toBe(1);

  const transcript = await readSession(path);
  const msg = transcript.messages[hit.messageIndex]!;
  expect(msg.role).toBe("assistant");
});

test("respects the hard result cap on a large synthetic history", async () => {
  // 25 sessions * 5 matching messages = 125 candidate hits; cap is 100.
  for (let s = 0; s < 25; s++) {
    const messages: Msg[] = [];
    for (let m = 0; m < 5; m++) {
      messages.push(userMsg(`session ${s} message ${m} haystack`));
    }
    await makeSession(
      "proj",
      `s${s}.jsonl`,
      { id: `s${s}` },
      messages,
      new Date(2026, 0, 1, 0, s),
    );
  }

  expect((await searchSessions("haystack")).length).toBe(100);
  // The cap is HARD: asking for more never exceeds it.
  expect((await searchSessions("haystack", { limit: 1000 })).length).toBe(100);
  // A smaller explicit limit is honoured.
  expect((await searchSessions("haystack", { limit: 7 })).length).toBe(7);
});

test("bounds the number of hits taken from one flooding session", async () => {
  const messages: Msg[] = [];
  for (let m = 0; m < 30; m++) messages.push(userMsg(`line ${m} floodword`));
  await makeSession("proj", "flood.jsonl", { id: "flood" }, messages);

  const hits = await searchSessions("floodword");
  // A single big transcript must not flood the results with all 30 matches.
  expect(hits.length).toBeLessThan(30);
  expect(hits.every((h) => h.session.id === "flood")).toBe(true);
});

import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSessions, readSession } from "../src/main/services/session-store";

// Hermetic unit tests for session-store JSONL parsing EDGE cases that the
// existing happy-path suites (search-sessions, session-actions, data-services)
// never exercise: malformed/truncated lines, a missing file, model_change
// records surfacing in summaries, the first-header-wins invariant, and the
// filename-derived id fallback. Each test runs against a fresh temp agent dir
// (via PI_CODING_AGENT_DIR) so the sessions root is isolated; raw JSONL lines
// (including deliberately broken ones) are written directly.

const ORIGINAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;
let agentRoot: string;
let sessionsRoot: string;

beforeEach(() => {
  agentRoot = mkdtempSync(join(tmpdir(), "omp-studio-edges-"));
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

// Write a session JSONL from RAW lines (no auto-wrapping), so a test can inject
// malformed/truncated records between valid ones.
async function writeRawSession(
  project: string,
  file: string,
  lines: string[],
): Promise<string> {
  const dir = join(sessionsRoot, project);
  await mkdir(dir, { recursive: true });
  const path = join(dir, file);
  await writeFile(path, lines.join("\n"), "utf8");
  return path;
}

const sessionLine = (header: Record<string, unknown>) =>
  JSON.stringify({ type: "session", ...header });
const messageLine = (text: string) =>
  JSON.stringify({
    type: "message",
    message: { role: "user", content: [{ type: "text", text }] },
  });

test("listSessions skips malformed/truncated lines but summarizes the valid records", async () => {
  await writeRawSession("proj", "2026_a.jsonl", [
    sessionLine({ id: "a", title: "Good session", cwd: "/work/a" }),
    "this is not json at all",
    messageLine("first real message"),
    "{ broken json", // unbalanced — JSON.parse throws
    messageLine("second real message"),
    '{"type":"message","mess', // truncated final line (no newline)
  ]);

  const sessions = await listSessions();
  expect(sessions).toHaveLength(1);
  const s = sessions[0]!;
  // Only the two well-formed message records are counted; garbage is dropped.
  expect(s.messageCount).toBe(2);
  // The valid header is still parsed despite the surrounding noise.
  expect(s.id).toBe("a");
  expect(s.title).toBe("Good session");
  expect(s.cwd).toBe("/work/a");
});

test("readSession skips malformed lines and returns only the valid messages", async () => {
  const path = await writeRawSession("proj", "2026_b.jsonl", [
    sessionLine({ id: "b" }),
    "garbage",
    messageLine("alpha"),
    "[unterminated",
    messageLine("beta"),
  ]);

  const { summary, messages } = await readSession(path);
  expect(summary.messageCount).toBe(2);
  expect(messages).toHaveLength(2);
  const texts = messages.map(
    (m) => (m.content as Array<{ text?: string }>)[0]?.text,
  );
  expect(texts).toEqual(["alpha", "beta"]);
});

test("readSession on a missing file degrades to an empty transcript (never throws)", async () => {
  const path = join(sessionsRoot, "proj", "does-not-exist.jsonl");
  const { summary, messages } = await readSession(path);
  expect(messages).toEqual([]);
  expect(summary.messageCount).toBe(0);
  // Id is derived from the filename when the file (and its header) is absent.
  expect(summary.id).toBe("does-not-exist");
  expect(summary.path).toBe(path);
  expect(summary.project).toBe("proj");
  expect(summary.title).toBeNull();
});

test("model_change records are reflected in the session summary model", async () => {
  const path = await writeRawSession("proj", "2026_c.jsonl", [
    sessionLine({ id: "c" }),
    messageLine("hi"),
    JSON.stringify({ type: "model_change", model: "anthropic/opus" }),
    messageLine("switch please"),
    // A later model_change wins (last one observed).
    JSON.stringify({ type: "model_change", model: "openai/gpt-5" }),
  ]);

  const list = await listSessions();
  expect(list[0]!.model).toBe("openai/gpt-5");

  const { summary } = await readSession(path);
  expect(summary.model).toBe("openai/gpt-5");
  expect(summary.messageCount).toBe(2);
});

test("a malformed model_change (non-string model) leaves the model undefined", async () => {
  await writeRawSession("proj", "2026_d.jsonl", [
    sessionLine({ id: "d" }),
    JSON.stringify({ type: "model_change", model: 42 }),
    messageLine("hi"),
  ]);

  const list = await listSessions();
  expect(list[0]!.model).toBeUndefined();
});

test("only the first session header record is honored", async () => {
  const path = await writeRawSession("proj", "2026_e.jsonl", [
    sessionLine({ id: "first", title: "First" }),
    messageLine("hi"),
    // A second, conflicting session record must be ignored.
    sessionLine({ id: "second", title: "Second" }),
  ]);

  const { summary } = await readSession(path);
  expect(summary.id).toBe("first");
  expect(summary.title).toBe("First");
});

test("a headerless session falls back to the id encoded in the filename", async () => {
  // No `type:"session"` record at all — id comes from the stem after the last
  // underscore, cwd is empty, title null, model undefined.
  await writeRawSession("proj", "sess_abc123.jsonl", [
    messageLine("orphan message"),
  ]);

  const list = await listSessions();
  expect(list).toHaveLength(1);
  const s = list[0]!;
  expect(s.id).toBe("abc123");
  expect(s.cwd).toBe("");
  expect(s.title).toBeNull();
  expect(s.model).toBeUndefined();
  expect(s.messageCount).toBe(1);
});

test("blank and whitespace-only lines are ignored when counting messages", async () => {
  await writeRawSession("proj", "2026_f.jsonl", [
    sessionLine({ id: "f" }),
    "",
    "   ",
    messageLine("only message"),
    "\t",
    "",
  ]);

  const list = await listSessions();
  expect(list[0]!.messageCount).toBe(1);
});

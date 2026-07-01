import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateExternalUrl } from "../src/main/services/external-url";
import {
  containedSessionFile,
  resolveSessionPath,
} from "../src/main/services/session-paths";

// AGE-798: session-path containment + the shared external-open URL policy.
// Every renderer-influenced session path must resolve inside the OMP
// Studio-owned roots (sessions / archived-sessions), on CANONICAL
// (symlink-resolved) paths; every external open must be a credential-free
// http(s) URL. Hermetic: fresh temp agent dir per test, no electron.

const ORIGINAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;
let agentRoot: string;
let sessionsRoot: string;
let archivedRoot: string;

beforeEach(() => {
  // realpath the tmpdir so assertions on returned paths are exact even on
  // macOS, where tmpdir() itself is a symlink (/var -> /private/var).
  agentRoot = realpathSync(mkdtempSync(join(tmpdir(), "omp-studio-paths-")));
  process.env.PI_CODING_AGENT_DIR = agentRoot;
  sessionsRoot = join(agentRoot, "sessions");
  archivedRoot = join(agentRoot, "archived-sessions");
});

afterAll(() => {
  if (ORIGINAL_AGENT_DIR === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = ORIGINAL_AGENT_DIR;
  }
});

async function makeFile(path: string, content = "{}\n"): Promise<string> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
  return path;
}

// ---------------------------------------------------------------------------
// resolveSessionPath
// ---------------------------------------------------------------------------

test("accepts a session file under the sessions root", async () => {
  const path = await makeFile(join(sessionsRoot, "proj", "a.jsonl"));
  const resolved = resolveSessionPath(path);
  expect(resolved.path).toBe(path);
  expect(resolved.root).toBe("sessions");
  expect(resolved.rel).toBe(join("proj", "a.jsonl"));
});

test("accepts a session file under the archived root", async () => {
  const path = await makeFile(join(archivedRoot, "proj", "b.jsonl"));
  const resolved = resolveSessionPath(path);
  expect(resolved.path).toBe(path);
  expect(resolved.root).toBe("archived");
  expect(resolved.rel).toBe(join("proj", "b.jsonl"));
});

test("accepts a not-yet-existing .jsonl under the sessions root", () => {
  // Callers like readSession degrade on the failed read — containment itself
  // must not require the file to exist.
  const resolved = resolveSessionPath(join(sessionsRoot, "proj", "new.jsonl"));
  expect(resolved.root).toBe("sessions");
});

test("rejects an outside-root .jsonl (absolute traversal)", async () => {
  const outside = await makeFile(join(agentRoot, "elsewhere", "x.jsonl"));
  expect(() => resolveSessionPath(outside)).toThrow(/escapes/);
});

test("rejects ../ traversal that escapes lexically", () => {
  const sneaky = join(sessionsRoot, "proj", "..", "..", "..", "etc", "x.jsonl");
  expect(() => resolveSessionPath(sneaky)).toThrow(/escapes/);
});

test("rejects a symlink under the sessions root that points outside it", async () => {
  const secret = await makeFile(join(agentRoot, "secret", "creds.jsonl"));
  await mkdir(join(sessionsRoot, "proj"), { recursive: true });
  const link = join(sessionsRoot, "proj", "escape.jsonl");
  symlinkSync(secret, link);
  expect(() => resolveSessionPath(link)).toThrow(/escapes/);
});

test("rejects a symlinked project dir that points outside the root", async () => {
  await makeFile(join(agentRoot, "secret", "deep.jsonl"));
  await mkdir(sessionsRoot, { recursive: true });
  symlinkSync(join(agentRoot, "secret"), join(sessionsRoot, "linked-proj"));
  expect(() =>
    resolveSessionPath(join(sessionsRoot, "linked-proj", "deep.jsonl")),
  ).toThrow(/escapes/);
});

test("rejects non-.jsonl candidates inside the root", async () => {
  const path = await makeFile(join(sessionsRoot, "proj", "notes.txt"));
  expect(() => resolveSessionPath(path)).toThrow(/\.jsonl/);
});

test("rejects the root itself and non-string input", () => {
  expect(() => resolveSessionPath(sessionsRoot)).toThrow();
  expect(() => resolveSessionPath(undefined)).toThrow(/string/);
  expect(() => resolveSessionPath(42)).toThrow(/string/);
  expect(() => resolveSessionPath("")).toThrow(/string/);
});

// ---------------------------------------------------------------------------
// containedSessionFile (sessions-root-only gate: drill-in + chat:resume)
// ---------------------------------------------------------------------------

test("containedSessionFile accepts a sessions-root transcript and returns the real path", async () => {
  const path = await makeFile(join(sessionsRoot, "proj", "live.jsonl"));
  expect(containedSessionFile(path)).toBe(path);
});

test("containedSessionFile rejects archived and outside paths", async () => {
  const archived = await makeFile(join(archivedRoot, "proj", "old.jsonl"));
  expect(() => containedSessionFile(archived)).toThrow(/escapes/);
  expect(() => containedSessionFile("/etc/passwd")).toThrow(/escapes/);
});

// ---------------------------------------------------------------------------
// validateExternalUrl (shared external-open policy)
// ---------------------------------------------------------------------------

test("allows plain http and https URLs", () => {
  expect(validateExternalUrl("https://example.com/path?q=1")).toEqual({
    ok: true,
    url: "https://example.com/path?q=1",
  });
  expect(validateExternalUrl("http://localhost:3000").ok).toBe(true);
});

test("denies file:, smb:, and custom schemes", () => {
  for (const raw of [
    "file:///etc/passwd",
    "smb://host/share",
    "javascript:alert(1)",
    "vscode://open?file=/etc/passwd",
    "about:blank",
    "data:text/html,<script>1</script>",
  ]) {
    const verdict = validateExternalUrl(raw);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("scheme");
  }
});

test("denies credentialed URLs", () => {
  for (const raw of [
    "https://user:pass@example.com/",
    "https://user@example.com/",
    "http://:pass@example.com/",
  ]) {
    const verdict = validateExternalUrl(raw);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("credential");
  }
});

test("denies malformed and non-string input", () => {
  expect(validateExternalUrl("not a url").ok).toBe(false);
  expect(validateExternalUrl("").ok).toBe(false);
  expect(validateExternalUrl(undefined).ok).toBe(false);
  expect(validateExternalUrl(["https://x.com"]).ok).toBe(false);
});

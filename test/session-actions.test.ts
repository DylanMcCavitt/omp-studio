import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliOptions, CliResult } from "../src/main/services/cli";
import {
  archiveSession,
  deleteSession,
  exportSessionHtml,
  listSessions,
  readSession,
  renameSession,
  revealSession,
  unarchiveSession,
} from "../src/main/services/session-store";

// Hermetic unit tests for the mutating session actions. Each test runs against
// a fresh temp agent dir (via PI_CODING_AGENT_DIR), so the sessions root,
// archive root, alias file, and exports dir are all isolated. The OS trash,
// host reveal, and `omp --export` runner are stubbed — nothing is really
// trashed and no real `omp` is spawned.

const ORIGINAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;
let agentRoot: string;
let sessionsRoot: string;

beforeEach(() => {
  agentRoot = mkdtempSync(join(tmpdir(), "omp-studio-actions-"));
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

async function makeSession(
  project: string,
  file: string,
  header: Record<string, unknown>,
  messages: Record<string, unknown>[] = [],
): Promise<string> {
  const dir = join(sessionsRoot, project);
  await mkdir(dir, { recursive: true });
  const path = join(dir, file);
  const lines = [JSON.stringify({ type: "session", ...header })];
  for (const message of messages) {
    lines.push(JSON.stringify({ type: "message", message }));
  }
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

test("deleteSession routes to the OS trash and never unlinks", async () => {
  const path = await makeSession("proj", "2026_a.jsonl", { id: "a" });
  let trashed: string | null = null;
  await deleteSession(path, async (p) => {
    trashed = p;
  });
  expect(trashed).toBe(path);
  // Trash was stubbed, so the file must still exist (recoverable, not unlinked).
  expect((await stat(path)).isFile()).toBe(true);
});

test("revealSession calls the host reveal with the file path", async () => {
  const path = await makeSession("proj", "2026_b.jsonl", { id: "b" });
  let revealed: string | null = null;
  revealSession(path, (p) => {
    revealed = p;
  });
  expect(revealed).toBe(path);
});

test("archiveSession hides from the default listing; includeArchived surfaces it", async () => {
  const path = await makeSession("proj", "2026_c.jsonl", {
    id: "c",
    title: "C",
  });

  const before = await listSessions();
  expect(before.map((s) => s.id)).toContain("c");
  expect(before.find((s) => s.id === "c")?.archived).toBe(false);

  await archiveSession(path);

  // Gone from the default listing and moved out of the sessions root.
  const afterDefault = await listSessions();
  expect(afterDefault.map((s) => s.id)).not.toContain("c");
  await expect(stat(path)).rejects.toThrow();

  // Archive root is a sibling of the sessions root, NOT under it.
  const archivedPath = join(
    agentRoot,
    "archived-sessions",
    "proj",
    "2026_c.jsonl",
  );
  expect((await stat(archivedPath)).isFile()).toBe(true);

  // includeArchived surfaces it, flagged archived.
  const withArchived = await listSessions({ includeArchived: true });
  expect(withArchived.find((s) => s.id === "c")?.archived).toBe(true);

  // Unarchive restores it to the default listing.
  await unarchiveSession(archivedPath);
  expect((await listSessions()).map((s) => s.id)).toContain("c");
  await expect(stat(archivedPath)).rejects.toThrow();
});

test("exportSessionHtml runs `omp --export <path>` and returns the html path", async () => {
  const path = await makeSession("proj", "2026_d.jsonl", { id: "d" });
  const calls: { bin: string; args: string[]; opts?: CliOptions }[] = [];
  const run = async (
    bin: string,
    args: string[],
    opts?: CliOptions,
  ): Promise<CliResult> => {
    calls.push({ bin, args, opts });
    return {
      stdout: "Exported to: omp-session-2026_d.html\n",
      stderr: "",
      code: 0,
    };
  };

  const out = await exportSessionHtml(path, run);

  expect(calls.length).toBe(1);
  expect(calls[0]!.args).toEqual(["--export", path]);
  const exportDir = join(agentRoot, "studio-exports");
  expect(calls[0]!.opts?.cwd).toBe(exportDir);
  // omp prints a bare name and writes into its cwd, so it resolves under it.
  expect(out).toBe(join(exportDir, "omp-session-2026_d.html"));
});

test("exportSessionHtml throws when the export runner fails", async () => {
  const path = await makeSession("proj", "2026_e.jsonl", { id: "e" });
  const run = async (): Promise<CliResult> => ({
    stdout: "",
    stderr: "boom",
    code: 1,
  });
  await expect(exportSessionHtml(path, run)).rejects.toThrow(/exit 1/);
});

test("renameSession persists an alias without mutating the JSONL header", async () => {
  const path = await makeSession(
    "proj",
    "2026_f.jsonl",
    { id: "f", title: "Original" },
    [{ role: "user", content: "hi" }],
  );
  const original = await readFile(path, "utf8");

  await renameSession(path, "Renamed Session");

  // The JSONL is byte-for-byte untouched.
  expect(await readFile(path, "utf8")).toBe(original);

  // The alias surfaces as the display title in both listing and read.
  const listed = await listSessions();
  expect(listed.find((s) => s.id === "f")?.title).toBe("Renamed Session");
  expect((await readSession(path)).summary.title).toBe("Renamed Session");

  // It is stored in the studio alias sidecar, keyed by path.
  const aliasFile = join(agentRoot, "studio-session-aliases.json");
  const aliases = JSON.parse(await readFile(aliasFile, "utf8")) as Record<
    string,
    string
  >;
  expect(aliases[path]).toBe("Renamed Session");
});

test("an empty rename clears the alias and restores the header title", async () => {
  const path = await makeSession("proj", "2026_g.jsonl", {
    id: "g",
    title: "Header Title",
  });
  await renameSession(path, "Temp Alias");
  expect((await readSession(path)).summary.title).toBe("Temp Alias");

  await renameSession(path, "   ");
  expect((await readSession(path)).summary.title).toBe("Header Title");
});

test("a renamed session keeps its alias after archiving", async () => {
  const path = await makeSession("proj", "2026_h.jsonl", { id: "h" });
  await renameSession(path, "Renamed H");
  await archiveSession(path);

  const archivedPath = join(
    agentRoot,
    "archived-sessions",
    "proj",
    "2026_h.jsonl",
  );
  const withArchived = await listSessions({ includeArchived: true });
  expect(withArchived.find((s) => s.id === "h")?.title).toBe("Renamed H");

  // The alias is re-keyed to the new path, leaving no stale entry.
  const aliasFile = join(agentRoot, "studio-session-aliases.json");
  const aliases = JSON.parse(await readFile(aliasFile, "utf8")) as Record<
    string,
    string
  >;
  expect(aliases[archivedPath]).toBe("Renamed H");
  expect(aliases[path]).toBeUndefined();
});

// ---------------------------------------------------------------------------
// AGE-798: every mutating action refuses a path outside the session roots —
// the injected capability (trash/reveal/export runner) must never see it.
// ---------------------------------------------------------------------------

test("deleteSession refuses an outside-root path without touching the trash", async () => {
  const outside = join(agentRoot, "not-sessions", "x.jsonl");
  await mkdir(join(agentRoot, "not-sessions"), { recursive: true });
  await writeFile(outside, "{}\n", "utf8");
  let trashed: string | null = null;
  await expect(
    deleteSession(outside, async (p) => {
      trashed = p;
    }),
  ).rejects.toThrow(/escapes/);
  expect(trashed).toBeNull();
});

test("revealSession refuses an outside-root path without revealing", () => {
  let revealed: string | null = null;
  expect(() =>
    revealSession("/etc/passwd.jsonl", (p) => {
      revealed = p;
    }),
  ).toThrow(/escapes/);
  expect(revealed).toBeNull();
});

test("archive/unarchive refuse outside-root paths and non-.jsonl files", async () => {
  await expect(archiveSession("/tmp/evil.jsonl")).rejects.toThrow(/escapes/);
  const noExt = await makeSession("proj", "2026_i.jsonl", { id: "i" });
  await expect(archiveSession(noExt.replace(/\.jsonl$/, ""))).rejects.toThrow(
    /\.jsonl/,
  );
});

test("archive destination derives from the validated root-relative layout, not raw input", async () => {
  // A path that reaches the file through a redundant-but-contained ../ hop:
  // containment normalizes it, so the destination project dir is 'proj', never
  // a traversal-derived name.
  const path = await makeSession("proj", "2026_j.jsonl", { id: "j" });
  const dotted = join(sessionsRoot, "proj", "..", "proj", "2026_j.jsonl");
  await archiveSession(dotted);
  const archivedPath = join(
    agentRoot,
    "archived-sessions",
    "proj",
    "2026_j.jsonl",
  );
  expect((await stat(archivedPath)).isFile()).toBe(true);
  await expect(stat(path)).rejects.toThrow();
});

test("exportSessionHtml refuses an outside-root path without spawning the runner", async () => {
  let spawned = 0;
  await expect(
    exportSessionHtml("/tmp/anything.jsonl", async () => {
      spawned += 1;
      return { stdout: "", stderr: "", code: 0 };
    }),
  ).rejects.toThrow(/escapes/);
  expect(spawned).toBe(0);
});

test("renameSession refuses an outside-root path and writes no alias", async () => {
  await expect(renameSession("/tmp/x.jsonl", "Evil")).rejects.toThrow(
    /escapes/,
  );
  // No alias sidecar written for the rejected path.
  const aliasFile = join(agentRoot, "studio-session-aliases.json");
  await expect(readFile(aliasFile, "utf8")).rejects.toThrow();
});

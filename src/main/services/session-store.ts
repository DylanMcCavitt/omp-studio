import { randomUUID } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import type {
  ListSessionsOptions,
  SessionSummary,
  SessionTranscript,
} from "@shared/domain";
import type { OmpMessage } from "@shared/rpc";
import { agentDir, ompBinary, sessionsDir } from "../paths";
import { runCli } from "./cli";

/** Signature of the shared CLI runner; injectable so tests can stub spawning. */
type CliRunner = typeof runCli;

/**
 * Side-effecting host capabilities, supplied by the IPC layer (electron
 * `shell`). Services stay electron-free so they remain unit-testable under
 * plain node (`bun test`); the ipc layer is the only electron boundary.
 */
export type TrashItem = (path: string) => Promise<void>;
export type RevealItem = (path: string) => void;

interface SessionHeader {
  id?: string;
  cwd?: string;
  title?: string;
  timestamp?: string;
}

interface ParsedSession {
  header: SessionHeader | null;
  messageCount: number;
  model: string | undefined;
  messages: OmpMessage[];
}

function parseSession(
  content: string,
  collectMessages: boolean,
): ParsedSession {
  let header: SessionHeader | null = null;
  let messageCount = 0;
  let model: string | undefined;
  const messages: OmpMessage[] = [];

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = record.type;
    if (type === "session") {
      if (!header) {
        header = {
          id: typeof record.id === "string" ? record.id : undefined,
          cwd: typeof record.cwd === "string" ? record.cwd : undefined,
          title: typeof record.title === "string" ? record.title : undefined,
          timestamp:
            typeof record.timestamp === "string" ? record.timestamp : undefined,
        };
      }
    } else if (type === "message") {
      messageCount += 1;
      if (collectMessages) {
        const message = record.message;
        if (message && typeof message === "object") {
          messages.push(message as OmpMessage);
        }
      }
    } else if (type === "model_change") {
      if (typeof record.model === "string") model = record.model;
    }
  }

  return { header, messageCount, model, messages };
}

function toSummary(
  path: string,
  project: string,
  file: string,
  parsed: ParsedSession,
  stats: Stats,
  archived: boolean,
): SessionSummary {
  const { header } = parsed;
  const updatedAt = stats.mtime.toISOString();
  const stem = file.endsWith(".jsonl") ? file.slice(0, -6) : file;
  const underscore = stem.lastIndexOf("_");
  const fallbackId = underscore >= 0 ? stem.slice(underscore + 1) : stem;
  return {
    id: header?.id ?? fallbackId,
    path,
    project,
    cwd: header?.cwd ?? "",
    title: header?.title ?? null,
    createdAt: header?.timestamp ?? updatedAt,
    updatedAt,
    messageCount: parsed.messageCount,
    model: parsed.model,
    sizeBytes: stats.size,
    archived,
  };
}

async function summarizeFile(
  path: string,
  project: string,
  file: string,
  archived: boolean,
): Promise<SessionSummary | null> {
  let content: string;
  let stats: Stats;
  try {
    [content, stats] = await Promise.all([readFile(path, "utf8"), stat(path)]);
  } catch {
    return null;
  }
  return toSummary(
    path,
    project,
    file,
    parseSession(content, false),
    stats,
    archived,
  );
}

// ---------------------------------------------------------------------------
// Archive + alias storage (studio-side, outside omp's JSONL)
// ---------------------------------------------------------------------------

/**
 * Archived sessions live OUTSIDE `sessionsDir()` (a sibling under `agentDir()`)
 * so the default listing never treats the archive root as a project. Both roots
 * share a filesystem, so archiving is a plain rename.
 */
function archivedDir(): string {
  return join(agentDir(), "archived-sessions");
}

/**
 * Studio-side display aliases keyed by absolute JSONL path. Renaming a
 * historical session records an alias here rather than rewriting the JSONL
 * header (omp's source of truth).
 */
function aliasStorePath(): string {
  return join(agentDir(), "studio-session-aliases.json");
}

async function readAliases(): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(aliasStorePath(), "utf8");
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

async function writeAliases(aliases: Record<string, string>): Promise<void> {
  const dir = agentDir();
  await mkdir(dir, { recursive: true });
  const target = aliasStorePath();
  const tmp = join(dir, `studio-session-aliases.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(aliases, null, 2)}\n`, "utf8");
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export async function listSessions(
  opts: ListSessionsOptions = {},
): Promise<SessionSummary[]> {
  const roots: { root: string; archived: boolean }[] = [
    { root: sessionsDir(), archived: false },
  ];
  if (opts.includeArchived) {
    roots.push({ root: archivedDir(), archived: true });
  }

  const targets: {
    path: string;
    project: string;
    file: string;
    archived: boolean;
  }[] = [];
  for (const { root, archived } of roots) {
    let slugs: Dirent[];
    try {
      slugs = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const slug of slugs) {
      if (!slug.isDirectory()) continue;
      const dir = join(root, slug.name);
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (file.endsWith(".jsonl")) {
          targets.push({
            path: join(dir, file),
            project: slug.name,
            file,
            archived,
          });
        }
      }
    }
  }

  const [results, aliases] = await Promise.all([
    Promise.all(
      targets.map((t) => summarizeFile(t.path, t.project, t.file, t.archived)),
    ),
    readAliases(),
  ]);
  const summaries = results.filter((s): s is SessionSummary => s !== null);
  for (const summary of summaries) {
    const alias = aliases[summary.path];
    if (alias !== undefined) summary.title = alias;
  }
  summaries.sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
  );
  return summaries;
}

export async function readSession(path: string): Promise<SessionTranscript> {
  let content: string;
  let stats: Stats;
  try {
    [content, stats] = await Promise.all([readFile(path, "utf8"), stat(path)]);
  } catch {
    const now = new Date().toISOString();
    const summary: SessionSummary = {
      id: basename(path).replace(/\.jsonl$/, ""),
      path,
      project: basename(dirname(path)),
      cwd: "",
      title: null,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      sizeBytes: 0,
      archived: path.startsWith(archivedDir()),
    };
    return { summary, messages: [] };
  }

  const parsed = parseSession(content, true);
  const summary = toSummary(
    path,
    basename(dirname(path)),
    basename(path),
    parsed,
    stats,
    path.startsWith(archivedDir()),
  );
  const aliases = await readAliases();
  const alias = aliases[path];
  if (alias !== undefined) summary.title = alias;
  return { summary, messages: parsed.messages };
}

// ---------------------------------------------------------------------------
// Mutating session actions
// ---------------------------------------------------------------------------

/**
 * Persist a studio-side display alias for a historical session. An empty title
 * clears any existing alias. The JSONL header is never rewritten.
 */
export async function renameSession(
  path: string,
  title: string,
): Promise<void> {
  const aliases = await readAliases();
  const trimmed = title.trim();
  if (trimmed) {
    aliases[path] = trimmed;
  } else {
    delete aliases[path];
  }
  await writeAliases(aliases);
}

/**
 * Move a session file to the OS trash (recoverable). NEVER unlinks. The trash
 * capability is injected by the IPC layer (electron `shell.trashItem`).
 */
export async function deleteSession(
  path: string,
  trash: TrashItem,
): Promise<void> {
  await trash(path);
}

/**
 * Reveal a session file in the host file manager. The reveal capability is
 * injected by the IPC layer (electron `shell.showItemInFolder`).
 */
export function revealSession(path: string, reveal: RevealItem): void {
  reveal(path);
}

/**
 * Move a session's JSONL between roots, preserving its `<project>/<file>`
 * layout. Any display alias follows the file to its new path.
 */
async function moveSession(path: string, toRoot: string): Promise<string> {
  const project = basename(dirname(path));
  const file = basename(path);
  const destDir = join(toRoot, project);
  await mkdir(destDir, { recursive: true });
  const dest = join(destDir, file);
  await rename(path, dest);
  const aliases = await readAliases();
  if (aliases[path] !== undefined) {
    aliases[dest] = aliases[path];
    delete aliases[path];
    await writeAliases(aliases);
  }
  return dest;
}

/** Archive a session: move its JSONL out of the default listing root. */
export async function archiveSession(path: string): Promise<void> {
  await moveSession(path, archivedDir());
}

/** Restore an archived session back into the default listing root. */
export async function unarchiveSession(path: string): Promise<void> {
  await moveSession(path, sessionsDir());
}

const EXPORT_TIMEOUT_MS = 60_000;

/**
 * Export a historical session to HTML via `omp --export <jsonl>` and return the
 * absolute path of the produced file. omp writes the HTML into its process cwd
 * and prints `Exported to: <name>`, so we run it in a dedicated studio exports
 * dir and resolve the printed name against that dir.
 */
export async function exportSessionHtml(
  path: string,
  run: CliRunner = runCli,
): Promise<string> {
  const outDir = join(agentDir(), "studio-exports");
  await mkdir(outDir, { recursive: true });
  const result = await run(ompBinary(), ["--export", path], {
    cwd: outDir,
    timeoutMs: EXPORT_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "no output";
    throw new Error(`omp --export failed (exit ${result.code}): ${detail}`);
  }
  const produced = parseExportedPath(result.stdout);
  if (!produced) {
    throw new Error(
      `omp --export reported no HTML path; output: ${result.stdout.trim()}`,
    );
  }
  return isAbsolute(produced) ? produced : join(outDir, produced);
}

function parseExportedPath(stdout: string): string | null {
  for (const raw of stdout.split("\n")) {
    const match = raw.trim().match(/^Exported to:\s*(.+)$/);
    if (match?.[1]) return match[1].trim();
  }
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (line.endsWith(".html")) return line;
  }
  return null;
}

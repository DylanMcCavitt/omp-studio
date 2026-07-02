import { randomUUID } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { createReadStream } from "node:fs";
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
import { createInterface } from "node:readline";
import type {
  ListSessionsOptions,
  SessionSearchHit,
  SessionSearchOptions,
  SessionSummary,
  SessionTranscript,
} from "@shared/domain";
import type { OmpMessage } from "@shared/rpc";
import { agentDir, ompBinary, sessionsDir } from "../paths";
import { runCli } from "./cli";
import { archivedDir, resolveSessionPath } from "./session-paths";

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

// Archived sessions live OUTSIDE `sessionsDir()` (a sibling under `agentDir()`);
// the root definition lives in session-paths.ts next to the containment helper
// that validates candidates against it.

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
  let resolved: string;
  let archived: boolean;
  try {
    // Containment failure degrades like an unreadable file (below): this read
    // surface must NEVER reject across IPC, and a hostile path yields the same
    // inert empty transcript as a missing one. No fs call touches the raw path.
    const contained = resolveSessionPath(path);
    resolved = contained.path;
    archived = contained.root === "archived";
    [content, stats] = await Promise.all([
      readFile(resolved, "utf8"),
      stat(resolved),
    ]);
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
    resolved,
    basename(dirname(resolved)),
    basename(resolved),
    parsed,
    stats,
    archived,
  );
  const aliases = await readAliases();
  const alias = aliases[resolved];
  if (alias !== undefined) summary.title = alias;
  return { summary, messages: parsed.messages };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Hard ceiling on returned hits; callers may request fewer but never more. */
const SEARCH_RESULT_CAP = 100;
/** Max hits surfaced from any one session, so a big transcript can't flood. */
const SEARCH_HITS_PER_SESSION = 5;
/** Characters of context kept on each side of the first match in a snippet. */
const SEARCH_SNIPPET_RADIUS = 60;
/** Max highlighted ranges recorded per hit. */
const SEARCH_MAX_RANGES = 12;
/**
 * Above this raw-line length we skip *searching* a line's content (almost always
 * a base64 image block with no searchable prose) — but we still parse and count
 * it as a message so `messageIndex` stays aligned with {@link readSession}.
 */
const SEARCH_MAX_LINE_LENGTH = 1_000_000;

type SearchRole = SessionSearchHit["role"];

/** A session file located by a cheap metadata-only scan (no content read). */
interface SessionFile {
  path: string;
  project: string;
  file: string;
  archived: boolean;
  stats: Stats;
}

/** A match found during the streamed scan, before its summary is resolved. */
interface RawHit {
  messageIndex: number;
  role: SearchRole;
  snippet: string;
  ranges: Array<{ start: number; end: number }>;
}

/**
 * Concatenate the human-readable text of a message (text blocks only). Tool-call
 * arguments and image payloads are intentionally excluded from v1 search.
 */
function messageText(message: OmpMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("\n");
}

/** All occurrence ranges of `needle` in the lowercased `text` (capped). */
function findRanges(
  text: string,
  needle: string,
): Array<{ start: number; end: number }> {
  const hay = text.toLowerCase();
  const ranges: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (ranges.length < SEARCH_MAX_RANGES) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) break;
    ranges.push({ start: idx, end: idx + needle.length });
    from = idx + needle.length;
  }
  return ranges;
}

/**
 * Build a bounded snippet windowed around the first match. Snippet offsets in
 * `ranges` are re-based to the snippet string so the renderer can highlight
 * directly; control whitespace is flattened 1:1 (length preserving) so those
 * offsets stay exact. Case folding is assumed length-preserving (true for all
 * ASCII and the overwhelming majority of text).
 */
function buildSnippet(
  text: string,
  textRanges: Array<{ start: number; end: number }>,
): { snippet: string; ranges: Array<{ start: number; end: number }> } {
  const first = textRanges[0]!;
  const winStart = Math.max(0, first.start - SEARCH_SNIPPET_RADIUS);
  const winEnd = Math.min(text.length, first.end + SEARCH_SNIPPET_RADIUS);
  const core = text.slice(winStart, winEnd).replace(/[\r\n\t]/g, " ");
  const prefix = winStart > 0 ? "… " : "";
  const suffix = winEnd < text.length ? " …" : "";
  const snippet = prefix + core + suffix;
  const offset = prefix.length - winStart;
  const ranges = textRanges
    .filter((r) => r.start >= winStart && r.end <= winEnd)
    .map((r) => ({ start: r.start + offset, end: r.end + offset }));
  return { snippet, ranges };
}

/**
 * Stream a session's JSONL line by line (never loading the whole file into
 * memory) and collect up to `cap` snippet matches whose message text contains
 * `needle` (already lowercased). `messageIndex` advances for every valid message
 * record — including unsearched over-long lines — so it stays aligned with the
 * `messages` array returned by {@link readSession}.
 */
async function scanSessionFile(
  path: string,
  needle: string,
  cap: number,
): Promise<RawHit[]> {
  const hits: RawHit[] = [];
  if (cap <= 0) return hits;
  const input = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  let messageIndex = -1;
  try {
    for await (const raw of rl) {
      const line = raw.trim();
      if (!line) continue;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (record.type !== "message") continue;
      const message = record.message;
      if (!message || typeof message !== "object") continue;
      // Count every valid message object so the index matches readSession(),
      // even for the over-long lines we skip searching below.
      messageIndex += 1;
      if (line.length > SEARCH_MAX_LINE_LENGTH) continue;
      const role = (message as { role?: unknown }).role;
      if (role !== "user" && role !== "assistant" && role !== "toolResult") {
        continue;
      }
      const text = messageText(message as OmpMessage);
      if (!text) continue;
      const ranges = findRanges(text, needle);
      if (ranges.length === 0) continue;
      hits.push({ messageIndex, role, ...buildSnippet(text, ranges) });
      if (hits.length >= cap) break;
    }
  } catch {
    // File vanished or became unreadable mid-scan: return what we gathered.
  } finally {
    rl.close();
    input.destroy();
  }
  return hits;
}

/**
 * Enumerate every session JSONL with a cheap metadata-only pass (readdir +
 * stat, never reading file contents) ordered newest-first, so search can stream
 * files one at a time instead of loading every transcript up front.
 */
async function listSessionFiles(
  includeArchived: boolean | undefined,
): Promise<SessionFile[]> {
  const roots: { root: string; archived: boolean }[] = [
    { root: sessionsDir(), archived: false },
  ];
  if (includeArchived) roots.push({ root: archivedDir(), archived: true });

  const located: Omit<SessionFile, "stats">[] = [];
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
        if (!file.endsWith(".jsonl")) continue;
        located.push({
          path: join(dir, file),
          project: slug.name,
          file,
          archived,
        });
      }
    }
  }

  const statted = await Promise.all(
    located.map(async (t): Promise<SessionFile | null> => {
      try {
        return { ...t, stats: await stat(t.path) };
      } catch {
        return null;
      }
    }),
  );
  const targets = statted.filter((t): t is SessionFile => t !== null);
  targets.sort((a, b) =>
    a.stats.mtime < b.stats.mtime ? 1 : a.stats.mtime > b.stats.mtime ? -1 : 0,
  );
  return targets;
}

/**
 * Resolve the full summary (header + alias) for a session that produced hits.
 * Reads the file once, reusing the same parse + alias path as
 * {@link listSessions} so the surfaced summary is identical.
 */
async function summarizeTarget(
  target: SessionFile,
  aliases: Record<string, string>,
): Promise<SessionSummary | null> {
  let content: string;
  try {
    content = await readFile(target.path, "utf8");
  } catch {
    return null;
  }
  const summary = toSummary(
    target.path,
    target.project,
    target.file,
    parseSession(content, false),
    target.stats,
    target.archived,
  );
  const alias = aliases[target.path];
  if (alias !== undefined) summary.title = alias;
  return summary;
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return SEARCH_RESULT_CAP;
  }
  return Math.min(Math.floor(limit), SEARCH_RESULT_CAP);
}

/**
 * Case-insensitive substring search over the message text of every session's
 * JSONL transcript. Files are located newest-first by a cheap metadata pass,
 * then streamed and scanned one at a time, stopping as soon as the hard cap is
 * reached; only sessions that actually produce hits pay for a full summary read.
 * An empty or whitespace-only query returns [].
 */
export async function searchSessions(
  query: string,
  opts: SessionSearchOptions = {},
): Promise<SessionSearchHit[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const cap = normalizeLimit(opts.limit);
  const targets = await listSessionFiles(opts.includeArchived);

  const hits: SessionSearchHit[] = [];
  let aliases: Record<string, string> | null = null;
  for (const target of targets) {
    if (hits.length >= cap) break;
    const perSession = Math.min(SEARCH_HITS_PER_SESSION, cap - hits.length);
    const raw = await scanSessionFile(target.path, needle, perSession);
    if (raw.length === 0) continue;
    if (!aliases) aliases = await readAliases();
    const session = await summarizeTarget(target, aliases);
    if (!session) continue;
    for (const r of raw) {
      hits.push({
        session,
        messageIndex: r.messageIndex,
        role: r.role,
        snippet: r.snippet,
        ranges: r.ranges,
        updatedAt: session.updatedAt,
      });
      if (hits.length >= cap) break;
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Mutating session actions
// ---------------------------------------------------------------------------

/**
 * Persist a studio-side display alias for a historical session. An empty title
 * clears any existing alias. The JSONL header is never rewritten. The alias is
 * keyed by the CONTAINED path (identical to the strings listSessions builds).
 */
export async function renameSession(
  path: string,
  title: string,
): Promise<void> {
  const resolved = resolveSessionPath(path).path;
  const aliases = await readAliases();
  const trimmed = title.trim();
  if (trimmed) {
    aliases[resolved] = trimmed;
  } else {
    delete aliases[resolved];
  }
  await writeAliases(aliases);
}

/**
 * Move a session file to the OS trash (recoverable). NEVER unlinks. The trash
 * capability is injected by the IPC layer (electron `shell.trashItem`). Only a
 * contained session path may reach the trash capability.
 */
export async function deleteSession(
  path: string,
  trash: TrashItem,
): Promise<void> {
  await trash(resolveSessionPath(path).path);
}

/**
 * Reveal a session file in the host file manager. The reveal capability is
 * injected by the IPC layer (electron `shell.showItemInFolder`). Only a
 * contained session path may reach the reveal capability.
 */
export function revealSession(path: string, reveal: RevealItem): void {
  reveal(resolveSessionPath(path).path);
}

/**
 * Move a session's JSONL between roots, preserving its root-relative
 * `<project>/<file>` layout. The destination derives from the VALIDATED
 * root-relative path — never from raw renderer input. Any display alias
 * follows the file to its new path.
 */
async function moveSession(path: string, toRoot: string): Promise<string> {
  const source = resolveSessionPath(path);
  const dest = join(toRoot, source.rel);
  await mkdir(dirname(dest), { recursive: true });
  await rename(source.path, dest);
  const aliases = await readAliases();
  const alias = aliases[source.path];
  if (alias !== undefined) {
    aliases[dest] = alias;
    delete aliases[source.path];
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
  const resolved = resolveSessionPath(path).path;
  const outDir = join(agentDir(), "studio-exports");
  await mkdir(outDir, { recursive: true });
  const result = await run(ompBinary(), ["--export", resolved], {
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

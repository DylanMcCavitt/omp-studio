import type { Dirent, Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { SessionSummary, SessionTranscript } from "@shared/domain";
import type { OmpMessage } from "@shared/rpc";
import { sessionsDir } from "../paths";

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
  };
}

async function summarizeFile(
  path: string,
  project: string,
  file: string,
): Promise<SessionSummary | null> {
  let content: string;
  let stats: Stats;
  try {
    [content, stats] = await Promise.all([readFile(path, "utf8"), stat(path)]);
  } catch {
    return null;
  }
  return toSummary(path, project, file, parseSession(content, false), stats);
}

export async function listSessions(): Promise<SessionSummary[]> {
  const root = sessionsDir();
  let slugs: Dirent[];
  try {
    slugs = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const targets: { path: string; project: string; file: string }[] = [];
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
        targets.push({ path: join(dir, file), project: slug.name, file });
      }
    }
  }

  const results = await Promise.all(
    targets.map((t) => summarizeFile(t.path, t.project, t.file)),
  );
  const summaries = results.filter((s): s is SessionSummary => s !== null);
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
  );
  return { summary, messages: parsed.messages };
}

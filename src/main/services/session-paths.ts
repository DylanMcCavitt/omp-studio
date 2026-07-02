// Path containment for renderer-influenced session file paths. Every IPC
// surface that accepts a session JSONL path (session-store actions, subagent
// drill-in, chat resume) funnels through these helpers so a hostile or
// malformed path can never escape the OMP Studio-owned session roots.
//
// Plain node, no electron — unit-testable under `bun test`.

import { realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { agentDir, sessionsDir } from "../paths";

/**
 * Archived sessions live OUTSIDE `sessionsDir()` (a sibling under `agentDir()`)
 * so the default listing never treats the archive root as a project. Both roots
 * share a filesystem, so archiving is a plain rename.
 */
export function archivedDir(): string {
  return join(agentDir(), "archived-sessions");
}

/** A renderer-supplied session path validated against the session roots. */
export interface ResolvedSessionPath {
  /**
   * Absolute path rebuilt as `<root>/<rel>` from the MATCHED root's lexical
   * form. Safe for fs operations and stable as an alias key (listSessions
   * builds its paths the same way, so the strings compare equal).
   */
  path: string;
  /** Which root contained the path. */
  root: "sessions" | "archived";
  /** Root-relative path, e.g. `<project>/<file>.jsonl`. */
  rel: string;
}

/**
 * Contain a renderer-supplied session file path to the sessions/archived roots.
 * Rejects (throws) when the path is not a string, does not end in `.jsonl`, or
 * canonicalizes (symlinks resolved on both the roots and the candidate) outside
 * both roots. Returns the matched root plus the root-relative layout so callers
 * derive destinations from the VALIDATED `<project>/<file>` — never from raw
 * renderer input.
 */
export function resolveSessionPath(raw: unknown): ResolvedSessionPath {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("session path must be a non-empty string");
  }
  if (!raw.endsWith(".jsonl")) {
    throw new Error("session path must point at a .jsonl transcript");
  }
  const real = canonicalize(raw);
  const roots = [
    { root: "sessions" as const, dir: sessionsDir() },
    { root: "archived" as const, dir: archivedDir() },
  ];
  for (const { root, dir } of roots) {
    const rel = relative(canonicalize(dir), real);
    if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) {
      return { path: join(dir, rel), root, rel };
    }
  }
  throw new Error("session path escapes the session roots");
}

// Reject a renderer-supplied sessionFile that resolves outside sessionsDir().
// A live drill-in transcript path always lives under the sessions root (it
// comes from get_subagents / subagent lifecycle frames), so anything escaping
// it is a malformed or hostile request and must never reach the child reader.
//
// The check is on the CANONICAL (symlink-resolved) paths, not the lexical ones:
// a symlink planted under the sessions root that points outside it would slip
// past a plain resolve()+relative() check, so both the root and the candidate
// are realpath'd first. Returns the contained real path; throws otherwise.
export function containedSessionFile(sessionFile: string): string {
  const root = canonicalize(sessionsDir());
  const real = canonicalize(sessionFile);
  const rel = relative(root, real);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("sessionFile escapes the sessions directory");
  }
  return real;
}

// Resolve a path to its real, symlink-free absolute form. When the target does
// not exist yet, canonicalize the nearest existing ancestor and re-append the
// remainder — so a symlinked ANCESTOR still cannot smuggle the path out of tree
// (realpathSync resolves the ancestor link). A dangling leaf symlink falls back
// to the lexical path, but reading through it just fails ENOENT — no data leak.
function canonicalize(path: string): string {
  let current = resolve(path);
  const tail: string[] = [];
  for (;;) {
    try {
      return tail.length === 0
        ? realpathSync(current)
        : join(realpathSync(current), ...tail);
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

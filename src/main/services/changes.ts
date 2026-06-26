// Workspace-scoped, read-only local git diff (feature 9). All git access lives
// in the MAIN process, scoped to the active workspace cwd via the same root
// resolver pattern the Files service uses. Only read-only porcelain git
// commands run (`rev-parse`, `status`, `diff`); there are no writes, no index
// mutation, and no network operations. Mirrors the Files service guarantees:
// never throws, degrades safely (empty status / null diff), and a missing root
// is itself a refusal.

import type {
  ChangedFile,
  ChangeStatus,
  ChangesStatus,
  DiffHunk,
  DiffLineType,
  FileDiff,
} from "@shared/domain";
import { runCli } from "./cli";

/** Resolves the active workspace root; `undefined` when none is active. */
export type GetRoot = () => string | undefined;

const EMPTY_STATUS: ChangesStatus = { repo: false, files: [] };

export interface ChangesService {
  status(): Promise<ChangesStatus>;
  diff(relPath: string): Promise<FileDiff | null>;
}

/** Bind a Changes service to a workspace-root resolver. */
export function createChangesService(getRoot: GetRoot): ChangesService {
  return {
    async status(): Promise<ChangesStatus> {
      const root = getRoot();
      if (!root) return { ...EMPTY_STATUS };
      // Cheap repo probe first: a non-git workspace or missing git reports
      // `repo: false` without parsing anything.
      const probe = await runCli(
        "git",
        ["rev-parse", "--is-inside-work-tree"],
        { cwd: root },
      );
      if (probe.code !== 0) return { ...EMPTY_STATUS };
      const res = await runCli(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=all", "-z"],
        { cwd: root },
      );
      if (res.code !== 0) return { ...EMPTY_STATUS };
      return { repo: true, files: parseStatusPorcelainZ(res.stdout) };
    },

    async diff(relPath: string): Promise<FileDiff | null> {
      const root = getRoot();
      if (!root) return null;
      if (!isContainedRelPath(relPath)) return null;
      // `git diff HEAD -- <path>` covers committed-vs-worktree for tracked
      // files (staged + unstaged combined). It shows nothing for untracked
      // files, so fall back to a no-index diff against /dev/null to render the
      // whole file as added. Both exit 1 when there are differences.
      let res = await runCli("git", ["diff", "HEAD", "--", relPath], {
        cwd: root,
      });
      if (res.code > 1 || res.stdout.trim() === "") {
        res = await runCli(
          "git",
          ["diff", "--no-index", "--", "/dev/null", relPath],
          { cwd: root },
        );
      }
      // git diff exits 0 (no changes) or 1 (differences); anything else errors.
      if (res.code > 1) return null;
      return parseFileDiff(relPath, res.stdout);
    },
  };
}

// ---------------------------------------------------------------------------
// Parsing (pure + exported for deterministic unit tests)
// ---------------------------------------------------------------------------

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Status rank: staged char (X) wins over unstaged (Y). */
const STATUS_RANK: Record<string, ChangeStatus> = {
  A: "added",
  C: "added",
  D: "deleted",
  R: "renamed",
  M: "modified",
};

/**
 * Parse `git status --porcelain=v1 -z` output (NUL-separated). Renames/copies
 * occupy two NUL fields (`XY orig\0 new`); the new (current) path wins.
 */
export function parseStatusPorcelainZ(out: string): ChangedFile[] {
  if (!out) return [];
  const records = out.split("\0");
  const files: ChangedFile[] = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    // A real entry is at least "XY " (two status chars + the separator space).
    if (!rec || rec.length < 3) continue;
    const [x = "", y = ""] = rec;
    let path = rec.slice(3);
    const renamed = x === "R" || x === "C" || y === "R" || y === "C";
    if (renamed) {
      const next = records[i + 1];
      if (next) {
        path = next;
        i++;
      }
    }
    if (path) {
      const relPath = path.includes("\\") ? path.split("\\").join("/") : path;
      files.push({ relPath, status: statusFromXY(x, y) });
    }
  }
  return files;
}

/** Map the two-char porcelain status to a single `ChangeStatus`. */
export function statusFromXY(x: string, y: string): ChangeStatus {
  if (x === "?" && y === "?") return "untracked";
  return STATUS_RANK[x] ?? STATUS_RANK[y] ?? "modified";
}

/**
 * Parse one file's `git diff` output into hunks. Lines before the first hunk
 * (diff/file/index/`---`/`+++` headers) are skipped. `binary` is true when git
 * reports a binary change (with empty `hunks`).
 */
export function parseFileDiff(relPath: string, out: string): FileDiff {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let binary = false;
  for (const line of out.split("\n")) {
    if (line.startsWith("Binary files")) {
      binary = true;
      current = null;
      continue;
    }
    const hunk = HUNK_RE.exec(line);
    if (hunk) {
      current = {
        oldStart: Number(hunk[1]),
        newStart: Number(hunk[2]),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue; // headers / metadata before the first hunk
    let type: DiffLineType | undefined;
    if (line.startsWith("+")) type = "add";
    else if (line.startsWith("-")) type = "remove";
    else if (line.startsWith("\\"))
      type = undefined; // no newline marker
    else if (line.startsWith(" ")) type = "context";
    if (type) current.lines.push({ type, text: line.slice(1) });
  }
  return { relPath, binary, hunks };
}

/** Reject absolute paths or any segment that escapes the workspace root. */
export function isContainedRelPath(relPath: string): boolean {
  if (
    typeof relPath !== "string" ||
    relPath === "" ||
    relPath.startsWith("/")
  ) {
    return false;
  }
  return relPath.split("/").every((seg) => seg !== "..");
}

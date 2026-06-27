// Workspace-scoped, read-only local git diff (feature 9). All git access lives
// in the MAIN process, scoped to the active workspace cwd via the same root
// resolver pattern the Files service uses. Only read-only porcelain git
// commands run (`rev-parse`, `status`, `diff`); there are no writes, no index
// mutation, and no network operations. Mirrors the Files service guarantees:
// never throws, degrades safely (empty status / null diff), and a missing root
// is itself a refusal.
//
// SECURITY: git runs with hostile, repo-configured helpers DISABLED —
// `core.fsmonitor` is overridden to false (status) and external-diff/textconv
// drivers are turned off (`--no-ext-diff --no-textconv`) — so a workspace's
// `.git/config` cannot execute arbitrary commands through this surface. Output
// is byte-capped to bound memory, and the untracked-file fallback is gated on a
// realpath containment check so a symlink cannot read files outside the root.

import type {
  ChangedFile,
  ChangeStatus,
  ChangesStatus,
  DiffHunk,
  DiffLineType,
  FileDiff,
  GitWorkspaceInfo,
} from "@shared/domain";
import { runCli } from "./cli";
import { containedPath } from "./files";

/** Resolves the active workspace root; `undefined` when none is active. */
export type GetRoot = () => string | undefined;

const EMPTY_STATUS: ChangesStatus = { repo: false, files: [] };
const EMPTY_WORKSPACE_INFO: GitWorkspaceInfo = {
  repo: false,
  branch: null,
  worktreePath: null,
};

/** Cap collected `git status` output (paths are small; this bounds memory). */
const MAX_STATUS_BYTES = 512 * 1024;
/** Cap collected `git diff` output so a huge diff cannot exhaust the process. */
const MAX_DIFF_BYTES = 1024 * 1024;

/**
 * Shared git argv prefix: `-c core.fsmonitor=false` disables a repo-configured
 * fsmonitor hook that `git status` would otherwise invoke.
 */
const GIT_BASE = ["-c", "core.fsmonitor=false"] as const;
/**
 * `git diff` flags that disable repo-configured external diff drivers and
 * textconv filters (`diff.external`, `diff.<driver>.command`), which could
 * otherwise execute arbitrary commands from the workspace's `.git/config`.
 */
const DIFF_SAFE = ["--no-ext-diff", "--no-textconv"] as const;

export interface ChangesService {
  status(): Promise<ChangesStatus>;
  workspaceInfo(): Promise<GitWorkspaceInfo>;
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
        [...GIT_BASE, "rev-parse", "--is-inside-work-tree"],
        { cwd: root, maxBytes: MAX_STATUS_BYTES },
      );
      if (probe.code !== 0) return { ...EMPTY_STATUS };
      // `-- .` scopes status to the workspace cwd (so a workspace that is a
      // subdirectory of a larger repo only reports its own changes); paths come
      // back workspace-relative.
      const res = await runCli(
        "git",
        [
          ...GIT_BASE,
          "status",
          "--porcelain=v1",
          "--untracked-files=all",
          "-z",
          "--",
          ".",
        ],
        { cwd: root, maxBytes: MAX_STATUS_BYTES },
      );
      if (res.code !== 0) return { ...EMPTY_STATUS };
      return { repo: true, files: parseStatusPorcelainZ(res.stdout) };
    },

    async workspaceInfo(): Promise<GitWorkspaceInfo> {
      const root = getRoot();
      if (!root) return { ...EMPTY_WORKSPACE_INFO };
      const probe = await runCli(
        "git",
        [...GIT_BASE, "rev-parse", "--is-inside-work-tree"],
        { cwd: root, maxBytes: MAX_STATUS_BYTES },
      );
      if (probe.code !== 0) return { ...EMPTY_WORKSPACE_INFO };

      const [branch, worktree] = await Promise.all([
        runCli("git", [...GIT_BASE, "branch", "--show-current"], {
          cwd: root,
          maxBytes: MAX_STATUS_BYTES,
        }),
        runCli("git", [...GIT_BASE, "rev-parse", "--show-toplevel"], {
          cwd: root,
          maxBytes: MAX_STATUS_BYTES,
        }),
      ]);

      return {
        repo: true,
        branch:
          branch.code === 0 && branch.stdout.trim() !== ""
            ? branch.stdout.trim()
            : null,
        worktreePath:
          worktree.code === 0 && worktree.stdout.trim() !== ""
            ? worktree.stdout.trim()
            : null,
      };
    },

    async diff(relPath: string): Promise<FileDiff | null> {
      const root = getRoot();
      if (!root) return null;
      if (!isContainedRelPath(relPath)) return null;
      // `git diff HEAD -- <path>` covers committed-vs-worktree for tracked
      // files (staged + unstaged combined). git diff exits 0 (no changes) or 1
      // (differences); a spawn failure / timeout / output cap resolves -1.
      const head = await runCli(
        "git",
        [...GIT_BASE, "diff", ...DIFF_SAFE, "HEAD", "--", relPath],
        { cwd: root, maxBytes: MAX_DIFF_BYTES },
      );
      const headOk = head.code === 0 || head.code === 1;
      if (headOk && head.stdout.trim() !== "") {
        return parseFileDiff(relPath, head.stdout);
      }
      // If the HEAD diff itself failed/capped, do not attempt a second read.
      if (!headOk) return null;
      // Untracked files show nothing against HEAD; render the whole file as
      // added via a no-index diff. Gate this on a realpath containment check so
      // an untracked symlink cannot read a target outside the workspace root.
      if (!containedPath(root, relPath)) return null;
      const idx = await runCli(
        "git",
        [
          ...GIT_BASE,
          "diff",
          ...DIFF_SAFE,
          "--no-index",
          "--",
          "/dev/null",
          relPath,
        ],
        { cwd: root, maxBytes: MAX_DIFF_BYTES },
      );
      if (idx.code !== 0 && idx.code !== 1) return null;
      return parseFileDiff(relPath, idx.stdout);
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
 * Parse `git status --porcelain=v1 -z` output (NUL-separated). A rename/copy
 * occupies two NUL fields — `XY newpath\0 oldpath` — so the current path is the
 * first field; the second (old path) is discarded.
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
    const path = rec.slice(3);
    const renamed = x === "R" || x === "C" || y === "R" || y === "C";
    if (renamed) {
      // Skip the trailing old-path field; the new (current) path is `path`.
      if (i + 1 < records.length) i++;
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

/**
 * Fast lexical guard for a renderer-supplied relPath: reject absolute paths,
 * git pathspec magic (`:`), and any `..` segment. (The no-index fallback adds a
 * realpath containment check on top of this to block symlink escapes.)
 */
export function isContainedRelPath(relPath: string): boolean {
  if (
    typeof relPath !== "string" ||
    relPath === "" ||
    relPath.startsWith("/") ||
    relPath.startsWith(":")
  ) {
    return false;
  }
  return relPath.split("/").every((seg) => seg !== "..");
}

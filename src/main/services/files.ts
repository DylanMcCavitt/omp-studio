// Workspace file-tree + editor backend (feature 4). All FS access lives in the
// MAIN process, path-contained under the active workspace cwd; the renderer only
// ever sees `FileEntry` / `FileContent`. Plain node (no electron) so it stays
// unit-testable under `bun test`; the workspace root is injected via `getRoot`
// (the ipc layer threads the active-session cwd) and a temp dir in tests.
//
// SECURITY: `containedPath` realpaths the root, resolves the renderer-supplied
// join, and rejects anything whose canonical (symlink-resolved) path escapes the
// root — BEFORE any fs op. Mirrors the AGE-617 sessionFile containment. Every
// method degrades safely ([] / null / { ok:false }) and NEVER throws; a missing
// workspace root is itself a refusal.

import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { realpathSync } from "node:fs";
import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type { FileContent, FileEntry } from "@shared/domain";

/** Resolves the active workspace root; `undefined` when none is active yet. */
export type GetRoot = () => string | undefined;

/** Max entries returned from a single shallow `readDir` (huge dirs are clipped). */
const MAX_ENTRIES = 1000;
/** Hard read cap; files larger than this are reported `tooLarge`, not read. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Prefix scanned for NUL bytes to classify a file as binary. */
const BINARY_SNIFF_BYTES = 8192;
/** Heavy / noise directories omitted from listings (lazy-tree signal). */
const SKIP_DIRS: Record<string, true> = {
  node_modules: true,
  ".git": true,
};

export interface FilesService {
  readDir(relPath?: string): Promise<FileEntry[]>;
  readFile(relPath: string): Promise<FileContent | null>;
  writeFile(
    relPath: string,
    text: string,
  ): Promise<{ ok: boolean; error?: string }>;
}

/** Bind a Files service to a workspace-root resolver. */
export function createFilesService(getRoot: GetRoot): FilesService {
  return {
    readDir: (relPath = ".") => readDir(getRoot(), relPath),
    readFile: (relPath) => readFile(getRoot(), relPath),
    writeFile: (relPath, text) => writeFile(getRoot(), relPath, text),
  };
}

// ---------------------------------------------------------------------------
// Containment
// ---------------------------------------------------------------------------

/**
 * Resolve `relPath` under `root` to its canonical absolute path, or `null` when
 * it escapes the root. Defense is layered: (1) a SYNTACTIC pre-check rejects an
 * absolute path or any `..` segment in the renderer-supplied `relPath` before
 * any fs access, so a traversal/absolute path can never probe (realpath/stat)
 * outside the root; (2) the resolved join is canonicalized so a symlink (leaf
 * or ancestor) under the root pointing outside it is unmasked; (3) a final
 * `relative()` check rejects anything still outside. An unresolvable root or a
 * missing root both yield `null`.
 */
export function containedPath(root: string, relPath: string): string | null {
  return resolveContained(root, relPath)?.abs ?? null;
}

function resolveContained(
  root: string | undefined,
  relPath: string,
): { realRoot: string; abs: string } | null {
  if (!root) return null;
  // (1) Syntactic rejection BEFORE touching the fs: the renderer must supply a
  // workspace-relative descent. An absolute path (which `resolve` would honour
  // verbatim, even one crafted to land back inside) or any `..` segment is
  // hostile/malformed and is refused without a single syscall.
  if (isAbsolute(relPath) || relPath.split(/[/\\]/).includes("..")) {
    return null;
  }
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return null;
  }
  // (2) Canonicalize the resolved join so an in-root symlink pointing outside is
  // unmasked, then (3) reject if the canonical path still escapes. `rel === ""`
  // means the target IS the root (valid for listing root).
  const abs = canonicalize(resolve(realRoot, relPath));
  const rel = relative(realRoot, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return { realRoot, abs };
}

/**
 * Resolve a path to its real, symlink-free absolute form. When the leaf does
 * not exist yet (a fresh `writeFile` target), canonicalize the nearest existing
 * ancestor and re-append the remainder — so a symlinked ANCESTOR still cannot
 * smuggle the path out of tree. A dangling leaf symlink falls back to the
 * lexical path; reading/writing through it then fails on its own with no leak.
 */
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

function toPosix(rel: string): string {
  return sep === "/" ? rel : rel.split(sep).join("/");
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

async function readDir(
  root: string | undefined,
  relPath: string,
): Promise<FileEntry[]> {
  const resolved = resolveContained(root, relPath);
  if (!resolved) return [];
  const { realRoot, abs } = resolved;

  let dirents: Dirent[];
  try {
    dirents = await readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries: FileEntry[] = [];
  for (const d of dirents) {
    if (SKIP_DIRS[d.name] === true) continue;
    const isDir = d.isDirectory();
    const entry: FileEntry = {
      name: d.name,
      path: toPosix(relative(realRoot, join(abs, d.name))),
      kind: isDir ? "dir" : "file",
    };
    if (d.name.startsWith(".")) entry.isHidden = true;
    entries.push(entry);
  }

  // Directories first, then files; case-insensitive name sort within each group.
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const capped = entries.slice(0, MAX_ENTRIES);

  // lstat (not stat) only the survivors for size — bounds syscalls to
  // <=MAX_ENTRIES on a huge directory AND never follows a symlink: a regular
  // file reports its size, while a symlink (lstat → isFile() false) is left
  // size-less so a `link -> /outside/secret` can't leak the target's byte size.
  await Promise.all(
    capped.map(async (entry) => {
      if (entry.kind !== "file") return;
      try {
        const st = await lstat(join(abs, entry.name));
        if (st.isFile()) entry.size = st.size;
      } catch {
        // Unreadable/dangling entry — omit size, keep the entry listed.
      }
    }),
  );

  return capped;
}

async function readFile(
  root: string | undefined,
  relPath: string,
): Promise<FileContent | null> {
  const resolved = resolveContained(root, relPath);
  if (!resolved) return null;
  const { realRoot, abs } = resolved;

  let size: number;
  try {
    const st = await stat(abs);
    if (!st.isFile()) return null;
    size = st.size;
  } catch {
    return null;
  }

  const path = toPosix(relative(realRoot, abs));
  if (size > MAX_FILE_BYTES) {
    return { path, text: "", truncated: false, tooLarge: true, binary: false };
  }

  let buf: Buffer;
  try {
    buf = await fsReadFile(abs);
  } catch {
    return null;
  }
  if (isBinary(buf)) {
    return { path, text: "", truncated: false, tooLarge: false, binary: true };
  }
  return {
    path,
    text: buf.toString("utf8"),
    truncated: false,
    tooLarge: false,
    binary: false,
  };
}

async function writeFile(
  root: string | undefined,
  relPath: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const resolved = resolveContained(root, relPath);
  if (!resolved) {
    return { ok: false, error: "path escapes the workspace root" };
  }
  const { realRoot, abs } = resolved;

  const base = basename(abs);
  const tmpName = `.${base}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(abs), { recursive: true });
    // TOCTOU defense: the parent passed containment at validation, but a local
    // process could swap it for a symlink between then and now. Re-resolve the
    // parent's REAL path AFTER creating it and re-verify containment, then bind
    // the tmp write + rename to that resolved directory — so even a swapped
    // symlink parent cannot redirect the write outside the workspace root.
    const realParent = realpathSync(dirname(abs));
    const relParent = relative(realRoot, realParent);
    if (relParent.startsWith("..") || isAbsolute(relParent)) {
      return { ok: false, error: "path escapes the workspace root" };
    }
    const target = join(realParent, base);
    const tmp = join(realParent, tmpName);
    try {
      await fsWriteFile(tmp, text, { encoding: "utf8", mode: 0o600 });
      await rename(tmp, target);
      return { ok: true };
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      return { ok: false, error: (err as Error).message };
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function isBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

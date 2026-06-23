import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile as fsReadFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containedPath, createFilesService } from "../src/main/services/files";

// Each test gets an isolated temp workspace root plus a sibling "outside" dir
// (NOT under the root) used to prove containment rejects escapes.
let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omp-files-root-"));
  outside = mkdtempSync(join(tmpdir(), "omp-files-outside-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const service = () => createFilesService(() => root);

test("readDir lists shallow, dirs-first, name-sorted, flags hidden, skips heavy dirs", async () => {
  mkdirSync(join(root, "b-dir"));
  mkdirSync(join(root, "a-dir"));
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "b.txt"), "bbb");
  writeFileSync(join(root, "a.txt"), "a");
  writeFileSync(join(root, ".hidden"), "secret");

  const entries = await service().readDir();
  const names = entries.map((e) => e.name);

  // node_modules / .git are omitted entirely.
  expect(names).not.toContain("node_modules");
  expect(names).not.toContain(".git");

  // Directories sort before files; both groups are name-sorted.
  const dirs = entries.filter((e) => e.kind === "dir").map((e) => e.name);
  const files = entries.filter((e) => e.kind === "file").map((e) => e.name);
  expect(dirs).toEqual(["a-dir", "b-dir"]);
  expect(files).toEqual([...files].sort((x, y) => x.localeCompare(y)));
  // Every dir precedes every file in the returned order.
  const firstFileIdx = entries.findIndex((e) => e.kind === "file");
  expect(entries.slice(0, firstFileIdx).every((e) => e.kind === "dir")).toBe(
    true,
  );

  // Dotfiles are flagged; regular files are not. Sizes are reported for files.
  const hidden = entries.find((e) => e.name === ".hidden");
  expect(hidden?.isHidden).toBe(true);
  const aTxt = entries.find((e) => e.name === "a.txt");
  expect(aTxt?.isHidden).toBeUndefined();
  expect(aTxt?.size).toBe(1);
  // Workspace-relative path at root level is just the name.
  expect(aTxt?.path).toBe("a.txt");
  // Directories carry no size.
  expect(entries.find((e) => e.name === "a-dir")?.size).toBeUndefined();
});

test("readDir nested returns workspace-relative POSIX paths", async () => {
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "index.ts"), "export {};");

  const entries = await service().readDir("src");
  expect(entries.map((e) => e.path)).toEqual(["src/index.ts"]);
});

test("readDir caps at 1000 entries", async () => {
  for (let i = 0; i < 1200; i++) {
    writeFileSync(join(root, `f${i}.txt`), "x");
  }
  const entries = await service().readDir();
  expect(entries.length).toBe(1000);
});

test("readFile returns decoded text for a small text file", async () => {
  writeFileSync(join(root, "hello.txt"), "hello world");
  const content = await service().readFile("hello.txt");
  expect(content).toEqual({
    path: "hello.txt",
    text: "hello world",
    truncated: false,
    tooLarge: false,
    binary: false,
  });
});

test("readFile flags files over the 2MB cap as tooLarge without reading", async () => {
  const big = "a".repeat(2 * 1024 * 1024 + 1);
  writeFileSync(join(root, "big.txt"), big);
  const content = await service().readFile("big.txt");
  expect(content?.tooLarge).toBe(true);
  expect(content?.binary).toBe(false);
  expect(content?.text).toBe("");
});

test("readFile flags NUL-containing files as binary without decoding", async () => {
  writeFileSync(join(root, "bin.dat"), Buffer.from([0x68, 0x00, 0x69]));
  const content = await service().readFile("bin.dat");
  expect(content?.binary).toBe(true);
  expect(content?.text).toBe("");
  expect(content?.tooLarge).toBe(false);
});

test("readFile returns null for a missing path or a directory", async () => {
  mkdirSync(join(root, "adir"));
  expect(await service().readFile("nope.txt")).toBeNull();
  expect(await service().readFile("adir")).toBeNull();
});

test("writeFile atomically round-trips and leaves no tmp residue", async () => {
  const res = await service().writeFile("sub/new.txt", "saved");
  expect(res).toEqual({ ok: true });

  // Content is readable and parent dir was created.
  expect(await fsReadFile(join(root, "sub", "new.txt"), "utf8")).toBe("saved");
  expect((await service().readFile("sub/new.txt"))?.text).toBe("saved");

  // No leftover *.tmp files in the target directory.
  expect(readdirSync(join(root, "sub")).some((n) => n.endsWith(".tmp"))).toBe(
    false,
  );

  // Overwrite replaces atomically.
  expect(await service().writeFile("sub/new.txt", "again")).toEqual({
    ok: true,
  });
  expect((await service().readFile("sub/new.txt"))?.text).toBe("again");
});

test("containedPath / operations reject ../ traversal", async () => {
  writeFileSync(join(outside, "secret.txt"), "leak");

  expect(containedPath(root, "../secret.txt")).toBeNull();
  expect(containedPath(root, "../../etc/passwd")).toBeNull();

  // The traversal must be refused at every operation, before any fs touch.
  expect(await service().readFile("../" + "secret.txt")).toBeNull();
  expect(await service().readDir("..")).toEqual([]);
  expect(await service().writeFile("../evil.txt", "x")).toEqual({
    ok: false,
    error: expect.any(String),
  });
});

test("containedPath / operations reject symlinks pointing outside the root", async () => {
  writeFileSync(join(outside, "secret.txt"), "leak");
  // A symlinked directory and a symlinked file, both escaping the root.
  symlinkSync(outside, join(root, "escape-dir"));
  symlinkSync(join(outside, "secret.txt"), join(root, "escape-file"));

  expect(containedPath(root, "escape-dir")).toBeNull();
  expect(containedPath(root, "escape-dir/secret.txt")).toBeNull();
  expect(containedPath(root, "escape-file")).toBeNull();

  // No data leaks through the link at any operation.
  expect(await service().readFile("escape-file")).toBeNull();
  expect(await service().readFile("escape-dir/secret.txt")).toBeNull();
  expect(await service().readDir("escape-dir")).toEqual([]);

  // A write through an escaping symlink is refused and never reaches the target.
  expect((await service().writeFile("escape-file", "tampered")).ok).toBe(false);
  expect(await fsReadFile(join(outside, "secret.txt"), "utf8")).toBe("leak");
});

test("containedPath accepts in-root paths and the root itself", () => {
  expect(containedPath(root, ".")).not.toBeNull();
  expect(containedPath(root, "src/index.ts")).not.toBeNull();
});

test("no workspace root resolves to a safe refusal everywhere", async () => {
  const svc = createFilesService(() => undefined);
  expect(await svc.readDir()).toEqual([]);
  expect(await svc.readFile("x.txt")).toBeNull();
  expect((await svc.writeFile("x.txt", "y")).ok).toBe(false);
  // A root that does not exist on disk is likewise refused (unresolvable).
  expect(containedPath(join(outside, "does-not-exist"), "x")).toBeNull();
});

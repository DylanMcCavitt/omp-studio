// AGE-634 — the Files store. The behaviors that matter: the tree expands lazily
// (one readDir per directory, cached across collapse/expand); opening a file
// reads it once, adds a focused tab, and carries the read-only flags; editing
// tracks dirty against the saved baseline; save writes the buffer and toasts the
// outcome; closing re-focuses a sensible neighbor; and the confirm wrapper guards
// unsaved edits. All bridge calls are stubbed on window.omp.files.

import type { FileContent, FileEntry } from "@shared/domain";
import type { OmpApi } from "@shared/ipc";
import {
  CHAT_TAB,
  closeFileWithConfirm,
  type FileTab,
  useFilesStore,
} from "@/store/files";
import { useToastStore } from "@/store/toast";

function stubFiles(over: Partial<OmpApi["files"]>) {
  Object.assign(window.omp, { files: over });
}

/** Read an open tab, asserting it exists (keeps `noUncheckedIndexedAccess` happy). */
function tabOf(path: string): FileTab {
  const tab = useFilesStore.getState().tabs[path];
  if (!tab) throw new Error(`expected an open tab for ${path}`);
  return tab;
}

function entry(
  over: Partial<FileEntry> & { name: string; path: string },
): FileEntry {
  return { kind: "file", ...over };
}

function content(over: Partial<FileContent> & { path: string }): FileContent {
  return {
    text: "",
    truncated: false,
    tooLarge: false,
    binary: false,
    ...over,
  };
}

beforeEach(() => {
  useFilesStore.setState({
    children: {},
    expanded: {},
    dirLoading: {},
    tabs: {},
    order: [],
    activeTab: CHAT_TAB,
  });
  useToastStore.setState({ toasts: [] });
});

it("expands a directory, lazily loads it once, and caches across re-expand", async () => {
  const readDir = vi.fn(async (rel?: string) =>
    rel === "src" ? [entry({ name: "a.ts", path: "src/a.ts" })] : [],
  );
  stubFiles({ readDir });

  useFilesStore.getState().toggleDir("src");
  await vi.waitFor(() =>
    expect(useFilesStore.getState().children.src).toBeDefined(),
  );
  expect(readDir).toHaveBeenCalledWith("src");
  expect(useFilesStore.getState().children.src).toHaveLength(1);
  expect(useFilesStore.getState().expanded.src).toBe(true);

  // Collapse then re-expand — served from cache, no second fetch.
  useFilesStore.getState().toggleDir("src");
  expect(useFilesStore.getState().expanded.src).toBe(false);
  useFilesStore.getState().toggleDir("src");
  expect(readDir).toHaveBeenCalledTimes(1);
});

it("openFile reads the file, adds a focused tab, and clears dirty", async () => {
  const readFile = vi.fn(async (rel: string) =>
    content({ path: rel, text: "hello" }),
  );
  stubFiles({ readFile });

  await useFilesStore.getState().openFile("src/a.ts");

  const s = useFilesStore.getState();
  expect(readFile).toHaveBeenCalledWith("src/a.ts");
  expect(s.order).toEqual(["src/a.ts"]);
  expect(s.activeTab).toBe("src/a.ts");
  expect(s.tabs["src/a.ts"]).toMatchObject({
    text: "hello",
    savedText: "hello",
    dirty: false,
    loading: false,
  });
});

it("openFile carries the tooLarge and binary read-only flags", async () => {
  stubFiles({
    readFile: async (rel) =>
      content({
        path: rel,
        tooLarge: rel.includes("big"),
        binary: rel.includes("bin"),
      }),
  });

  await useFilesStore.getState().openFile("big.log");
  await useFilesStore.getState().openFile("bin.dat");

  expect(tabOf("big.log").tooLarge).toBe(true);
  expect(tabOf("bin.dat").binary).toBe(true);
});

it("openFile flags an error tab when the read returns null", async () => {
  stubFiles({ readFile: async () => null });
  await useFilesStore.getState().openFile("missing.ts");
  expect(tabOf("missing.ts").error).toBe(true);
});

it("re-opening an open file just focuses it (no second read)", async () => {
  const readFile = vi.fn(async (rel: string) =>
    content({ path: rel, text: "x" }),
  );
  stubFiles({ readFile });

  await useFilesStore.getState().openFile("a.ts");
  useFilesStore.getState().setActiveTab(CHAT_TAB);
  await useFilesStore.getState().openFile("a.ts");

  expect(readFile).toHaveBeenCalledTimes(1);
  expect(useFilesStore.getState().activeTab).toBe("a.ts");
});

it("setDirtyText marks dirty and clears when restored to the saved text", async () => {
  stubFiles({ readFile: async (rel) => content({ path: rel, text: "base" }) });
  await useFilesStore.getState().openFile("a.ts");

  useFilesStore.getState().setDirtyText("a.ts", "base+");
  expect(tabOf("a.ts").dirty).toBe(true);

  useFilesStore.getState().setDirtyText("a.ts", "base");
  expect(tabOf("a.ts").dirty).toBe(false);
});

it("save writes the buffer, clears dirty, and toasts success", async () => {
  const writeFile = vi.fn(async () => ({ ok: true }));
  stubFiles({
    readFile: async (rel) => content({ path: rel, text: "base" }),
    writeFile,
  });
  await useFilesStore.getState().openFile("a.ts");
  useFilesStore.getState().setDirtyText("a.ts", "edited");

  await useFilesStore.getState().save("a.ts");

  expect(writeFile).toHaveBeenCalledWith("a.ts", "edited");
  expect(tabOf("a.ts").dirty).toBe(false);
  expect(
    useToastStore.getState().toasts.some((t) => t.kind === "success"),
  ).toBe(true);
});

it("save keeps the tab dirty and toasts the detail on a failed write", async () => {
  stubFiles({
    readFile: async (rel) => content({ path: rel, text: "base" }),
    writeFile: async () => ({ ok: false, error: "denied" }),
  });
  await useFilesStore.getState().openFile("a.ts");
  useFilesStore.getState().setDirtyText("a.ts", "edited");

  await useFilesStore.getState().save("a.ts");

  expect(tabOf("a.ts").dirty).toBe(true);
  const err = useToastStore.getState().toasts.find((t) => t.kind === "error");
  expect(err?.detail).toBe("denied");
});

it("save is a no-op for a clean tab", async () => {
  const writeFile = vi.fn(async () => ({ ok: true }));
  stubFiles({
    readFile: async (rel) => content({ path: rel, text: "base" }),
    writeFile,
  });
  await useFilesStore.getState().openFile("a.ts");

  await useFilesStore.getState().save("a.ts");

  expect(writeFile).not.toHaveBeenCalled();
});

it("closeFile removes the tab and re-focuses a neighbor, then chat", async () => {
  stubFiles({ readFile: async (rel) => content({ path: rel, text: "x" }) });
  await useFilesStore.getState().openFile("a.ts");
  await useFilesStore.getState().openFile("b.ts"); // active = b.ts

  useFilesStore.getState().closeFile("b.ts");
  expect(useFilesStore.getState().activeTab).toBe("a.ts");

  useFilesStore.getState().closeFile("a.ts");
  expect(useFilesStore.getState().activeTab).toBe(CHAT_TAB);
  expect(useFilesStore.getState().order).toEqual([]);
});

it("closing a non-active tab preserves the active tab", async () => {
  stubFiles({ readFile: async (rel) => content({ path: rel, text: "x" }) });
  await useFilesStore.getState().openFile("a.ts");
  await useFilesStore.getState().openFile("b.ts"); // active = b.ts

  useFilesStore.getState().closeFile("a.ts");

  expect(useFilesStore.getState().activeTab).toBe("b.ts");
  expect(useFilesStore.getState().order).toEqual(["b.ts"]);
});

it("closeFileWithConfirm prompts on a dirty tab and respects cancel", async () => {
  stubFiles({ readFile: async (rel) => content({ path: rel, text: "base" }) });
  await useFilesStore.getState().openFile("a.ts");
  useFilesStore.getState().setDirtyText("a.ts", "edited");

  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  closeFileWithConfirm("a.ts");
  expect(confirm).toHaveBeenCalled();
  expect(useFilesStore.getState().tabs["a.ts"]).toBeDefined();

  confirm.mockReturnValue(true);
  closeFileWithConfirm("a.ts");
  expect(useFilesStore.getState().tabs["a.ts"]).toBeUndefined();
});

it("closeFileWithConfirm closes a clean tab without prompting", async () => {
  stubFiles({ readFile: async (rel) => content({ path: rel, text: "base" }) });
  await useFilesStore.getState().openFile("a.ts");

  const confirm = vi.spyOn(window, "confirm");
  closeFileWithConfirm("a.ts");

  expect(confirm).not.toHaveBeenCalled();
  expect(useFilesStore.getState().tabs["a.ts"]).toBeUndefined();
});

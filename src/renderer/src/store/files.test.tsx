// AGE-634 — the Files store. The behaviors that matter: the tree expands lazily
// (one readDir per directory, cached across collapse/expand); opening a file
// reads it once, adds a focused tab, and carries the read-only flags; editing
// tracks dirty against the saved baseline; save writes the buffer and toasts the
// outcome; closing re-focuses a sensible neighbor; and the confirm wrapper guards
// unsaved edits. All bridge calls are stubbed on window.omp.files.

import type { FileContent, FileEntry } from "@shared/domain";
import type { OmpApi } from "@shared/ipc";
import { useAppStore } from "@/store/app";
import {
  CHAT_TAB,
  closeFileWithConfirm,
  type FileTab,
  ROOT_DIR,
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
    workspaceRoot: null,
    workspaceGeneration: 0,
    children: {},
    expanded: {},
    dirLoading: {},
    tabs: {},
    order: [],
    activeTab: CHAT_TAB,
  });
  useToastStore.setState({ toasts: [] });
  useAppStore.setState({ selectedProject: null });
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
  expect(readDir).toHaveBeenCalledWith("src", null);
  expect(useFilesStore.getState().children.src).toHaveLength(1);
  expect(useFilesStore.getState().expanded.src).toBe(true);

  // Collapse then re-expand — served from cache, no second fetch.
  useFilesStore.getState().toggleDir("src");
  expect(useFilesStore.getState().expanded.src).toBe(false);
  useFilesStore.getState().toggleDir("src");
  expect(readDir).toHaveBeenCalledTimes(1);
});

it("drops stale directory results across workspace ABA switches", async () => {
  let resolveOld!: (value: FileEntry[]) => void;
  const oldRead = new Promise<FileEntry[]>((resolve) => {
    resolveOld = resolve;
  });
  let sameRootReads = 0;
  const readDir = vi.fn((_rel: string | undefined, root?: string | null) =>
    root === "/same" && sameRootReads++ === 0
      ? oldRead
      : Promise.resolve([entry({ name: "fresh.ts", path: "fresh.ts" })]),
  );
  stubFiles({ readDir });

  useFilesStore.getState().setWorkspaceRoot("/same");
  const staleLoad = useFilesStore.getState().loadDir(ROOT_DIR);

  useFilesStore.getState().setWorkspaceRoot("/other");
  useFilesStore.getState().resetWorkspaceState();
  useFilesStore.getState().setWorkspaceRoot("/same");
  useFilesStore.getState().resetWorkspaceState();
  await useFilesStore.getState().loadDir(ROOT_DIR);
  expect(useFilesStore.getState().children[ROOT_DIR]?.[0]?.name).toBe(
    "fresh.ts",
  );

  resolveOld([entry({ name: "old.ts", path: "old.ts" })]);
  await staleLoad;

  expect(useFilesStore.getState().children[ROOT_DIR]?.[0]?.name).toBe(
    "fresh.ts",
  );
});

it("openFile reads the file, adds a focused tab, and clears dirty", async () => {
  const readFile = vi.fn(async (rel: string) =>
    content({ path: rel, text: "hello" }),
  );
  stubFiles({ readFile });

  await useFilesStore.getState().openFile("src/a.ts");

  const s = useFilesStore.getState();
  expect(readFile).toHaveBeenCalledWith("src/a.ts", null);
  expect(s.order).toEqual(["src/a.ts"]);
  expect(s.activeTab).toBe("src/a.ts");
  expect(s.tabs["src/a.ts"]).toMatchObject({
    text: "hello",
    savedText: "hello",
    dirty: false,
    loading: false,
    workspaceRoot: null,
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

  expect(writeFile).toHaveBeenCalledWith("a.ts", "edited", null);
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

it("passes the selected workspace root to every files bridge operation", async () => {
  const readDir = vi.fn(async () => [entry({ name: "a.ts", path: "a.ts" })]);
  const readFile = vi.fn(async (rel: string) =>
    content({ path: rel, text: "base" }),
  );
  const writeFile = vi.fn(async () => ({ ok: true }));
  stubFiles({ readDir, readFile, writeFile });

  useFilesStore.getState().setWorkspaceRoot("/work/app");
  await useFilesStore.getState().loadDir(ROOT_DIR);
  await useFilesStore.getState().openFile("a.ts");
  useFilesStore.getState().setDirtyText("a.ts", "edited");
  await useFilesStore.getState().save("a.ts");

  expect(readDir).toHaveBeenCalledWith(undefined, "/work/app");
  expect(readFile).toHaveBeenCalledWith("a.ts", "/work/app");
  expect(writeFile).toHaveBeenCalledWith("a.ts", "edited", "/work/app");
});

it("does not clear dirty from a stale save after workspace ABA switches", async () => {
  let resolveSave!: (value: { ok: boolean }) => void;
  const pendingSave = new Promise<{ ok: boolean }>((resolve) => {
    resolveSave = resolve;
  });
  let sameRootReads = 0;
  const readFile = vi.fn((rel: string, root?: string | null) =>
    root === "/same" && sameRootReads++ === 0
      ? Promise.resolve(content({ path: rel, text: "old-base" }))
      : Promise.resolve(content({ path: rel, text: "fresh-base" })),
  );
  const writeFile = vi.fn(() => pendingSave);
  stubFiles({ readFile, writeFile });

  useFilesStore.getState().setWorkspaceRoot("/same");
  await useFilesStore.getState().openFile("same.ts");
  useFilesStore.getState().setDirtyText("same.ts", "old-edit");
  const staleSave = useFilesStore.getState().save("same.ts");

  useFilesStore.getState().setWorkspaceRoot("/other");
  useFilesStore.getState().resetWorkspaceState();
  useFilesStore.getState().setWorkspaceRoot("/same");
  useFilesStore.getState().resetWorkspaceState();
  await useFilesStore.getState().openFile("same.ts");
  useFilesStore.getState().setDirtyText("same.ts", "fresh-edit");

  resolveSave({ ok: true });
  await staleSave;

  expect(tabOf("same.ts")).toMatchObject({
    text: "fresh-edit",
    savedText: "fresh-base",
    dirty: true,
    workspaceRoot: "/same",
  });
});

it("drops stale read results across workspace ABA switches", async () => {
  let resolveOld!: (value: FileContent) => void;
  const oldRead = new Promise<FileContent>((resolve) => {
    resolveOld = resolve;
  });
  let sameRootReads = 0;
  const readFile = vi.fn((rel: string, root?: string | null) =>
    root === "/same" && sameRootReads++ === 0
      ? oldRead
      : Promise.resolve(content({ path: rel, text: "fresh" })),
  );
  stubFiles({ readFile });

  useFilesStore.getState().setWorkspaceRoot("/same");
  const staleOpen = useFilesStore.getState().openFile("same.ts");

  useFilesStore.getState().setWorkspaceRoot("/other");
  useFilesStore.getState().resetWorkspaceState();
  useFilesStore.getState().setWorkspaceRoot("/same");
  useFilesStore.getState().resetWorkspaceState();
  await useFilesStore.getState().openFile("same.ts");
  expect(tabOf("same.ts")).toMatchObject({
    text: "fresh",
    workspaceRoot: "/same",
  });

  resolveOld(content({ path: "same.ts", text: "old" }));
  await staleOpen;

  expect(tabOf("same.ts")).toMatchObject({
    text: "fresh",
    workspaceRoot: "/same",
  });
});

it("keeps a root file named chat distinct from the chat tab", async () => {
  stubFiles({ readFile: async (rel) => content({ path: rel, text: "file" }) });

  await useFilesStore.getState().openFile("chat");
  expect(CHAT_TAB).not.toBe("chat");
  expect(useFilesStore.getState().activeTab).toBe("chat");

  useFilesStore.getState().setActiveTab(CHAT_TAB);
  expect(useFilesStore.getState().activeTab).toBe(CHAT_TAB);
  expect(useFilesStore.getState().tabs.chat).toBeDefined();
});

it("workspace changes clear scoped file state and prompt before discarding dirty tabs", () => {
  useAppStore.setState({ selectedProject: "/old" });
  useFilesStore.setState({
    workspaceRoot: "/old",
    workspaceGeneration: 1,
    children: { [ROOT_DIR]: [entry({ name: "a.ts", path: "a.ts" })] },
    expanded: { src: true },
    dirLoading: { src: false },
    tabs: {
      "src/a.ts": {
        path: "src/a.ts",
        workspaceRoot: "/old",
        workspaceGeneration: 1,
        text: "edited",
        savedText: "base",
        dirty: true,
        loading: false,
        tooLarge: false,
        binary: false,
        truncated: false,
        error: false,
      },
    },
    order: ["src/a.ts"],
    activeTab: "src/a.ts",
  });

  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  useAppStore.getState().setSelectedProject("/new");
  expect(confirm).toHaveBeenCalledWith(
    expect.stringContaining("Switching workspaces"),
  );
  expect(useAppStore.getState().selectedProject).toBe("/old");
  expect(useFilesStore.getState().tabs["src/a.ts"]).toBeDefined();
  expect(useFilesStore.getState().workspaceRoot).toBe("/old");
  expect(useFilesStore.getState().workspaceGeneration).toBe(1);

  confirm.mockReturnValue(true);
  useAppStore.getState().setSelectedProject("/new");

  expect(useAppStore.getState().selectedProject).toBe("/new");
  expect(useFilesStore.getState()).toMatchObject({
    children: {},
    expanded: {},
    dirLoading: {},
    tabs: {},
    order: [],
    activeTab: CHAT_TAB,
    workspaceRoot: "/new",
    workspaceGeneration: 2,
  });
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

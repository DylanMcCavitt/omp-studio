// AGE-634 — the workspace file tree. It lists the root on mount, lazily fetches a
// directory's children the first time it is expanded, opens a file in a center
// tab on click, and refetches via the refresh button. The FS bridge is stubbed
// on window.omp.files; assertions go through visible text, roles, and store state.

import type { FileEntry } from "@shared/domain";
import type { OmpApi } from "@shared/ipc";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileTree } from "@/components/files/FileTree";
import { CHAT_TAB, useFilesStore } from "@/store/files";

function stubFiles(over: Partial<OmpApi["files"]>) {
  Object.assign(window.omp, { files: over });
}

function dir(name: string, path: string): FileEntry {
  return { name, path, kind: "dir" };
}
function file(name: string, path: string): FileEntry {
  return { name, path, kind: "file" };
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
});

it("lists the root, expands a directory on click, and opens a file in a tab", async () => {
  const user = userEvent.setup();
  const readDir = vi.fn(async (rel?: string) => {
    if (!rel) return [dir("src", "src"), file("README.md", "README.md")];
    if (rel === "src") return [file("index.ts", "src/index.ts")];
    return [];
  });
  stubFiles({
    readDir,
    readFile: async (rel: string) => ({
      path: rel,
      text: "x",
      truncated: false,
      tooLarge: false,
      binary: false,
    }),
  });

  render(<FileTree />);

  // Root listing (readDir called with no relPath for the root).
  expect(await screen.findByText("src")).toBeInTheDocument();
  expect(screen.getByText("README.md")).toBeInTheDocument();

  // Expanding the directory lazily fetches and reveals its child.
  await user.click(screen.getByText("src"));
  expect(await screen.findByText("index.ts")).toBeInTheDocument();
  const rootRow = screen.getByRole("treeitem", { name: /src/i });
  const nestedRow = screen.getByRole("treeitem", { name: /index\.ts/i });
  expect(rootRow).toHaveStyle({ paddingLeft: "8px" });
  expect(nestedRow).toHaveStyle({ paddingLeft: "20px" });
  expect(readDir).toHaveBeenCalledWith("src", null);

  // Clicking a file opens and focuses a center tab for it.
  await user.click(screen.getByText("index.ts"));
  await vi.waitFor(() =>
    expect(useFilesStore.getState().activeTab).toBe("src/index.ts"),
  );
  expect(useFilesStore.getState().order).toContain("src/index.ts");
});

it("the refresh button refetches the tree", async () => {
  const user = userEvent.setup();
  const readDir = vi.fn(async () => [file("a.ts", "a.ts")]);
  stubFiles({ readDir });

  render(<FileTree />);
  await screen.findByText("a.ts");
  const before = readDir.mock.calls.length;

  await user.click(screen.getByRole("button", { name: "Refresh files" }));

  await vi.waitFor(() =>
    expect(readDir.mock.calls.length).toBeGreaterThan(before),
  );
});

// AGE-634 — the center tab strip. With no files open the chat owns the surface
// and no strip renders; opening files adds a Chat tab plus one tab per file;
// switching keeps the chat MOUNTED (a live stream is never torn down); closing a
// clean tab is immediate while a dirty tab confirms first. File tabs are seeded
// binary so their panes show the read-only notice instead of loading CodeMirror.

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CenterTabs } from "@/components/shell/CenterTabs";
import { CHAT_TAB, type FileTab, useFilesStore } from "@/store/files";

function tab(path: string, over: Partial<FileTab> = {}): FileTab {
  return {
    path,
    text: "",
    savedText: "",
    dirty: false,
    loading: false,
    tooLarge: false,
    // Binary so the active pane renders a notice, never the lazy editor.
    binary: true,
    truncated: false,
    error: false,
    ...over,
  };
}

function seedTabs(tabs: FileTab[], active: string) {
  const map: Record<string, FileTab> = {};
  for (const t of tabs) map[t.path] = t;
  useFilesStore.setState({
    tabs: map,
    order: tabs.map((t) => t.path),
    activeTab: active,
  });
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

it("renders only the chat (no tab strip) when no files are open", () => {
  render(<CenterTabs chat={<div>CHAT-PANE</div>} />);
  expect(screen.getByText("CHAT-PANE")).toBeVisible();
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
});

it("shows a Chat tab plus one tab per open file", () => {
  seedTabs([tab("src/a.ts"), tab("b.md")], "src/a.ts");
  render(<CenterTabs chat={<div>CHAT-PANE</div>} />);

  const strip = screen.getByRole("tablist");
  expect(within(strip).getByRole("tab", { name: "Chat" })).toBeInTheDocument();
  expect(within(strip).getByRole("tab", { name: /a\.ts/ })).toBeInTheDocument();
  expect(within(strip).getByRole("tab", { name: /b\.md/ })).toBeInTheDocument();
});

it("switching to a file tab keeps the chat mounted but hidden", async () => {
  const user = userEvent.setup();
  seedTabs([tab("a.ts")], CHAT_TAB);
  render(<CenterTabs chat={<div>CHAT-PANE</div>} />);

  expect(screen.getByText("CHAT-PANE")).toBeVisible();

  await user.click(screen.getByRole("tab", { name: /a\.ts/ }));

  expect(useFilesStore.getState().activeTab).toBe("a.ts");
  // The chat node is still in the DOM (state preserved), just no longer visible.
  expect(screen.getByText("CHAT-PANE")).toBeInTheDocument();
  expect(screen.getByText("CHAT-PANE")).not.toBeVisible();
  // The file pane is now the visible one (binary → read-only notice).
  expect(screen.getByText(/binary file/i)).toBeVisible();
});

it("closes a clean tab without confirming", async () => {
  const user = userEvent.setup();
  seedTabs([tab("a.ts")], "a.ts");
  render(<CenterTabs chat={<div>CHAT</div>} />);

  const confirm = vi.spyOn(window, "confirm");
  await user.click(screen.getByRole("button", { name: "Close a.ts" }));

  expect(confirm).not.toHaveBeenCalled();
  expect(useFilesStore.getState().order).toEqual([]);
});

it("confirms before closing a dirty tab and honors cancel", async () => {
  const user = userEvent.setup();
  seedTabs([tab("a.ts", { dirty: true })], "a.ts");
  render(<CenterTabs chat={<div>CHAT</div>} />);

  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await user.click(screen.getByRole("button", { name: "Close a.ts" }));

  expect(confirm).toHaveBeenCalled();
  expect(useFilesStore.getState().order).toEqual(["a.ts"]);
});

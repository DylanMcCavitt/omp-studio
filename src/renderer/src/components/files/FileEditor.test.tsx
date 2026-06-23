// AGE-634 — the open-file pane's non-editor states. A too-large or binary file
// renders a read-only notice with no Save button (and never loads the lazy
// CodeMirror chunk); a failed read shows an error notice; an in-flight read shows
// a spinner. Tabs are seeded directly into the store so no editor mounts here.

import { render, screen } from "@testing-library/react";
import { FileEditor } from "@/components/files/FileEditor";
import { CHAT_TAB, type FileTab, useFilesStore } from "@/store/files";

function seedTab(over: Partial<FileTab> & { path: string }) {
  const tab: FileTab = {
    text: "",
    savedText: "",
    dirty: false,
    loading: false,
    tooLarge: false,
    binary: false,
    truncated: false,
    error: false,
    ...over,
  };
  useFilesStore.setState({
    tabs: { [tab.path]: tab },
    order: [tab.path],
    activeTab: tab.path,
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

it("shows a read-only notice for a too-large file and no Save button", () => {
  seedTab({ path: "big.log", tooLarge: true });
  render(<FileEditor path="big.log" />);
  expect(screen.getByText(/too large/i)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Save" }),
  ).not.toBeInTheDocument();
});

it("shows a read-only notice for a binary file", () => {
  seedTab({ path: "img.png", binary: true });
  render(<FileEditor path="img.png" />);
  expect(screen.getByText(/binary file/i)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Save" }),
  ).not.toBeInTheDocument();
});

it("shows an error notice when the read failed", () => {
  seedTab({ path: "x.ts", error: true });
  render(<FileEditor path="x.ts" />);
  expect(screen.getByText(/open file/i)).toBeInTheDocument();
});

it("shows a spinner while the initial read is in flight", () => {
  seedTab({ path: "x.ts", loading: true });
  const { container } = render(<FileEditor path="x.ts" />);
  expect(container.querySelector(".animate-spin")).toBeTruthy();
});

// AGE-632/634 — the workspace-centric left sidebar. Drives the real chat + shell
// stores: the Chats surface shows the session list with a New chat action
// (selecting a row switches the active session), and the Chats | Files toggle
// flips the sidebar between the session list and the workspace file tree.
// Assertions go through roles, accessible names, and store state — never styling.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useChatStore } from "@/store/chat";
import { createSession } from "@/store/session-reducer";
import { useShellStore } from "@/store/shell";
import { Sidebar } from "./Sidebar";

const PRISTINE = useChatStore.getState();

beforeEach(() => {
  useChatStore.setState(
    { ...PRISTINE, openSessions: {}, activeSessionId: null },
    true,
  );
  useShellStore.setState({ sidebarMode: "chats" });
  // The Files tree lists the workspace root on mount; stub the FS bridge so the
  // sidebar renders without a real main process.
  Object.assign(window.omp, { files: { readDir: vi.fn(async () => []) } });
});

function seedSessions() {
  useChatStore.setState({
    openSessions: {
      a: createSession("a", { sessionName: "Alpha", status: "idle" }),
      b: createSession("b", { sessionName: "Beta", status: "idle" }),
    },
    activeSessionId: "a",
  });
}

it("shows the session list and a New chat action in Chats mode", () => {
  seedSessions();
  render(<Sidebar />);
  expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.getByText("Beta")).toBeInTheDocument();
});

it("invokes the store's newChat when New chat is clicked", async () => {
  const user = userEvent.setup();
  const newChat = vi.fn();
  useChatStore.setState({ newChat });
  render(<Sidebar />);

  await user.click(screen.getByRole("button", { name: "New chat" }));

  expect(newChat).toHaveBeenCalledTimes(1);
});

it("selects a session when its row is clicked", async () => {
  const user = userEvent.setup();
  seedSessions();
  render(<Sidebar />);

  await user.click(screen.getByText("Beta"));

  expect(useChatStore.getState().activeSessionId).toBe("b");
});

it("switches to the Files tree and hides the session list", async () => {
  const user = userEvent.setup();
  seedSessions();
  render(<Sidebar />);

  // Chats is active by default.
  expect(screen.getByRole("button", { name: "Chats" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByText("Alpha")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Files" }));

  expect(useShellStore.getState().sidebarMode).toBe("files");
  // The file tree (its refresh control + workspace label) replaces the list.
  expect(
    screen.getByRole("button", { name: "Refresh files" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByText(/no files in this workspace/i),
  ).toBeInTheDocument();
  // The session list is gone in Files mode; New chat stays available from the
  // persistent tool row (AGE-807).
  expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
});

it("restores the session list when toggled back to Chats", async () => {
  const user = userEvent.setup();
  seedSessions();
  render(<Sidebar />);

  await user.click(screen.getByRole("button", { name: "Files" }));
  expect(screen.queryByText("Alpha")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Chats" }));
  expect(useShellStore.getState().sidebarMode).toBe("chats");
  expect(screen.getByText("Alpha")).toBeInTheDocument();
});

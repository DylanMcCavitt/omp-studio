// AGE-700 — the ⌘K navigation palette. Drives the stores directly and asserts
// through roles/visible text: it opens from the ui flag, lists Workspaces +
// Recent sessions, narrows BOTH groups as you type, jumps on Enter/click (a
// workspace points new chats at its cwd like the switcher; a session opens in
// the center), and closes on Esc. Status Live Dots are derived, never stored.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "@/store/app";
import { useChatStore } from "@/store/chat";
import { createSession } from "@/store/session-reducer";
import { useSettingsStore } from "@/store/settings";
import { useUiStore } from "@/store/ui";
import { NavPalette } from "./NavPalette";

const setSelectedProject = vi.fn();
const recordWorkspace = vi.fn();
const openChat = vi.fn();
const resumeSession = vi.fn();
const closeNavPalette = vi.fn(() =>
  useUiStore.setState({ navPaletteOpen: false }),
);

function seed() {
  useUiStore.setState({ navPaletteOpen: true, closeNavPalette });
  useSettingsStore.setState({
    settings: {
      workspaces: [
        {
          id: "w1",
          cwd: "/p/alpha",
          label: "Alpha",
          pinned: true,
          lastUsedAt: "t2",
          color: "blue",
        },
        {
          id: "w2",
          cwd: "/p/beta",
          label: "Beta",
          pinned: false,
          lastUsedAt: "t1",
        },
      ],
    } as never,
    recordWorkspace,
  });
  useAppStore.setState({
    selectedProject: "/p/alpha",
    setSelectedProject,
  } as never);
  useChatStore.setState({
    openSessions: {
      s1: createSession("s1", {
        sessionName: "Refactor parser",
        cwd: "/p/beta",
        status: "streaming",
        lastActivityAt: 200,
      }),
    },
    hibernatedSessions: {},
    openChat,
    resumeSession,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

it("lists Workspaces and Recent sessions when open", () => {
  render(<NavPalette />);
  expect(screen.getByText("Workspaces")).toBeInTheDocument();
  expect(screen.getByText("Recent sessions")).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Alpha/ })).toBeInTheDocument();
  expect(
    screen.getByRole("option", { name: /Beta\s+\/p\/beta/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("option", { name: /Refactor parser/ }),
  ).toBeInTheDocument();
});

it("filters both groups by substring", async () => {
  const user = userEvent.setup();
  render(<NavPalette />);
  await user.type(
    screen.getByLabelText("Filter workspaces and sessions"),
    "alph",
  );
  expect(screen.getByRole("option", { name: /Alpha/ })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /Beta/ })).toBeNull();
  // The session lives in "Beta", so it drops out of the Recent group too.
  expect(screen.queryByRole("option", { name: /Refactor parser/ })).toBeNull();
});

it("jumps to a workspace on click (switcher effect) and closes", async () => {
  const user = userEvent.setup();
  render(<NavPalette />);
  await user.click(screen.getByRole("option", { name: /Beta\s+\/p\/beta/ }));
  expect(setSelectedProject).toHaveBeenCalledWith("/p/beta");
  expect(recordWorkspace).toHaveBeenCalledWith("/p/beta");
  expect(closeNavPalette).toHaveBeenCalled();
});

it("opens the selected session in the center on Enter", async () => {
  const user = userEvent.setup();
  render(<NavPalette />);
  const input = screen.getByLabelText("Filter workspaces and sessions");
  // Narrow to the single session row, then Enter activates it.
  await user.type(input, "refactor");
  await user.keyboard("{Enter}");
  expect(openChat).toHaveBeenCalledWith("s1");
  expect(closeNavPalette).toHaveBeenCalled();
});

it("resumes a hibernated session when selected", async () => {
  useChatStore.setState({
    openSessions: {},
    hibernatedSessions: {
      h1: {
        descriptor: {
          studioSessionId: "h1",
          cwd: "/p/alpha",
          createdAt: "t0",
          lastActiveAt: "t0",
          title: "Old run",
          approvalPolicy: { mode: "write", autoApprove: true },
          status: "hibernated",
        },
      },
    },
  } as never);
  const user = userEvent.setup();
  render(<NavPalette />);
  await user.click(screen.getByRole("option", { name: /Old run/ }));
  expect(resumeSession).toHaveBeenCalledWith("h1");
});

it("closes on Esc", async () => {
  const user = userEvent.setup();
  render(<NavPalette />);
  screen.getByLabelText("Filter workspaces and sessions").focus();
  await user.keyboard("{Escape}");
  expect(closeNavPalette).toHaveBeenCalled();
});

// AGE-621 — the Skills & Commands view. Covers the three sections sharing one
// search box, the Session-commands empty state when no session is loaded, that
// pinning a command persists through the settings store, and that "Use in chat"
// routes to Chat with the command prefilled into the composer.

import type { OmpApi, StudioSettings } from "@shared/ipc";
import type { AvailableSlashCommand } from "@shared/rpc";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "@/store/app";
import { useChatStore } from "@/store/chat";
import { createSession } from "@/store/session-reducer";
import { useSettingsStore } from "@/store/settings";
import Skills from "./Skills";

const BASE_SETTINGS: StudioSettings = {
  version: 2,
  theme: "system",
  defaultProject: null,
  defaultModel: null,
  defaultThinkingLevel: "medium",
  defaultApprovalMode: "always-ask",
  defaultAutoApprove: false,
  liveSessionLimit: 4,
  recentProjects: [],
  openSessions: [],
};

function stubBridge(
  skills: unknown[],
  commands: AvailableSlashCommand[],
): void {
  Object.assign(window.omp, {
    listSkills: vi.fn().mockResolvedValue(skills),
    chat: {
      ...window.omp.chat,
      getAvailableCommands: vi.fn().mockResolvedValue(commands),
    },
  } as unknown as Partial<OmpApi>);
}

/** Seed an active session whose live slice advertises `commands`. */
function seedActiveSession(commands: { name: string; description?: string }[]) {
  useChatStore.setState({
    activeSessionId: "s1",
    openSessions: {
      s1: createSession("s1", { availableCommands: commands }),
    },
  });
}

beforeEach(() => {
  useChatStore.setState({ activeSessionId: null, openSessions: {} });
  useAppStore.setState({ route: "skills", pendingComposerText: null });
  useSettingsStore.setState({
    settings: BASE_SETTINGS,
    loading: false,
    error: undefined,
    update: vi.fn().mockResolvedValue(undefined),
  });
});

it("renders all three sections, including the read-only TUI reference", async () => {
  stubBridge(
    [
      {
        name: "tdd",
        description: "Test-first",
        source: "user",
        path: "/s/tdd",
      },
    ],
    [],
  );
  seedActiveSession([{ name: "compact", description: "Compact the context" }]);
  const user = userEvent.setup();
  render(<Skills />);

  expect(screen.getByRole("button", { name: /^Skills/ })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Session commands/ }),
  ).toBeInTheDocument();
  const tuiHeader = screen.getByRole("button", { name: /TUI-only commands/ });
  expect(tuiHeader).toBeInTheDocument();

  // The live session command shows immediately (before the snapshot resolves).
  expect(await screen.findByText("/compact")).toBeInTheDocument();

  // The TUI section is collapsed by default; expanding reveals the curated,
  // clearly non-actionable entries.
  await user.click(tuiHeader);
  expect(screen.getByText("/tan")).toBeInTheDocument();
  expect(
    screen.getAllByText("TUI only — not available in Studio").length,
  ).toBeGreaterThan(0);
});

it("shows an explicit empty state in Session commands when no session is loaded", async () => {
  stubBridge([], []);
  // No active session seeded (beforeEach cleared it).
  render(<Skills />);

  expect(await screen.findByText("No session loaded")).toBeInTheDocument();
  expect(
    screen.getByText("Start or open a session to load its commands."),
  ).toBeInTheDocument();
  // With no session, the snapshot fetch is never fired.
  expect(window.omp.chat.getAvailableCommands).not.toHaveBeenCalled();
});

it("pins a command through the settings store (persists)", async () => {
  stubBridge([], []);
  seedActiveSession([{ name: "compact", description: "Compact the context" }]);
  const update = vi.fn().mockResolvedValue(undefined);
  useSettingsStore.setState({ settings: BASE_SETTINGS, update });
  const user = userEvent.setup();
  render(<Skills />);

  await user.click(await screen.findByRole("button", { name: "Pin command" }));

  expect(update).toHaveBeenCalledTimes(1);
  const patch = update.mock.calls.at(-1)?.[0] as Partial<StudioSettings>;
  expect(patch.ui?.pinnedCommands).toEqual(["compact"]);
});

it("routes to Chat and prefills the composer on Use in chat", async () => {
  stubBridge([], []);
  seedActiveSession([{ name: "compact", description: "Compact the context" }]);
  const user = userEvent.setup();
  render(<Skills />);

  await user.click(await screen.findByRole("button", { name: "Use in chat" }));

  expect(useAppStore.getState().route).toBe("chat");
  expect(useAppStore.getState().pendingComposerText).toBe("/compact ");
});

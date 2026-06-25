// AGE-705 — the active-chat composer's workspace-aware placeholder. The composer
// names the active workspace ("Message {workspace}…") off the same chrome source
// as the window title (app.selectedProject), preferring the saved workspace
// label and falling back to the path basename; with no active session it reads
// "No active session". The placeholder must agree with the active workspace shown
// elsewhere in the chrome even when the active session's cwd diverges from it.
// The model chip and slash palette are stubbed so this exercises only the
// placeholder wiring.

import { render, screen } from "@testing-library/react";
import { useAppStore } from "@/store/app";
import { useChatStore } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";
import { Composer } from "./Composer";

vi.mock("@/components/chat/ModelControl", () => ({
  ModelControl: () => <div data-testid="model-chip" />,
}));
vi.mock("@/components/chat/SlashCommandPalette", () => ({
  SlashCommandPalette: () => null,
}));

const SESSION_ID = "session-1";

beforeEach(() => {
  useChatStore.setState({ activeSessionId: null, openSessions: {} as never });
  useSettingsStore.setState({ settings: { workspaces: [] } as never });
  useAppStore.setState({ selectedProject: null } as never);
});

/**
 * Make a live, idle session active and point the chrome at `project` (the active
 * workspace). `project` defaults to the session cwd; pass a different value to
 * model the AGE-705 divergence (chrome workspace ≠ session cwd).
 */
function activate(cwd: string, project: string = cwd) {
  useChatStore.setState({
    activeSessionId: SESSION_ID,
    openSessions: {
      [SESSION_ID]: {
        sessionId: SESSION_ID,
        status: "idle",
        cwd,
        model: null,
        availableCommands: [],
      },
    } as never,
  });
  useAppStore.setState({ selectedProject: project } as never);
}

const placeholder = () =>
  screen.getByLabelText("Message").getAttribute("placeholder");

it("names the active workspace in the placeholder, preferring its saved label", () => {
  useSettingsStore.setState({
    settings: {
      workspaces: [
        {
          id: "w1",
          cwd: "/home/me/acme",
          label: "Acme",
          pinned: false,
          lastUsedAt: "2026-01-01T00:00:00Z",
        },
      ],
    } as never,
  });
  activate("/home/me/acme");

  render(<Composer />);

  expect(placeholder()).toBe("Message Acme…");
});

it("falls back to the selected project's basename when no workspace is saved", () => {
  activate("/home/me/widget-shop");

  render(<Composer />);

  expect(placeholder()).toBe("Message widget-shop…");
});

it("names the active workspace, not the session cwd, when they diverge", () => {
  // AGE-705 regression: the chrome's active workspace was port-omp while the
  // session ran in the home dir, so the placeholder must follow the chrome
  // (selectedProject), not the session cwd.
  activate("/Users/dylanmccavitt", "/Users/dylanmccavitt/projects/port-omp");

  render(<Composer />);

  expect(placeholder()).toBe("Message port-omp…");
});

it("reads 'No active session' when there is no active session", () => {
  render(<Composer />);

  expect(placeholder()).toBe("No active session");
});

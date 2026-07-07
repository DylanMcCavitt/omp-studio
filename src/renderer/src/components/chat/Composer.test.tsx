// AGE-705 — the active-chat composer's workspace-aware placeholder. The composer
// names the active workspace ("Message {workspace}…") off the same chrome source
// as the window title (app.selectedProject), preferring the saved workspace
// label and falling back to the path basename; with no active session it reads
// "No active session". The placeholder must agree with the active workspace shown
// elsewhere in the chrome even when the active session's cwd diverges from it.
// The model chip and slash palette are stubbed so this exercises only the
// placeholder wiring.

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AGENT_DRAG_MIME,
  agentSteeringText,
  serializeAgentDrag,
} from "@/lib/agentDrag";
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
const AGENT = {
  name: "planner",
  description: "Plans the slice",
  source: "project" as const,
  spawns: "reviewer,tester",
};
const AGENT_TEXT = agentSteeringText(AGENT);

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

  render(<Composer sessionId={SESSION_ID} />);

  expect(placeholder()).toBe("Message Acme…");
});

it("falls back to the selected project's basename when no workspace is saved", () => {
  activate("/home/me/widget-shop");

  render(<Composer sessionId={SESSION_ID} />);

  expect(placeholder()).toBe("Message widget-shop…");
});

it("names the active workspace, not the session cwd, when they diverge", () => {
  // AGE-705 regression: the chrome's active workspace was port-omp while the
  // session ran in the home dir, so the placeholder must follow the chrome
  // (selectedProject), not the session cwd.
  activate("/Users/dylanmccavitt", "/Users/dylanmccavitt/projects/port-omp");

  render(<Composer sessionId={SESSION_ID} />);

  expect(placeholder()).toBe("Message port-omp…");
});

it("reads 'No active session' when the pane's session is not registered", () => {
  // AGE-801: the composer is pane-scoped. A pane whose session id is not in
  // openSessions (still opening, or gone) renders disabled.
  render(<Composer sessionId="ghost-session" />);

  expect(placeholder()).toBe("No active session");
});

it("uses a primary IconButton for Send and a warn Button for Stop", () => {
  activate("/home/me/widget-shop");
  const { rerender } = render(<Composer sessionId={SESSION_ID} />);

  const send = screen.getByRole("button", { name: "Send" });
  expect(send.className).toContain("bg-accent");
  expect(send.className).toContain("text-bg");

  act(() => {
    useChatStore.setState((state) => ({
      openSessions: {
        ...state.openSessions,
        [SESSION_ID]: {
          ...state.openSessions[SESSION_ID],
          status: "streaming",
        },
      } as never,
    }));
  });

  rerender(<Composer sessionId={SESSION_ID} />);
  const stop = screen.getByRole("button", { name: "Stop" });
  expect(stop.className).toContain("bg-warn/10");
  expect(stop.className).toContain("text-ink");
});

it("routes an agent drop through the chooser and Steer injects editable text without submitting", async () => {
  const user = userEvent.setup();
  const prompt = vi.fn().mockResolvedValue(undefined);
  Object.assign(window.omp, {
    chat: { ...window.omp.chat, prompt },
  });
  activate("/repo");
  render(<Composer sessionId={SESSION_ID} />);

  const textarea = screen.getByLabelText("Message");
  fireEvent.drop(textarea, {
    dataTransfer: {
      types: [AGENT_DRAG_MIME],
      getData: (type: string) =>
        type === AGENT_DRAG_MIME ? serializeAgentDrag(AGENT) : "",
      files: [],
    },
  });

  expect(
    screen.getByRole("dialog", { name: "Route agent planner" }),
  ).toBeInTheDocument();
  expect(screen.getByText(AGENT_TEXT)).toBeInTheDocument();

  await user.click(
    screen.getByRole("button", { name: /steer current response/i }),
  );

  await waitFor(() => expect(textarea).toHaveValue(AGENT_TEXT));
  await user.type(textarea, "x");

  expect(textarea).toHaveValue(`${AGENT_TEXT}x`);
  expect(prompt).not.toHaveBeenCalled();
});

it("returns focus to the composer textarea when the agent chooser is dismissed", async () => {
  const user = userEvent.setup();
  activate("/repo");
  render(<Composer sessionId={SESSION_ID} />);

  const textarea = screen.getByLabelText("Message");
  textarea.focus();
  fireEvent.drop(textarea, {
    dataTransfer: {
      types: [AGENT_DRAG_MIME],
      getData: (type: string) =>
        type === AGENT_DRAG_MIME ? serializeAgentDrag(AGENT) : "",
      files: [],
    },
  });

  await user.click(screen.getByRole("button", { name: "Cancel" }));

  await waitFor(() => expect(textarea).toHaveFocus());
});

// ---------------------------------------------------------------------------
// AGE-801: two pane-scoped composers target DIFFERENT sessions — a submit in
// one pane routes to its own session id and never leaks into the other.
// ---------------------------------------------------------------------------

it("two composers with different session ids send to their own sessions", async () => {
  const user = userEvent.setup();
  const prompt = vi.fn().mockResolvedValue(undefined);
  Object.assign(window.omp, {
    chat: { ...window.omp.chat, prompt },
  });
  useChatStore.setState({
    activeSessionId: "session-a",
    openSessions: {
      "session-a": {
        sessionId: "session-a",
        status: "idle",
        cwd: "/p/a",
        model: null,
        availableCommands: [],
        messages: [],
      },
      "session-b": {
        sessionId: "session-b",
        status: "idle",
        cwd: "/p/b",
        model: null,
        availableCommands: [],
        messages: [],
      },
    } as never,
  });

  render(
    <div>
      <div data-testid="pane-a">
        <Composer sessionId="session-a" />
      </div>
      <div data-testid="pane-b">
        <Composer sessionId="session-b" />
      </div>
    </div>,
  );

  const paneB = within(screen.getByTestId("pane-b"));
  await user.type(paneB.getByLabelText("Message"), "to bee");
  await user.click(paneB.getByRole("button", { name: "Send" }));
  expect(prompt).toHaveBeenCalledWith("session-b", "to bee", undefined);

  const paneA = within(screen.getByTestId("pane-a"));
  await user.type(paneA.getByLabelText("Message"), "to ay");
  await user.click(paneA.getByRole("button", { name: "Send" }));
  expect(prompt).toHaveBeenLastCalledWith("session-a", "to ay", undefined);

  // Each composer's draft stayed local: pane A's textarea never saw pane B's
  // text (independent component state, not a shared global draft).
  expect(prompt).toHaveBeenCalledTimes(2);
});

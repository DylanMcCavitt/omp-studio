// D2r — the multi-session rail. Drives the real (normalized) chat store: it
// renders one row per open session, switching the active session on click and
// closing one through the store's closeSession action, and each row's badge
// reflects the session's derived headline status. Assertions go through roles,
// accessible names, and aria-current — never styling.

import type { ChatUiRequestEvent } from "@shared/ipc";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type LiveSessionState, useChatStore } from "@/store/chat";
import { createSession } from "@/store/session-reducer";
import { SessionRail } from "./SessionRail";

// Full store snapshot (state + actions) captured before any test mutates it, so
// each test starts from a clean slice map with the real actions restored.
const PRISTINE = useChatStore.getState();

beforeEach(() => {
  useChatStore.setState(
    { ...PRISTINE, openSessions: {}, activeSessionId: null },
    true,
  );
});

function seed(
  sessions: Record<string, LiveSessionState>,
  activeSessionId: string | null,
) {
  useChatStore.setState({ openSessions: sessions, activeSessionId });
}

function approvalRequest(sessionId: string): ChatUiRequestEvent {
  return {
    sessionId,
    responseRequired: true,
    request: { type: "extension_ui_request", id: "r1", method: "confirm" },
  };
}

it("renders one row per open session with its title", () => {
  seed(
    {
      a: createSession("a", { sessionName: "Alpha", status: "idle" }),
      b: createSession("b", { cwd: "/work/beta", status: "idle" }),
    },
    "a",
  );
  render(<SessionRail />);
  // Title precedence: sessionName, else basename(cwd).
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.getByText("beta")).toBeInTheDocument();
});

it("switches the active session when a row is clicked", async () => {
  const user = userEvent.setup();
  seed(
    {
      a: createSession("a", { sessionName: "Alpha", status: "idle" }),
      b: createSession("b", { sessionName: "Beta", status: "idle" }),
    },
    "a",
  );
  render(<SessionRail />);

  const alphaRow = screen.getByText("Alpha").closest("button");
  const betaRow = screen.getByText("Beta").closest("button");
  expect(alphaRow).toHaveAttribute("aria-current", "true");
  expect(betaRow).not.toHaveAttribute("aria-current");

  await user.click(betaRow as HTMLElement);

  expect(useChatStore.getState().activeSessionId).toBe("b");
  expect(betaRow).toHaveAttribute("aria-current", "true");
  expect(alphaRow).not.toHaveAttribute("aria-current");
});

it("closes a session through the store's closeSession action", async () => {
  const user = userEvent.setup();
  const closeSession = vi.fn().mockResolvedValue(undefined);
  seed(
    { a: createSession("a", { sessionName: "Alpha", status: "idle" }) },
    "a",
  );
  // Override the action; closeSessionWithConfirm reads it from getState().
  useChatStore.setState({ closeSession });
  render(<SessionRail />);

  await user.click(screen.getByRole("button", { name: "Close session" }));

  expect(closeSession).toHaveBeenCalledTimes(1);
  expect(closeSession).toHaveBeenCalledWith("a");
});

it("reflects each session's derived status in its badge", () => {
  seed(
    {
      r: createSession("r", { sessionName: "ReadyOne", status: "idle" }),
      s: createSession("s", { sessionName: "StreamOne", status: "streaming" }),
      e: createSession("e", { sessionName: "ErrOne", status: "error" }),
      n: createSession("n", {
        sessionName: "ApprovalOne",
        status: "idle",
        uiRequests: [approvalRequest("n")],
      }),
    },
    "r",
  );
  render(<SessionRail />);

  expect(screen.getByText("Ready")).toBeInTheDocument();
  expect(screen.getByText("Streaming")).toBeInTheDocument();
  expect(screen.getByText("Error")).toBeInTheDocument();
  expect(screen.getByText("Needs approval")).toBeInTheDocument();
});

it("shows an empty state when no sessions are open", () => {
  render(<SessionRail />);
  expect(screen.getByText(/no open sessions/i)).toBeInTheDocument();
});

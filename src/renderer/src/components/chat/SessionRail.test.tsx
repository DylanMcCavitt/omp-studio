// D2r — the multi-session rail. Drives the real (normalized) chat store: it
// renders one row per open session, switching the active session on click and
// closing one through the store's closeSession action, and each row's badge
// reflects the session's derived headline status. Assertions go through roles,
// accessible names, and aria-current — never styling.
//
// G2 adds the keyboard-accessibility coverage at the bottom: roving tabindex
// (one Tab stop, defaulted to the active session) and Arrow-key navigation.

import type { ChatUiRequestEvent } from "@shared/ipc";
import { fireEvent, render, screen } from "@testing-library/react";
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

function railItem(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-rail-item="${id}"]`);
  if (!el) throw new Error(`no rail item ${id}`);
  return el;
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

describe("keyboard nav (G2)", () => {
  it("gives the active session the single tab stop (roving tabindex)", () => {
    seed(
      {
        a: createSession("a", { sessionName: "Alpha", status: "idle" }),
        b: createSession("b", { sessionName: "Beta", status: "streaming" }),
      },
      "a",
    );
    render(<SessionRail />);
    expect(railItem("a").tabIndex).toBe(0);
    expect(railItem("b").tabIndex).toBe(-1);
    expect(railItem("__new-chat__").tabIndex).toBe(-1);
  });

  it("moves focus to the next row on ArrowDown and updates the tab stop", () => {
    seed(
      {
        a: createSession("a", { sessionName: "Alpha", status: "idle" }),
        b: createSession("b", { sessionName: "Beta", status: "idle" }),
      },
      "a",
    );
    render(<SessionRail />);
    railItem("a").focus();
    fireEvent.keyDown(railItem("a"), { key: "ArrowDown" });
    expect(railItem("b")).toHaveFocus();
    expect(railItem("b").tabIndex).toBe(0);
    expect(railItem("a").tabIndex).toBe(-1);
  });

  it("moves focus to the previous row on ArrowUp", () => {
    seed(
      {
        a: createSession("a", { sessionName: "Alpha", status: "idle" }),
        b: createSession("b", { sessionName: "Beta", status: "idle" }),
      },
      "a",
    );
    render(<SessionRail />);
    railItem("b").focus();
    fireEvent.keyDown(railItem("b"), { key: "ArrowUp" });
    expect(railItem("a")).toHaveFocus();
  });

  it("keeps row accessory buttons out of the Tab order (single tab stop)", () => {
    seed(
      {
        a: createSession("a", {
          sessionName: "Alpha",
          status: "idle",
          sessionFile: "/work/a.jsonl",
        }),
      },
      "a",
    );
    render(<SessionRail />);
    // Accessory controls stay mouse-clickable but are not Tab stops.
    expect(screen.getByRole("button", { name: "Close session" }).tabIndex).toBe(
      -1,
    );
    expect(
      screen.getByRole("button", { name: "Session actions" }).tabIndex,
    ).toBe(-1);
  });
});

// D2r — the multi-session list (now the left sidebar's Chats surface). Drives
// the real (normalized) chat store: it renders one row per open session,
// switching the active session on click and closing one through the store's
// closeSession action, and each row's badge reflects the session's derived
// headline status. Assertions go through roles, accessible names, and
// aria-current — never styling.
//
// G2 covers keyboard accessibility: roving tabindex (one Tab stop, defaulted to
// the active session) and Arrow-key navigation. The "New chat" action lives in
// the sidebar above this list, so it is no longer part of the roving order.

import type { ChatUiRequestEvent, WorkspaceColorKey } from "@shared/ipc";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type LiveSessionState, useChatStore } from "@/store/chat";
import { createSession } from "@/store/session-reducer";
import { useSettingsStore } from "@/store/settings";
import { SessionList } from "./SessionList";

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
  render(<SessionList />);
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
  render(<SessionList />);

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
  render(<SessionList />);

  await user.click(screen.getByRole("button", { name: "Close session" }));

  expect(closeSession).toHaveBeenCalledTimes(1);
  expect(closeSession).toHaveBeenCalledWith("a");
});

it("renders a running session with a pulsing dot and 'live' meta", () => {
  seedWorkspaceColor("/p/live", "blue");
  seed(
    {
      s: createSession("s", {
        sessionName: "StreamOne",
        status: "streaming",
        cwd: "/p/live",
      }),
    },
    "s",
  );
  render(<SessionList />);

  const row = railItem("s");
  // Status mode dot tagged running, with a solid workspace fill.
  const dot = row.querySelector<HTMLElement>('[data-status="running"]');
  expect(dot).not.toBeNull();
  expect(dot?.className).toContain("animate-omp-pulse");
  expect(dot?.style.backgroundColor).not.toBe("");
  // Meta reads "live" instead of a streaming text badge.
  expect(row).toHaveTextContent("live");
  expect(screen.queryByText("Streaming")).toBeNull();
});

it("shows an idle dot + relative time and keeps user-blocking badges", () => {
  seedWorkspaceColor("/p/idle", "green");
  seed(
    {
      r: createSession("r", {
        sessionName: "ReadyOne",
        status: "idle",
        cwd: "/p/idle",
        lastActivityAt: Date.now() - 60_000,
      }),
      e: createSession("e", { sessionName: "ErrOne", status: "error" }),
      n: createSession("n", {
        sessionName: "ApprovalOne",
        status: "idle",
        uiRequests: [approvalRequest("n")],
      }),
    },
    "r",
  );
  render(<SessionList />);

  // Idle row leads with a hollow idle dot and a muted relative time, not a badge.
  expect(railItem("r").querySelector('[data-status="idle"]')).not.toBeNull();
  expect(railItem("r")).toHaveTextContent(/ago/);
  expect(screen.queryByText("Ready")).toBeNull();
  // States the 3-fill dot cannot express still surface as actionable badges.
  expect(screen.getByText("Error")).toBeInTheDocument();
  expect(screen.getByText("Needs approval")).toBeInTheDocument();
});

it("ramps title weight and ink by active state", () => {
  seed(
    {
      a: createSession("a", { sessionName: "Alpha", status: "idle" }),
      b: createSession("b", { sessionName: "Beta", status: "idle" }),
    },
    "a",
  );
  render(<SessionList />);

  // Active title stays strong (--t1/600); inactive drops to the muted ramp
  // (--t2/500). getByText returns the inner truncate span; its parent is ramped.
  const activeTitle = screen.getByText("Alpha").parentElement;
  const inactiveTitle = screen.getByText("Beta").parentElement;
  expect(activeTitle?.className).toContain("text-ink font-semibold");
  expect(inactiveTitle?.className).toContain("text-ink-muted font-medium");
});

it("keeps exited and spawning rows visible as their own status badges", () => {
  seed(
    {
      x: createSession("x", { sessionName: "ExitOne", status: "exited" }),
      s: createSession("s", { sessionName: "SpawnOne", status: "spawning" }),
    },
    "x",
  );
  render(<SessionList />);

  // Neither collapses into a plain idle row: each keeps a decoding badge.
  expect(screen.getByText("Exited")).toBeInTheDocument();
  expect(screen.getByText("Starting")).toBeInTheDocument();
});

it("shows an empty state when no sessions are open", () => {
  render(<SessionList />);
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
    render(<SessionList />);
    expect(railItem("a").tabIndex).toBe(0);
    expect(railItem("b").tabIndex).toBe(-1);
  });

  it("moves focus to the next row on ArrowDown and updates the tab stop", () => {
    seed(
      {
        a: createSession("a", { sessionName: "Alpha", status: "idle" }),
        b: createSession("b", { sessionName: "Beta", status: "idle" }),
      },
      "a",
    );
    render(<SessionList />);
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
    render(<SessionList />);
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
    render(<SessionList />);
    // Accessory controls stay mouse-clickable but are not Tab stops.
    expect(screen.getByRole("button", { name: "Close session" }).tabIndex).toBe(
      -1,
    );
    expect(
      screen.getByRole("button", { name: "Session actions" }).tabIndex,
    ).toBe(-1);
  });
});

function seedWorkspaceColor(cwd: string, color: WorkspaceColorKey | undefined) {
  useSettingsStore.setState({
    settings: {
      workspaces: [
        { id: "w1", cwd, label: "WS", pinned: false, lastUsedAt: "t", color },
      ],
    } as never,
  });
}

function seedHibernated(id: string, cwd: string, title: string) {
  useChatStore.setState({
    hibernatedSessions: {
      [id]: {
        descriptor: {
          studioSessionId: id,
          cwd,
          createdAt: "t",
          lastActiveAt: new Date(Date.now() - 3_600_000).toISOString(),
          title,
          status: "hibernated",
          approvalPolicy: "untrusted",
        },
      },
    },
  } as never);
}

it("leads each row with a status Live Dot on a shared left axis", () => {
  seedWorkspaceColor("/p/alpha", "blue");
  seed(
    {
      a: createSession("a", { sessionName: "Alpha", cwd: "/p/alpha" }),
      b: createSession("b", { sessionName: "Beta", cwd: "/p/alpha" }),
    },
    "a",
  );
  render(<SessionList />);

  // The dot is the first child of the row button, so every dot shares one axis.
  for (const id of ["a", "b"]) {
    const lead = railItem(id).firstElementChild as HTMLElement | null;
    expect(lead?.className).toContain("rounded-full");
    expect(lead?.getAttribute("data-status")).toBe("idle");
  }
});

it("falls back to a plain identity dot when the workspace has no color", () => {
  seedWorkspaceColor("/p/alpha", undefined);
  seed(
    {
      a: createSession("a", { sessionName: "Alpha", cwd: "/p/alpha" }),
      b: createSession("b", { sessionName: "Beta", cwd: "/p/unsaved" }),
    },
    "a",
  );
  render(<SessionList />);

  // No color -> identity dot: present but neither status-tagged nor filled.
  for (const id of ["a", "b"]) {
    const lead = railItem(id).firstElementChild as HTMLElement | null;
    expect(lead?.className).toContain("rounded-full");
    expect(lead?.getAttribute("data-status")).toBeNull();
    expect(lead?.style.backgroundColor).toBe("");
  }
});

it("renders a hibernated session with a faded done dot", () => {
  seedWorkspaceColor("/p/done", "violet");
  seedHibernated("h1", "/p/done", "DoneOne");
  render(<SessionList />);

  const row = railItem("h1");
  const dot = row.querySelector<HTMLElement>('[data-status="done"]');
  expect(dot).not.toBeNull();
  // done = solid swatch faded to .3.
  expect(dot?.style.backgroundColor).not.toBe("");
  expect(dot?.style.opacity).toBe("0.3");
});

it("renders a status legend footer with live, idle, and done fills", () => {
  seed({ a: createSession("a", { sessionName: "Alpha" }) }, "a");
  render(<SessionList />);

  const legend = screen.getByLabelText("Session status legend");
  expect(legend).toHaveTextContent("live");
  expect(legend).toHaveTextContent("idle");
  expect(legend).toHaveTextContent("done");
  expect(legend.querySelector('[data-status="running"]')).not.toBeNull();
  expect(legend.querySelector('[data-status="idle"]')).not.toBeNull();
  expect(legend.querySelector('[data-status="done"]')).not.toBeNull();
});

it("renders the legend live fill as a static (non-pulsing) dot", () => {
  seed({ a: createSession("a", { sessionName: "Alpha" }) }, "a");
  render(<SessionList />);

  const legend = screen.getByLabelText("Session status legend");
  const live = legend.querySelector<HTMLElement>('[data-status="running"]');
  // Legend decodes the fill, so its "live" dot stays still rather than pulsing.
  expect(live).not.toBeNull();
  expect(live?.className).not.toContain("animate-omp-pulse");
});

it("hides the legend when no sessions are open", () => {
  render(<SessionList />);
  expect(screen.queryByLabelText("Session status legend")).toBeNull();
});

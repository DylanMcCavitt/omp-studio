// AGE-674 — the sidebar panel dock hosts the relocated Usage / Plan / Subagents
// widgets. AGE-807 collapses it to a one-line counter strip by default; the
// strip expands to the full widgets on click. It renders nothing without an
// active session, wires the Subagents widget's drill-in into the shared chat
// store (`inspectedSubagentId`), and focuses the Chat tab so the inspector is
// visible even from a file tab. The data-bound panels are stubbed to markers so
// the test asserts placement + wiring, not each panel's internals.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useChatStore } from "@/store/chat";
import { CHAT_TAB, useFilesStore } from "@/store/files";
import { usePaneStore } from "@/store/panes";
import { useSettingsStore } from "@/store/settings";
import { ChatPanelDock } from "./ChatPanelDock";

vi.mock("@/components/chat/SessionStatsPanel", () => ({
  SessionStatsPanel: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="usage-widget">{sessionId}</div>
  ),
}));
vi.mock("@/components/chat/TodoPanel", () => ({
  TodoPanel: () => <div data-testid="plan-widget" />,
}));
vi.mock("@/components/chat/SubagentTree", () => ({
  SubagentTree: ({
    onInspect,
    onOpenInPane,
  }: {
    onInspect: (id: string) => void;
    onOpenInPane?: (id: string) => void;
  }) => (
    <>
      <button type="button" onClick={() => onInspect("sub-9")}>
        inspect subagent
      </button>
      <button type="button" onClick={() => onOpenInPane?.("sub-9")}>
        open subagent in pane
      </button>
    </>
  ),
}));

beforeEach(() => {
  useChatStore.setState({ activeSessionId: null, inspectedSubagent: null });
  useFilesStore.setState({ activeTab: CHAT_TAB });
  usePaneStore.getState().reset();
  // The strip's expand state persists through settings; stub the writer so the
  // debounced persist never reaches a real bridge.
  useSettingsStore.setState({ settings: undefined, update: vi.fn() } as never);
});

const inspectButton = () =>
  screen.getByRole("button", { name: "inspect subagent" });

/** The dock starts as the collapsed counter strip; expand it to the widgets. */
async function expandDock() {
  await userEvent.click(screen.getByRole("button", { name: "Session panels" }));
}

describe("ChatPanelDock", () => {
  it("renders nothing without an active session", () => {
    const { container } = render(<ChatPanelDock />);
    expect(container).toBeEmptyDOMElement();
  });

  it("collapses to a counter strip by default and expands to the widgets", async () => {
    useChatStore.setState({ activeSessionId: "session-7" });

    render(<ChatPanelDock />);

    // Collapsed: strip only, no widgets mounted.
    const strip = screen.getByRole("button", { name: "Session panels" });
    expect(strip).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("usage-widget")).not.toBeInTheDocument();

    await expandDock();

    expect(strip).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("usage-widget")).toHaveTextContent("session-7");
    expect(screen.getByTestId("plan-widget")).toBeInTheDocument();
    expect(inspectButton()).toBeInTheDocument();
  });

  it("drills into a subagent and focuses the chat tab", async () => {
    useChatStore.setState({ activeSessionId: "session-7" });
    // A file tab owns the center — the inspector must steal focus back to chat.
    useFilesStore.setState({ activeTab: "src/app.ts" });

    render(<ChatPanelDock />);
    await expandDock();
    await userEvent.click(inspectButton());

    expect(useChatStore.getState().inspectedSubagent).toEqual({
      sessionId: "session-7",
      subagentId: "sub-9",
    });
    expect(useFilesStore.getState().activeTab).toBe(CHAT_TAB);
  });
});

it("opens a subagent's inspector in a split pane beside the chat (AGE-777)", async () => {
  useChatStore.setState({ activeSessionId: "session-7" });

  render(<ChatPanelDock />);
  await expandDock();
  await userEvent.click(
    screen.getByRole("button", { name: "open subagent in pane" }),
  );

  const panes = Object.values(usePaneStore.getState().panes);
  expect(panes).toHaveLength(2);
  expect(panes.find((p) => p.kind === "subagent")).toMatchObject({
    sessionId: "session-7",
    subagentId: "sub-9",
  });
  // The drill-in state is untouched — the pane opens beside the chat instead
  // of replacing the center transcript.
  expect(useChatStore.getState().inspectedSubagent).toBeNull();
});

it("summarizes usage, plan progress, and live agents in the strip (AGE-807)", () => {
  useChatStore.setState({
    activeSessionId: "session-7",
    openSessions: {
      "session-7": {
        contextUsage: { percent: 41.4 },
        todoPhases: [
          {
            id: "p",
            name: "Phase",
            tasks: [
              { id: "1", content: "a", status: "completed" },
              { id: "2", content: "b", status: "pending" },
              // Dropped tasks leave the denominator entirely.
              { id: "3", content: "c", status: "dropped" },
            ],
          },
        ],
        subagents: [
          { id: "x", status: "running" },
          { id: "y", status: "completed" },
        ],
      },
    } as never,
  });

  render(<ChatPanelDock />);

  const strip = screen.getByRole("button", { name: "Session panels" });
  expect(strip).toHaveTextContent("Usage 41%");
  expect(strip).toHaveTextContent("Plan 1/2");
  expect(strip).toHaveTextContent("Agents 1 live");
});

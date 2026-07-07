// AGE-674 — the chat workspace renders a full-width transcript. The
// Usage/Plan/Subagents panels moved out of the old middle rail into the left
// sidebar dock (`ChatPanelDock`), so there is no resize rail or icon strip here
// anymore, regardless of whether a shell panel is open. Clicking a subagent
// (from the sidebar dock) sets `inspectedSubagentId`, which pops that subagent's
// transcript into this center view in place of the main transcript. The data-/
// IPC-bound children are stubbed to inert markers so the test exercises only the
// center-view selection.

import { fireEvent, render, screen } from "@testing-library/react";
import { useChatStore } from "@/store/chat";
import { MAIN_PANE_ID, usePaneStore } from "@/store/panes";
import { useShellStore } from "@/store/shell";
import ChatWorkspace from "./Chat";

vi.mock("@/components/chat/MessageList", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));
vi.mock("@/components/chat/Composer", () => ({ Composer: () => null }));
vi.mock("@/components/chat/ModelControl", () => ({ ModelControl: () => null }));
vi.mock("@/components/chat/ThinkingControl", () => ({
  ThinkingControl: () => null,
}));
vi.mock("@/components/chat/SessionList", () => ({
  SessionStatusBadge: () => null,
}));
vi.mock("@/components/chat/SessionStatsPanel", () => ({
  ContextMeterChip: () => null,
}));
vi.mock("@/components/chat/SubagentInspector", () => ({
  SubagentInspector: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="subagent-inspector">
      <button type="button" onClick={onBack}>
        Back to chat
      </button>
    </div>
  ),
}));
vi.mock("@/components/chat/UiRequestLayer", () => ({
  UiRequestLayer: () => null,
}));
vi.mock("@/components/chat/ui-request/ApprovalModeControl", () => ({
  ApprovalModeControl: () => null,
}));

const SESSION_ID = "session-1";

beforeEach(() => {
  useChatStore.setState({
    activeSessionId: SESSION_ID,
    openSessions: {
      [SESSION_ID]: {
        status: "idle",
        thinkingLevel: "medium",
        subagents: [{ id: "sub-1" }],
      },
    } as never,
    inspectedSubagent: null,
  });
  useShellStore.setState({ openPanelId: null });
  usePaneStore.getState().reset();
});

/** The old middle rail's resize divider — must no longer exist anywhere. */
const railHandle = () =>
  screen.queryByRole("separator", { name: "Resize panel rail" });
/** The old collapsed icon-strip's expand affordance — also gone. */
const iconStripExpand = () =>
  screen.queryByRole("button", { name: "Expand panel rail" });

describe("ChatSession center view (AGE-674)", () => {
  it("renders a full-width transcript with no middle rail or icon strip", () => {
    render(<ChatWorkspace />);

    expect(screen.getByTestId("message-list")).toBeInTheDocument();
    expect(screen.queryByTestId("subagent-inspector")).not.toBeInTheDocument();
    expect(railHandle()).not.toBeInTheDocument();
    expect(iconStripExpand()).not.toBeInTheDocument();
  });

  it("keeps the transcript full-width even when a shell panel is open", () => {
    useShellStore.setState({ openPanelId: "terminal" });

    render(<ChatWorkspace />);

    // No more reflow coupling: the transcript stays full-width and no rail or
    // icon strip is wedged beside the open shell panel.
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
    expect(railHandle()).not.toBeInTheDocument();
    expect(iconStripExpand()).not.toBeInTheDocument();
  });

  it("pops a subagent's transcript into the center when one is inspected", () => {
    useChatStore.setState({
      inspectedSubagent: { sessionId: SESSION_ID, subagentId: "sub-1" },
    });

    render(<ChatWorkspace />);

    expect(screen.getByTestId("subagent-inspector")).toBeInTheDocument();
    expect(screen.queryByTestId("message-list")).not.toBeInTheDocument();
  });

  it("returns from the subagent inspector to the chat transcript", () => {
    useChatStore.setState({
      inspectedSubagent: { sessionId: SESSION_ID, subagentId: "sub-1" },
    });

    render(<ChatWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(useChatStore.getState().inspectedSubagent).toBeNull();
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
    expect(screen.queryByTestId("subagent-inspector")).not.toBeInTheDocument();
  });

  it("toggles the Focused/Activity-rail layout from the header (AGE-708)", () => {
    render(<ChatWorkspace />);

    // Focused by default: the Activity rail column is not mounted.
    expect(screen.queryByText("No tool steps yet.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Activity rail" }));
    expect(screen.getByText("No tool steps yet.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Focused" }));
    expect(screen.queryByText("No tool steps yet.")).not.toBeInTheDocument();
  });

  it("opens this chat in a second pane pinned to the session (AGE-777)", () => {
    render(<ChatWorkspace />);

    fireEvent.click(
      screen.getByRole("button", { name: "Open this chat in a split pane" }),
    );

    const { panes, focusedPaneId } = usePaneStore.getState();
    const ids = Object.keys(panes);
    expect(ids).toHaveLength(2);
    const extra = ids.find((id) => id !== MAIN_PANE_ID);
    // The NEW pane is pinned to this session; the default pane keeps following
    // the active session, so switching chats later leaves this one visible.
    expect(panes[extra!]).toEqual({
      id: extra,
      kind: "chat",
      sessionId: SESSION_ID,
    });
    expect(focusedPaneId).toBe(extra);
  });
});

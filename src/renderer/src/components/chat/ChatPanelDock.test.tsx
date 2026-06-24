// AGE-674 — the sidebar panel dock hosts the relocated Usage / Plan / Subagents
// widgets. It renders nothing without an active session, shows all three for an
// active one, and wires the Subagents widget's drill-in into the shared chat
// store (`inspectedSubagentId`) so the center view can pop the transcript. The
// data-bound panels are stubbed to markers so the test asserts only placement +
// the drill-in wiring, not each panel's internals.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useChatStore } from "@/store/chat";
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
  SubagentTree: ({ onInspect }: { onInspect: (id: string) => void }) => (
    <button type="button" onClick={() => onInspect("sub-9")}>
      inspect subagent
    </button>
  ),
}));

beforeEach(() => {
  useChatStore.setState({ activeSessionId: null, inspectedSubagentId: null });
});

const inspectButton = () =>
  screen.getByRole("button", { name: "inspect subagent" });

describe("ChatPanelDock", () => {
  it("renders nothing without an active session", () => {
    const { container } = render(<ChatPanelDock />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the Usage, Plan, and Subagents widgets for an active session", () => {
    useChatStore.setState({ activeSessionId: "session-7" });

    render(<ChatPanelDock />);

    expect(screen.getByTestId("usage-widget")).toHaveTextContent("session-7");
    expect(screen.getByTestId("plan-widget")).toBeInTheDocument();
    expect(inspectButton()).toBeInTheDocument();
  });

  it("wires the subagent drill-in into the chat store", async () => {
    useChatStore.setState({ activeSessionId: "session-7" });

    render(<ChatPanelDock />);
    await userEvent.click(inspectButton());

    expect(useChatStore.getState().inspectedSubagentId).toBe("sub-9");
  });
});

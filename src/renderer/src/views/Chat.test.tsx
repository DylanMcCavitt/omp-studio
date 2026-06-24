// AGE-669 — when a shell rail panel (Terminal/Files/…) owns the far-right
// column, the chat workspace must collapse its own Panels rail to the icon strip
// so the transcript reclaims the freed width instead of leaving a wedged, often
// sparse "dead middle band" between the transcript and the opened panel. The chat
// rail and a shell panel never stack; expanding the chat rail from the icon strip
// closes the shell panel. The data-heavy chat children are stubbed so the test
// exercises only this structural reflow decision (assertions go through roles).

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useChatStore } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";
import { useShellStore } from "@/store/shell";
import ChatWorkspace from "./Chat";

// Stub the data-/IPC-bound chat children to inert nodes; only MessageList leaves
// a marker so we can assert the transcript renders in both presentations.
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
  SessionStatsPanel: () => null,
}));
vi.mock("@/components/chat/TodoPanel", () => ({ TodoPanel: () => null }));
vi.mock("@/components/chat/SubagentTree", () => ({ SubagentTree: () => null }));
vi.mock("@/components/chat/SubagentInspector", () => ({
  SubagentInspector: () => null,
}));
vi.mock("@/components/chat/UiRequestLayer", () => ({
  UiRequestLayer: () => null,
}));

const SESSION_ID = "session-1";

beforeEach(() => {
  useChatStore.setState({
    activeSessionId: SESSION_ID,
    openSessions: {
      [SESSION_ID]: {
        status: "idle",
        thinkingLevel: "medium",
        subagents: [],
      },
    } as never,
    inspectedSubagentId: null,
  });
  useSettingsStore.setState({
    settings: { layout: { chatRailCollapsed: false } } as never,
    setLayout: vi.fn(),
  });
  useShellStore.setState({ openPanelId: null });
});

/** The resize divider exists ONLY in the expanded ChatRailSplit presentation. */
const expandedRailHandle = () =>
  screen.queryByRole("separator", { name: "Resize panel rail" });
/** The expand affordance exists ONLY in the collapsed icon-strip presentation. */
const iconStripExpand = () =>
  screen.queryByRole("button", { name: "Expand panel rail" });

describe("ChatSession rail reflow (AGE-669)", () => {
  it("shows the expandable Panels rail when no shell panel is open", () => {
    render(<ChatWorkspace />);

    expect(screen.getByTestId("message-list")).toBeInTheDocument();
    expect(expandedRailHandle()).toBeInTheDocument();
    expect(iconStripExpand()).not.toBeInTheDocument();
  });

  it("collapses the Panels rail to the icon strip when a shell panel opens, so the transcript reclaims the width", () => {
    useShellStore.setState({ openPanelId: "terminal" });

    render(<ChatWorkspace />);

    // Transcript still renders; the wedged expandable rail is gone (no handle).
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
    expect(iconStripExpand()).toBeInTheDocument();
    expect(expandedRailHandle()).not.toBeInTheDocument();
  });

  it("still honors the persisted collapsed preference when no shell panel is open", () => {
    useSettingsStore.setState({
      settings: { layout: { chatRailCollapsed: true } } as never,
      setLayout: vi.fn(),
    });

    render(<ChatWorkspace />);

    expect(iconStripExpand()).toBeInTheDocument();
    expect(expandedRailHandle()).not.toBeInTheDocument();
  });

  it("expanding from the icon strip closes the shell panel so the two rails never stack", async () => {
    const user = userEvent.setup();
    useShellStore.setState({ openPanelId: "terminal" });
    render(<ChatWorkspace />);

    await user.click(screen.getByRole("button", { name: "Expand panel rail" }));

    // The shell panel yields, and the expandable Panels rail returns — never both.
    expect(useShellStore.getState().openPanelId).toBeNull();
    expect(expandedRailHandle()).toBeInTheDocument();
  });
});

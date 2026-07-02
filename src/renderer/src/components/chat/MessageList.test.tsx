import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useChatStore } from "@/store/chat";
import { createSession } from "@/store/session-reducer";
import { useSettingsStore } from "@/store/settings";
import { MessageList } from "./MessageList";

interface VirtuosoProps<Row> {
  data: Row[];
  computeItemKey?: (index: number, row: Row) => string;
  itemContent: (index: number, row: Row) => React.ReactNode;
}

vi.mock("react-virtuoso", () => ({
  Virtuoso<Row>({ data, computeItemKey, itemContent }: VirtuosoProps<Row>) {
    return (
      <div data-testid="virtuoso">
        {data.map((row, index) => (
          <div
            data-testid="virtuoso-row"
            key={computeItemKey ? computeItemKey(index, row) : index}
          >
            {itemContent(index, row)}
          </div>
        ))}
      </div>
    );
  },
}));

beforeEach(() => {
  useChatStore.setState({
    openSessions: {},
    sessionSummaries: {},
    activeSessionId: null,
  });
  useSettingsStore.setState({ settings: { workspaces: [] } as never });
});

test("live text updates replace only the live row without duplicating history, system cards, or loader", () => {
  useChatStore.setState({
    openSessions: {
      s1: createSession("s1", {
        status: "streaming",
        activeTool: null,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "historical question" }],
            timestamp: 1,
          },
        ],
        systemCards: [
          {
            id: "card-1",
            kind: "command_output",
            title: "Command output",
            body: "slash command output",
            afterCount: 1,
          },
        ],
        liveText: "first live token",
      }),
    },
  });

  render(<MessageList sessionId="s1" />);
  expect(screen.getByText("historical question")).toBeInTheDocument();
  expect(screen.getByText("slash command output")).toBeInTheDocument();
  expect(screen.getByText("first live token")).toBeInTheDocument();
  expect(screen.getByText("Working")).toBeInTheDocument();

  act(() => {
    useChatStore.setState((state) => ({
      openSessions: {
        ...state.openSessions,
        s1: {
          ...state.openSessions.s1!,
          liveText: "second live token",
        },
      },
    }));
  });

  expect(screen.getByText("historical question")).toBeInTheDocument();
  expect(screen.getAllByText("historical question")).toHaveLength(1);
  expect(screen.getByText("slash command output")).toBeInTheDocument();
  expect(screen.getAllByText("slash command output")).toHaveLength(1);
  expect(screen.queryByText("first live token")).not.toBeInTheDocument();
  expect(screen.getByText("second live token")).toBeInTheDocument();
  expect(screen.getAllByText("Working")).toHaveLength(1);
});

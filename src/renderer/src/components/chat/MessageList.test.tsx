import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Ref } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { useChatStore } from "@/store/chat";
import { createSession } from "@/store/session-reducer";
import { useSettingsStore } from "@/store/settings";
import { MessageList } from "./MessageList";

interface VirtuosoProps<Row> {
  data: Row[];
  computeItemKey?: (index: number, row: Row) => string;
  itemContent: (index: number, row: Row) => React.ReactNode;
  scrollerRef?: (element: HTMLDivElement | null) => void;
  followOutput?: boolean | ((atBottom: boolean) => false | "auto");
  atBottomThreshold?: number;
}

interface VirtuosoHandleMock {
  scrollToIndex(opts: { index: number }): void;
}

vi.mock("react-virtuoso", async () => {
  // vi.mock factories are hoisted above top-level imports, so React must be
  // loaded dynamically inside the factory (vitest requirement).
  const React = await import("react");
  return {
    Virtuoso: React.forwardRef(function VirtuosoMock(
      {
        data,
        computeItemKey,
        itemContent,
        scrollerRef,
        followOutput,
        atBottomThreshold = 80,
      }: VirtuosoProps<unknown>,
      fwdRef: Ref<VirtuosoHandleMock>,
    ) {
      const ref = React.useRef<HTMLDivElement | null>(null);
      const [atBottom, setAtBottom] = React.useState(true);

      // The real library exposes an imperative handle; the trail's click-jump
      // relies on scrollToIndex because virtualization unmounts far rows.
      React.useImperativeHandle(fwdRef, () => ({
        scrollToIndex({ index }: { index: number }) {
          const el = ref.current;
          if (el) el.scrollTop = index * 80;
        },
      }));

      React.useEffect(() => {
        // Mirror the real react-virtuoso contract: scrollerRef is a callback,
        // never a RefObject — a RefObject branch here would hide integration
        // bugs the library ignores.
        scrollerRef?.(ref.current);
      }, [scrollerRef]);

      React.useEffect(() => {
        const el = ref.current;
        if (!el || !atBottom) return;
        const mode =
          typeof followOutput === "function"
            ? followOutput(true)
            : followOutput;
        if (mode === "auto") {
          el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        }
      }, [data, atBottom, followOutput]);

      return (
        <div
          ref={ref}
          data-testid="virtuoso"
          style={{ overflow: "auto", height: 120 }}
          onScroll={(event) => {
            const el = event.currentTarget;
            const nextAtBottom =
              el.scrollHeight - el.scrollTop - el.clientHeight <=
              atBottomThreshold;
            setAtBottom(nextAtBottom);
          }}
        >
          {data.map((row, index) => (
            <div
              data-testid="virtuoso-row"
              key={computeItemKey ? computeItemKey(index, row) : index}
              style={{ minHeight: 80 }}
            >
              {itemContent(index, row)}
            </div>
          ))}
        </div>
      );
    }),
  };
});

class MockIntersectionObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );

  useChatStore.setState({
    openSessions: {},
    sessionSummaries: {},
    activeSessionId: null,
  });
  useSettingsStore.setState({ settings: { workspaces: [] } as never });
});

function seedMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    role: "user" as const,
    content: [{ type: "text" as const, text: `message ${index}` }],
    timestamp: index + 1,
  }));
}

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

test("hides the navigation trail for short transcripts", () => {
  useChatStore.setState({
    openSessions: {
      s1: createSession("s1", {
        messages: seedMessages(4),
      }),
    },
  });

  render(<MessageList sessionId="s1" />);
  expect(
    screen.queryByRole("navigation", { name: "Message position" }),
  ).toBeNull();
});

test("shows the navigation trail for long scrollable transcripts", () => {
  useChatStore.setState({
    openSessions: {
      s1: createSession("s1", {
        messages: seedMessages(12),
      }),
    },
  });

  render(<MessageList sessionId="s1" />);
  expect(
    screen.getByRole("navigation", { name: "Message position" }),
  ).toBeInTheDocument();
});

test("clicking a trail segment jumps to unmounted targets via the virtualized scroller", () => {
  useChatStore.setState({
    openSessions: {
      s1: createSession("s1", {
        messages: seedMessages(12),
      }),
    },
  });

  render(<MessageList sessionId="s1" />);
  const scroller = screen.getByTestId("virtuoso");
  scroller.scrollTop = 0; // start at the top, far from the last message

  const segments = screen.getAllByRole("button", { name: /jump to message/i });
  fireEvent.click(segments[segments.length - 1]!);

  // Regression (caught by the live demo): the old querySelector +
  // scrollIntoView path silently no-oped for rows virtualization had
  // unmounted. The jump must go through Virtuoso's scrollToIndex — the mock
  // handle scrolls index * row-height (12 messages -> last row index 11).
  expect(scroller.scrollTop).toBe(11 * 80);
});

test("keeps bottom-follow while streaming until the user scrolls away", () => {
  useChatStore.setState({
    openSessions: {
      s1: createSession("s1", {
        status: "streaming",
        activeTool: null,
        messages: seedMessages(12),
        liveText: "live chunk one",
      }),
    },
  });

  const { container } = render(<MessageList sessionId="s1" />);
  const scroller = container.querySelector(
    '[data-testid="virtuoso"]',
  ) as HTMLDivElement;

  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    value: 2000,
  });
  Object.defineProperty(scroller, "clientHeight", {
    configurable: true,
    value: 120,
  });
  scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;

  act(() => {
    useChatStore.setState((state) => ({
      openSessions: {
        ...state.openSessions,
        s1: {
          ...state.openSessions.s1!,
          liveText: "live chunk two",
        },
      },
    }));
  });

  expect(scroller.scrollTop).toBe(
    scroller.scrollHeight - scroller.clientHeight,
  );

  fireEvent.scroll(scroller, { target: { scrollTop: 0 } });
  scroller.scrollTop = 0;

  act(() => {
    useChatStore.setState((state) => ({
      openSessions: {
        ...state.openSessions,
        s1: {
          ...state.openSessions.s1!,
          liveText: "live chunk three",
        },
      },
    }));
  });

  expect(scroller.scrollTop).toBe(0);
});

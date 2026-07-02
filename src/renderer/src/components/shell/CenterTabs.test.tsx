// AGE-634 (center tab strip) + AGE-801 (pane host). The center renders the
// pane model's split tree. Default: ONE chat pane that follows the active
// session — the pre-pane shell exactly. With files open, the DEFAULT pane
// grows the Chat+files tab strip; switching keeps the chat MOUNTED (a live
// stream is never torn down); closing a clean tab is immediate while a dirty
// tab confirms first. New panes render beside the default pane and carry their
// own session ids.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, type ReactNode, useImperativeHandle } from "react";
import { CenterTabs } from "@/components/shell/CenterTabs";
import {
  PANE_DRAG_MIME,
  SUBAGENT_DRAG_MIME,
} from "@/components/shell/pane-actions";
import { useChatStore } from "@/store/chat";
import { CHAT_TAB, type FileTab, useFilesStore } from "@/store/files";
import { MAIN_PANE_ID, MAX_PANES, usePaneStore } from "@/store/panes";
import { useToastStore } from "@/store/toast";

const panelGroupProps = vi.hoisted(
  () =>
    [] as Array<{
      direction: "horizontal" | "vertical";
      onLayout?: (sizes: number[]) => void;
    }>,
);

const panelGroupSetLayout = vi.hoisted(() => vi.fn());

vi.mock("react-resizable-panels", () => ({
  PanelGroup: forwardRef(
    (
      {
        children,
        direction,
        onLayout,
        className,
      }: {
        children: ReactNode;
        direction: "horizontal" | "vertical";
        onLayout?: (sizes: number[]) => void;
        className?: string;
      },
      ref,
    ) => {
      useImperativeHandle(ref, () => ({ setLayout: panelGroupSetLayout }));
      const index = panelGroupProps.length;
      panelGroupProps.push({ direction, onLayout });
      return (
        <div
          data-testid="panel-group"
          data-direction={direction}
          data-index={index}
          className={className}
        >
          {children}
        </div>
      );
    },
  ),
  Panel: ({
    children,
    id,
    defaultSize,
    order,
    className,
  }: {
    children: ReactNode;
    id?: string;
    defaultSize?: number;
    order?: number;
    className?: string;
  }) => (
    <div
      data-testid="resizable-panel"
      data-panel-id={id}
      data-default-size={defaultSize}
      data-order={order}
      className={className}
    >
      {children}
    </div>
  ),
  PanelResizeHandle: ({
    children: _children,
    onDoubleClick,
    ...props
  }: {
    children?: ReactNode;
    onDoubleClick?: () => void;
    "aria-label"?: string;
    className?: string;
  }) => <hr onDoubleClick={onDoubleClick} {...props} />,
}));

// The pane host's contract is "each pane renders a session-scoped chat
// surface" — the surface itself is exercised by the Chat view tests. Mock it
// to a marker that names the session id it received.
vi.mock("@/views/Chat", () => ({
  default: ({ sessionId }: { sessionId?: string }) => (
    <div data-testid="chat-pane">CHAT-PANE:{sessionId ?? "follow-active"}</div>
  ),
}));

// The subagent pane's contract is "render the inspector for the pane's roster
// entry" — the inspector itself is exercised by its own suite. Mock it to a
// marker that names the subagent and exposes the Back affordance.
vi.mock("@/components/chat/SubagentInspector", () => ({
  SubagentInspector: ({
    subagent,
    onBack,
  }: {
    subagent: { id: string };
    onBack: () => void;
  }) => (
    <div data-testid="subagent-inspector">
      INSPECTOR:{subagent.id}
      <button type="button" onClick={onBack}>
        Back
      </button>
    </div>
  ),
}));

function tab(path: string, over: Partial<FileTab> = {}): FileTab {
  return {
    path,
    workspaceRoot: null,
    workspaceGeneration: 0,
    text: "",
    savedText: "",
    dirty: false,
    loading: false,
    tooLarge: false,
    // Binary so the active pane renders a notice, never the lazy editor.
    binary: true,
    truncated: false,
    error: false,
    ...over,
  };
}

function seedTabs(tabs: FileTab[], active: string) {
  const map: Record<string, FileTab> = {};
  for (const t of tabs) map[t.path] = t;
  useFilesStore.setState({
    tabs: map,
    order: tabs.map((t) => t.path),
    activeTab: active,
  });
}

beforeEach(() => {
  panelGroupProps.length = 0;
  panelGroupSetLayout.mockClear();
  useFilesStore.setState({
    workspaceRoot: null,
    workspaceGeneration: 0,
    children: {},
    expanded: {},
    dirLoading: {},
    tabs: {},
    order: [],
    activeTab: CHAT_TAB,
  });
  usePaneStore.getState().reset();
  useChatStore.setState({
    activeSessionId: null,
    openSessions: {},
    inspectedSubagent: null,
  } as never);
  useToastStore.setState({ toasts: [] });
});

/** Seed one open session with a name and a one-entry subagent roster. */
function seedSession(
  id: string,
  over: { sessionName?: string; subagents?: unknown[] } = {},
) {
  const session = {
    status: "idle",
    sessionName: over.sessionName ?? id,
    subagents: over.subagents ?? [],
  } as never;
  useChatStore.setState((s) => ({
    openSessions: { ...s.openSessions, [id]: session },
  }));
}

/** A minimal DataTransfer stub carrying the subagent drag payload. */
function subagentDataTransfer(payload: {
  sessionId: string;
  subagentId: string;
}) {
  return {
    types: [SUBAGENT_DRAG_MIME],
    getData: (t: string) =>
      t === SUBAGENT_DRAG_MIME ? JSON.stringify(payload) : "",
    dropEffect: "",
    effectAllowed: "",
  };
}

it("renders only the default chat pane (no tab strip) when no files are open", () => {
  render(<CenterTabs />);
  expect(screen.getByText("CHAT-PANE:follow-active")).toBeVisible();
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
});

it("shows a Chat tab plus one tab per open file", () => {
  seedTabs([tab("src/a.ts"), tab("b.md")], "src/a.ts");
  render(<CenterTabs />);

  const strip = screen.getByRole("tablist");
  expect(within(strip).getByRole("tab", { name: "Chat" })).toBeInTheDocument();
  expect(within(strip).getByRole("tab", { name: /a\.ts/ })).toBeInTheDocument();
  expect(within(strip).getByRole("tab", { name: /b\.md/ })).toBeInTheDocument();
});

it("switching to a file tab keeps the chat mounted but hidden", async () => {
  const user = userEvent.setup();
  seedTabs([tab("a.ts")], CHAT_TAB);
  render(<CenterTabs />);

  expect(screen.getByText("CHAT-PANE:follow-active")).toBeVisible();

  await user.click(screen.getByRole("tab", { name: /a\.ts/ }));

  expect(useFilesStore.getState().activeTab).toBe("a.ts");
  // The chat node is still in the DOM (state preserved), just no longer visible.
  expect(screen.getByText("CHAT-PANE:follow-active")).toBeInTheDocument();
  expect(screen.getByText("CHAT-PANE:follow-active")).not.toBeVisible();
  // The file pane is now the visible one (binary → read-only notice).
  expect(screen.getByText(/binary file/i)).toBeVisible();
});

it("closing a clean file tab is immediate; a dirty tab confirms first", async () => {
  const user = userEvent.setup();
  const confirmSpy = vi
    .spyOn(window, "confirm")
    .mockImplementation(() => false);
  seedTabs([tab("clean.ts"), tab("dirty.ts", { dirty: true })], "clean.ts");
  render(<CenterTabs />);

  await user.click(screen.getByRole("button", { name: "Close clean.ts" }));
  expect(useFilesStore.getState().order).toEqual(["dirty.ts"]);
  expect(confirmSpy).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Close dirty.ts" }));
  // Confirm declined → the dirty tab stays open.
  expect(confirmSpy).toHaveBeenCalledTimes(1);
  expect(useFilesStore.getState().order).toEqual(["dirty.ts"]);
  confirmSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// AGE-801: pane hosting — multiple session-scoped chat panes + file panes.
// ---------------------------------------------------------------------------

it("renders two chat panes targeting DIFFERENT session ids side by side", () => {
  usePaneStore.getState().openPane({ kind: "chat", sessionId: "session-b" });
  usePaneStore.getState().setPaneSession(MAIN_PANE_ID, "session-a");
  render(<CenterTabs />);

  const panes = screen.getAllByTestId("chat-pane");
  expect(panes).toHaveLength(2);
  expect(panes.map((p) => p.textContent)).toEqual([
    "CHAT-PANE:session-a",
    "CHAT-PANE:session-b",
  ]);
});

it("a pinned pane keeps its session while the default pane follows the active one", () => {
  usePaneStore.getState().openPane({ kind: "chat", sessionId: "pinned-1" });
  render(<CenterTabs />);

  const panes = screen.getAllByTestId("chat-pane");
  expect(panes.map((p) => p.textContent)).toEqual([
    "CHAT-PANE:follow-active",
    "CHAT-PANE:pinned-1",
  ]);
});

it("renders a file pane beside the chat pane from the pane model", () => {
  seedTabs([tab("notes.md")], CHAT_TAB); // registers the tab state FileEditor reads
  usePaneStore.getState().openPane({ kind: "file", path: "notes.md" });
  render(<CenterTabs />);

  expect(screen.getByText("CHAT-PANE:follow-active")).toBeVisible();
  // The dedicated file pane renders the editor surface (binary notice).
  expect(
    within(
      screen.getByRole("region", { name: /File pane: notes\.md/ }),
    ).getByText(/binary file/i),
  ).toBeVisible();
});

it("closing a pane collapses the split back to the default single pane", () => {
  const paneId = usePaneStore
    .getState()
    .openPane({ kind: "chat", sessionId: "temp" });
  expect(paneId).not.toBeNull();
  render(<CenterTabs />);
  expect(screen.getAllByTestId("chat-pane")).toHaveLength(2);

  act(() => {
    if (paneId) usePaneStore.getState().closePane(paneId);
  });
  expect(screen.getAllByTestId("chat-pane")).toHaveLength(1);
  expect(screen.getByText("CHAT-PANE:follow-active")).toBeVisible();
});

// ---------------------------------------------------------------------------
// AGE-777: split-pane chrome, subagent panes, and drop targets.
// ---------------------------------------------------------------------------

it("stays chrome-free with a single pane (no pane header, no close)", () => {
  useChatStore.setState({ activeSessionId: "s1" });
  seedSession("s1", { sessionName: "Alpha" });
  render(<CenterTabs />);

  expect(
    screen.queryByRole("button", { name: "Close pane" }),
  ).not.toBeInTheDocument();
  // The pane-header title only exists in multi-pane chrome.
  expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
});

it("grows per-pane title headers once a second pane exists; only extra panes close", async () => {
  useChatStore.setState({ activeSessionId: "s1" });
  seedSession("s1", { sessionName: "Alpha" });
  seedSession("s2", { sessionName: "Beta" });
  act(() => {
    usePaneStore.getState().openPane({ kind: "chat", sessionId: "s2" });
  });
  render(<CenterTabs />);

  // Main pane: titled after the ACTIVE session it follows, not closable.
  const main = screen.getByRole("region", { name: "Main chat pane" });
  expect(within(main).getByText("Alpha")).toBeVisible();
  expect(
    within(main).queryByRole("button", { name: "Close pane" }),
  ).not.toBeInTheDocument();

  // Extra pane: titled after its PINNED session, closable.
  const extra = screen.getByRole("region", { name: "Chat pane" });
  expect(within(extra).getByText("Beta")).toBeVisible();

  // A resizable divider separates the two panes.
  expect(screen.getAllByRole("separator").length).toBeGreaterThan(0);

  await userEvent.click(
    within(extra).getByRole("button", { name: "Close pane" }),
  );
  expect(screen.getAllByTestId("chat-pane")).toHaveLength(1);
  // Closing the pane never disposes the underlying session.
  expect(useChatStore.getState().openSessions.s2).toBeDefined();
});

it("marks the focused pane and moves focus with pointer-down", () => {
  let paneId: string | null = null;
  act(() => {
    paneId = usePaneStore
      .getState()
      .openPane({ kind: "chat", sessionId: "s2" });
  });
  render(<CenterTabs />);

  // The newest pane owns focus.
  const extra = screen.getByRole("region", { name: "Chat pane" });
  expect(extra).toHaveAttribute("data-focused", "true");

  const main = screen.getByRole("region", { name: "Main chat pane" });
  fireEvent.pointerDown(main);
  expect(usePaneStore.getState().focusedPaneId).toBe(MAIN_PANE_ID);
  expect(paneId).not.toBeNull();
});

it("renders a subagent pane's inspector and swaps back to the chat in place", async () => {
  useChatStore.setState({ activeSessionId: "s1" });
  seedSession("s1", {
    subagents: [
      {
        id: "a1",
        index: 0,
        agent: "task",
        agentSource: "bundled",
        status: "running",
        lastUpdate: 0,
        task: "Build the thing",
      },
    ],
  });
  let paneId: string | null = null;
  act(() => {
    paneId = usePaneStore
      .getState()
      .openPane({ kind: "subagent", sessionId: "s1", subagentId: "a1" });
  });
  render(<CenterTabs />);

  // The original chat pane is preserved beside the inspector pane.
  expect(screen.getByText("CHAT-PANE:follow-active")).toBeVisible();
  expect(screen.getByTestId("subagent-inspector")).toHaveTextContent(
    "INSPECTOR:a1",
  );

  // Back swaps the SAME pane to the parent session's transcript.
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(usePaneStore.getState().panes[paneId!]).toEqual({
    id: paneId,
    kind: "chat",
    sessionId: "s1",
  });
  expect(screen.getAllByTestId("chat-pane")).toHaveLength(2);
});

it("degrades a subagent pane to an empty state when the roster entry is gone", () => {
  seedSession("s1", { subagents: [] });
  act(() => {
    usePaneStore
      .getState()
      .openPane({ kind: "subagent", sessionId: "s1", subagentId: "ghost" });
  });
  render(<CenterTabs />);
  expect(screen.getByText("Subagent unavailable")).toBeVisible();
});

it("dropping a dragged subagent on a pane opens its inspector beside it", () => {
  useChatStore.setState({ activeSessionId: "s1" });
  seedSession("s1", {
    subagents: [
      {
        id: "a1",
        index: 0,
        agent: "task",
        agentSource: "bundled",
        status: "running",
        lastUpdate: 0,
        task: "Build the thing",
      },
    ],
  });
  render(<CenterTabs />);
  const main = screen.getByRole("region", { name: "Main chat pane" });

  // Drag-over shows the drop affordance…
  fireEvent.dragEnter(main, {
    dataTransfer: subagentDataTransfer({ sessionId: "s1", subagentId: "a1" }),
  });
  expect(screen.getByText("Dock here")).toBeVisible();

  // …and the drop opens the subagent pane beside the chat.
  fireEvent.drop(main, {
    dataTransfer: subagentDataTransfer({ sessionId: "s1", subagentId: "a1" }),
  });
  expect(screen.getByTestId("subagent-inspector")).toHaveTextContent(
    "INSPECTOR:a1",
  );
  expect(screen.getByText("CHAT-PANE:follow-active")).toBeVisible();
  const panes = usePaneStore.getState().panes;
  expect(Object.values(panes).find((p) => p.kind === "subagent")).toMatchObject(
    { sessionId: "s1", subagentId: "a1" },
  );
});

it("ignores foreign drags without the subagent payload", () => {
  render(<CenterTabs />);
  const main = screen.getByRole("region", { name: "Main chat pane" });
  fireEvent.dragEnter(main, {
    dataTransfer: { types: ["text/plain"], getData: () => "junk" },
  });
  expect(screen.queryByText("Dock here")).not.toBeInTheDocument();
  fireEvent.drop(main, {
    dataTransfer: { types: ["text/plain"], getData: () => "junk" },
  });
  expect(Object.keys(usePaneStore.getState().panes)).toHaveLength(1);
  expect(useToastStore.getState().toasts).toHaveLength(0);
});

it("a drop past the pane cap surfaces the limit toast instead of opening", () => {
  seedSession("s1");
  act(() => {
    for (let i = 1; i < MAX_PANES; i += 1) {
      const layout = usePaneStore.getState().layout;
      if (layout.kind === "split") {
        const otherWeight = 80 / (layout.children.length - 1);
        usePaneStore.getState().setSplitWeights(
          layout.splitId,
          layout.children.map((child) =>
            child.kind === "leaf" && child.paneId === MAIN_PANE_ID
              ? 20
              : otherWeight,
          ),
        );
      }
      const id = usePaneStore
        .getState()
        .openPane(
          { kind: "chat", sessionId: `s${i}` },
          { besideId: MAIN_PANE_ID },
        );
      expect(id).not.toBeNull();
    }
  });
  render(<CenterTabs />);
  const main = screen.getByRole("region", { name: "Main chat pane" });

  fireEvent.drop(main, {
    dataTransfer: subagentDataTransfer({ sessionId: "s1", subagentId: "a9" }),
  });
  expect(Object.keys(usePaneStore.getState().panes)).toHaveLength(MAX_PANES);
  const toasts = useToastStore.getState().toasts;
  expect(toasts.some((t) => t.title === "Pane limit reached")).toBe(true);
});

// ---------------------------------------------------------------------------
// AGE-806: pane drag-rearrange — header handle, edge docking, self-drop guard.
// ---------------------------------------------------------------------------

/** A minimal DataTransfer stub carrying a dragged pane id. */
function paneDataTransfer(paneId: string) {
  return {
    types: [PANE_DRAG_MIME],
    getData: (t: string) => (t === PANE_DRAG_MIME ? paneId : ""),
    dropEffect: "",
    effectAllowed: "",
  };
}

// NOTE: jsdom drag events carry no client coordinates, so host drops exercise
// dropEdgeFor's default "right" edge; the quadrant geometry itself is pinned
// by pane-actions.test.ts.

it("drags a pane by its header handle and re-docks it on drop", () => {
  act(() => {
    usePaneStore.getState().openPane({ kind: "chat", sessionId: "s2" });
  });
  render(<CenterTabs />);

  // The MAIN pane's header title area is its drag handle; it arms the payload.
  const main = screen.getByRole("region", { name: "Main chat pane" });
  const handle = within(main).getByRole("button", {
    name: "Move Main chat pane",
  });
  const setData = vi.fn();
  fireEvent.dragStart(handle, {
    dataTransfer: { setData, effectAllowed: "" },
  });
  expect(setData).toHaveBeenCalledWith(PANE_DRAG_MIME, MAIN_PANE_ID);
  fireEvent.dragEnd(handle);

  // Dropping main onto the extra pane docks it at the default (right) edge:
  // the row order flips from [main, extra] to [extra, main].
  const extra = screen.getByRole("region", { name: "Chat pane" });
  const extraId = extra.getAttribute("data-pane-id");
  fireEvent.drop(extra, { dataTransfer: paneDataTransfer(MAIN_PANE_ID) });

  expect(usePaneStore.getState().layout).toMatchObject({
    kind: "split",
    direction: "row",
    children: [
      { kind: "leaf", paneId: extraId },
      { kind: "leaf", paneId: MAIN_PANE_ID },
    ],
  });
  // The moved pane keeps focus; both panes still render with their content.
  expect(usePaneStore.getState().focusedPaneId).toBe(MAIN_PANE_ID);
  expect(screen.getAllByTestId("chat-pane")).toHaveLength(2);
});

it("suppresses the drop preview while a pane hovers its own surface", () => {
  act(() => {
    usePaneStore.getState().openPane({ kind: "chat", sessionId: "s2" });
  });
  render(<CenterTabs />);

  const extra = screen.getByRole("region", { name: "Chat pane" });
  const handle = within(extra).getByRole("button", { name: "Move Chat pane" });
  fireEvent.dragStart(handle, {
    dataTransfer: { setData: vi.fn(), effectAllowed: "" },
  });

  // Hovering the dragged pane itself invites nothing…
  fireEvent.dragEnter(extra, { dataTransfer: { types: [PANE_DRAG_MIME] } });
  expect(screen.queryByText("Dock here")).not.toBeInTheDocument();

  // …while any OTHER pane previews the dock.
  const main = screen.getByRole("region", { name: "Main chat pane" });
  fireEvent.dragEnter(main, { dataTransfer: { types: [PANE_DRAG_MIME] } });
  expect(screen.getByText("Dock here")).toBeVisible();

  fireEvent.dragEnd(handle);
});

// ---------------------------------------------------------------------------
// AGE-813: center pane split ids and live layout wiring.
// ---------------------------------------------------------------------------

it("uses durable split ids for nested panel ids across sibling close", () => {
  const a = usePaneStore.getState().openPane({ kind: "chat", sessionId: "a" });
  usePaneStore
    .getState()
    .openPane(
      { kind: "chat", sessionId: "b" },
      { besideId: a!, direction: "column" },
    );
  const c = usePaneStore
    .getState()
    .openPane(
      { kind: "chat", sessionId: "c" },
      { besideId: MAIN_PANE_ID, direction: "row", position: "before" },
    );
  const layout = usePaneStore.getState().layout;
  expect(layout.kind).toBe("split");
  const nested = layout.kind === "split" ? layout.children[2] : null;
  expect(nested?.kind).toBe("split");
  const nestedSplitId = nested?.kind === "split" ? nested.splitId : "";

  const { container, rerender } = render(<CenterTabs />);
  expect(
    container.querySelector(`[data-panel-id="${nestedSplitId}"]`),
  ).toBeInTheDocument();

  act(() => {
    usePaneStore.getState().closePane(c!);
  });
  rerender(<CenterTabs />);

  expect(
    container.querySelector(`[data-panel-id="${nestedSplitId}"]`),
  ).toBeInTheDocument();
});

it("wires PanelGroup layout changes and double-click reset into split weights", () => {
  usePaneStore.getState().openPane({ kind: "chat", sessionId: "s2" });
  const split = usePaneStore.getState().layout;
  expect(split.kind).toBe("split");

  render(<CenterTabs />);
  act(() => {
    panelGroupProps[0]?.onLayout?.([70, 30]);
  });
  const resized = usePaneStore.getState().layout;
  expect(resized.kind === "split" ? resized.weights : []).toEqual([70, 30]);

  fireEvent.doubleClick(screen.getByRole("separator"));
  const reset = usePaneStore.getState().layout;
  expect(reset.kind === "split" ? reset.weights : []).toEqual([50, 50]);
  // The live (uncontrolled) group must be re-laid-out imperatively too —
  // defaultSize is mount-only, so the store write alone wouldn't move panes.
  expect(panelGroupSetLayout).toHaveBeenCalledWith([50, 50]);
});

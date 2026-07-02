// AGE-779 — agent drops are explicit routing choices. The chooser previews the
// exact prompt and commits only after the user picks Steer, Queue, Parallel, or
// Pane. These tests keep each route honest without asserting visual styling.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type AgentDragPayload, agentSteeringText } from "@/lib/agentDrag";
import { useChatStore } from "@/store/chat";
import { layoutPaneIds, MAX_PANES, usePaneStore } from "@/store/panes";
import { createSession } from "@/store/session-reducer";
import { useToastStore } from "@/store/toast";
import { AgentDropChooser } from "./AgentDropChooser";

const PRISTINE_CHAT = useChatStore.getState();

const PAYLOAD: AgentDragPayload = {
  name: "planner",
  source: "project",
  description: "Plans the next step",
  spawns: "reviewer,tester",
};
const TEXT = agentSteeringText(PAYLOAD);

beforeEach(() => {
  useChatStore.setState(
    {
      ...PRISTINE_CHAT,
      openSessions: {
        s1: createSession("s1", {
          status: "idle",
          cwd: "/repo",
          messages: [],
        }),
      },
      activeSessionId: "s1",
    },
    true,
  );
  usePaneStore.getState().reset();
  useToastStore.setState({ toasts: [] });
  Object.assign(window.omp, {
    chat: {
      ...window.omp.chat,
      prompt: vi.fn().mockResolvedValue(undefined),
    },
  });
});

function renderChooser(
  overrides: Partial<{
    onSteer: (text: string) => void;
    onClose: () => void;
  }> = {},
) {
  const onSteer = overrides.onSteer ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  render(
    <AgentDropChooser
      payload={PAYLOAD}
      sessionId="s1"
      onSteer={onSteer}
      onClose={onClose}
    />,
  );
  return { onSteer, onClose };
}

it("previews the prompt and inserts editable steer text only after choosing Steer", async () => {
  const user = userEvent.setup();
  const { onSteer, onClose } = renderChooser();

  expect(
    screen.getByRole("dialog", { name: "Route agent planner" }),
  ).toBeInTheDocument();
  expect(screen.getByText(TEXT)).toBeInTheDocument();

  await user.click(
    screen.getByRole("button", { name: /steer current response/i }),
  );

  expect(onSteer).toHaveBeenCalledWith(TEXT);
  expect(onClose).toHaveBeenCalledOnce();
  expect(window.omp.chat.prompt).not.toHaveBeenCalled();
});

it("keeps Queue disabled when the target session is idle", async () => {
  const user = userEvent.setup();
  const startParallelChat = vi.fn().mockResolvedValue("parallel-1");
  useChatStore.setState({ startParallelChat } as never);
  const { onClose } = renderChooser();
  const queue = screen.getByRole("button", {
    name: /queue after current response/i,
  });

  expect(queue).toBeDisabled();
  expect(
    screen.getByText(
      "Nothing is streaming — steer instead, or run in parallel.",
    ),
  ).toBeInTheDocument();

  await user.click(queue);
  expect(window.omp.chat.prompt).not.toHaveBeenCalled();
  expect(startParallelChat).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it("queues through follow-up semantics while the session is streaming", async () => {
  const user = userEvent.setup();
  useChatStore.setState({
    openSessions: {
      s1: createSession("s1", {
        status: "streaming",
        cwd: "/repo",
        messages: [],
      }),
    },
    activeSessionId: "s1",
  });
  const { onClose } = renderChooser();

  await user.click(
    screen.getByRole("button", { name: /queue after current response/i }),
  );

  await waitFor(() =>
    expect(window.omp.chat.prompt).toHaveBeenCalledWith("s1", TEXT, {
      streamingBehavior: "followUp",
      images: undefined,
    }),
  );
  expect(onClose).toHaveBeenCalledOnce();
  expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
    kind: "success",
    title: "Queued planner after this response",
  });
});

it("starts a parallel chat in the same workspace and offers a Show toast", async () => {
  const user = userEvent.setup();
  const startParallelChat = vi.fn().mockResolvedValue("parallel-1");
  useChatStore.setState({ startParallelChat } as never);
  const { onClose } = renderChooser();

  await user.click(screen.getByRole("button", { name: /^run in parallel/i }));

  await waitFor(() =>
    expect(startParallelChat).toHaveBeenCalledWith(TEXT, { cwd: "/repo" }),
  );
  expect(onClose).toHaveBeenCalledOnce();
  expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
    kind: "success",
    title: "Started planner in a parallel chat",
    action: expect.objectContaining({ label: "Show" }),
  });
});

it("opens a new parallel session in a split pane without replacing the source chat", async () => {
  const user = userEvent.setup();
  const startParallelChat = vi.fn().mockResolvedValue("parallel-1");
  useChatStore.setState({ startParallelChat } as never);
  const { onClose } = renderChooser();

  await user.click(screen.getByRole("button", { name: /open in pane/i }));

  await waitFor(() =>
    expect(startParallelChat).toHaveBeenCalledWith(TEXT, { cwd: "/repo" }),
  );
  const { panes, layout } = usePaneStore.getState();
  expect(layoutPaneIds(layout)).toHaveLength(2);
  expect(Object.values(panes)).toContainEqual(
    expect.objectContaining({ kind: "chat", sessionId: "parallel-1" }),
  );
  expect(onClose).toHaveBeenCalledOnce();
});

it("disables pane routing at the pane cap", async () => {
  const user = userEvent.setup();
  const startParallelChat = vi.fn().mockResolvedValue("parallel-1");
  useChatStore.setState({ startParallelChat } as never);
  for (let i = 1; i < MAX_PANES; i += 1) {
    usePaneStore.getState().openPane({ kind: "chat", sessionId: `s${i + 1}` });
  }
  const { onClose } = renderChooser();
  const pane = screen.getByRole("button", { name: /open in pane/i });

  expect(pane).toBeDisabled();
  expect(
    screen.getByText(
      `Pane limit reached — up to ${MAX_PANES} panes can be open.`,
    ),
  ).toBeInTheDocument();

  await user.click(pane);
  expect(startParallelChat).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(layoutPaneIds(usePaneStore.getState().layout)).toHaveLength(MAX_PANES);
});

it("dismisses by Cancel, backdrop, and Escape without routing", async () => {
  const user = userEvent.setup();
  const startParallelChat = vi.fn().mockResolvedValue("parallel-1");
  useChatStore.setState({ startParallelChat } as never);
  const onSteer = vi.fn();
  const onClose = vi.fn();
  renderChooser({ onSteer, onClose });

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);

  cleanup();
  onClose.mockClear();
  renderChooser({ onSteer, onClose });
  await user.click(
    screen.getByRole("button", { name: "Dismiss agent routing" }),
  );
  expect(onClose).toHaveBeenCalledTimes(1);

  cleanup();
  onClose.mockClear();
  renderChooser({ onSteer, onClose });
  fireEvent.keyDown(
    screen.getByRole("dialog", { name: "Route agent planner" }),
    {
      key: "Escape",
    },
  );
  expect(onClose).toHaveBeenCalledTimes(1);

  expect(onSteer).not.toHaveBeenCalled();
  expect(startParallelChat).not.toHaveBeenCalled();
  expect(window.omp.chat.prompt).not.toHaveBeenCalled();
});

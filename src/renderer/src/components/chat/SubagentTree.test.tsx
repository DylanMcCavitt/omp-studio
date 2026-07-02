// AGE-777 — the Subagent tree's split-pane affordances. Each row can open its
// subagent's inspector in a workspace split pane (button) or be dragged into a
// pane drop target (grip arming the shared drag contract). Both affordances
// exist only in the pane-opening context (`onOpenInPane` provided) — the tree
// renders unchanged elsewhere. Assertions go through visible roles and the
// drag payload, never styling.

import type { SubagentSnapshot } from "@shared/rpc";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { SUBAGENT_DRAG_MIME } from "@/components/shell/pane-actions";
import { useChatStore } from "@/store/chat";
import { SubagentTree } from "./SubagentTree";

function snap(over: Partial<SubagentSnapshot> = {}): SubagentSnapshot {
  return {
    id: "a1",
    index: 0,
    agent: "task",
    agentSource: "bundled",
    status: "running",
    lastUpdate: 0,
    task: "Build the thing",
    ...over,
  };
}

function seedActiveSession(subagents: SubagentSnapshot[]) {
  useChatStore.setState({
    activeSessionId: "s1",
    openSessions: {
      s1: { status: "idle", subagents, subagentEvents: {} },
    },
  } as never);
}

beforeEach(() => {
  useChatStore.setState({
    activeSessionId: null,
    openSessions: {},
  } as never);
});

it("offers an open-in-split-pane action per row and reports the subagent id", async () => {
  seedActiveSession([snap()]);
  const onOpenInPane = vi.fn();
  render(<SubagentTree onInspect={vi.fn()} onOpenInPane={onOpenInPane} />);

  await userEvent.click(
    screen.getByRole("button", { name: /Open Build the thing in split pane/ }),
  );
  expect(onOpenInPane).toHaveBeenCalledWith("a1");
});

it("arms the drag grip with the shared subagent payload", () => {
  seedActiveSession([snap()]);
  render(<SubagentTree onInspect={vi.fn()} onOpenInPane={vi.fn()} />);

  const setData = vi.fn();
  fireEvent.dragStart(
    screen.getByRole("button", {
      name: /Drag Build the thing into a split pane/,
    }),
    { dataTransfer: { setData, effectAllowed: "" } },
  );
  expect(setData).toHaveBeenCalledWith(
    SUBAGENT_DRAG_MIME,
    JSON.stringify({ sessionId: "s1", subagentId: "a1" }),
  );
});

it("renders neither split affordance outside the pane-opening context", () => {
  seedActiveSession([snap()]);
  render(<SubagentTree onInspect={vi.fn()} />);

  // The inspect drill-in stays; the AGE-777 affordances do not render.
  expect(
    screen.getByRole("button", { name: /Inspect Build the thing/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /in split pane/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Drag Build the thing/ }),
  ).not.toBeInTheDocument();
});

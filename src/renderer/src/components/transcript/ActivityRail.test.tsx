// AGE-708 — the Activity rail derives its run-timeline from the live transcript
// tool frames (no new data model) and renders it in the Live Dot status
// language. These cover the three testable seams the issue calls out: the
// Focused | Activity-rail toggle, the mixed done/running/queued step mapping,
// and the footer count.

import type { OmpMessage } from "@shared/rpc";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ActivityRail,
  type ActivityStep,
  deriveActivitySteps,
  summarizeSteps,
  TranscriptModeToggle,
} from "./ActivityRail";

/** An assistant message carrying a single tool call. */
const toolCall = (id: string, name: string): OmpMessage =>
  ({
    role: "assistant",
    content: [{ type: "toolCall", id, name, arguments: { path: "x" } }],
  }) as OmpMessage;

/** A tool result for a prior call. */
const toolResult = (id: string, isError = false): OmpMessage =>
  ({
    role: "toolResult",
    toolCallId: id,
    toolName: "tool",
    content: "ok",
    isError,
  }) as OmpMessage;

/**
 * A single in-flight assistant snapshot carrying several tool-call blocks — the
 * shape `message_update` streams before any `toolResult` is reconciled.
 */
const streamingTurn = (...tools: [id: string, name: string][]): OmpMessage =>
  ({
    role: "assistant",
    content: tools.map(([id, name]) => ({
      type: "toolCall",
      id,
      name,
      arguments: { path: "x" },
    })),
  }) as OmpMessage;

describe("deriveActivitySteps (mixed step mapping)", () => {
  it("maps resolved/running/pending calls to done/running/queued", () => {
    // `a` is reconciled (toolResult), `b` is live-running, `c` has no record.
    const messages: OmpMessage[] = [
      toolCall("a", "read"),
      toolResult("a"),
      toolCall("b", "search"),
      toolCall("c", "edit"),
    ];
    const steps = deriveActivitySteps(messages, { b: "running" });
    expect(steps.map((s) => [s.title, s.status])).toEqual([
      ["read", "done"],
      ["search", "running"],
      ["edit", "queued"],
    ]);
  });

  it("settles live tool completion before its toolResult is reconciled", () => {
    // A realistic mid-turn snapshot: one assistant message carrying three tool
    // calls, with the live tool-run record (from tool_execution_* frames) ahead
    // of the transcript — `read` has *finished* but no `toolResult` message has
    // landed yet, `grep` errored, `edit` is executing, `write` is still queued.
    const messages: OmpMessage[] = [
      streamingTurn(
        ["a", "read"],
        ["b", "grep"],
        ["c", "edit"],
        ["d", "write"],
      ),
    ];
    const steps = deriveActivitySteps(messages, {
      a: "done",
      b: "error",
      c: "running",
    });
    expect(steps.map((s) => [s.title, s.status, s.meta])).toEqual([
      ["read", "done", '{"path":"x"}'],
      ["grep", "done", "error"],
      ["edit", "running", '{"path":"x"}'],
      ["write", "queued", '{"path":"x"}'],
    ]);
    // Footer counts reflect the live state, not the (absent) toolResults.
    expect(summarizeSteps(steps)).toBe("2 done · 1 running · 1 queued");
  });

  it("surfaces a failed tool result as a done step with error meta", () => {
    const steps = deriveActivitySteps(
      [toolCall("a", "read"), toolResult("a", true)],
      {},
    );
    expect(steps[0]).toMatchObject({ status: "done", meta: "error" });
  });

  it("leaves unresolved calls queued with no live run record", () => {
    const steps = deriveActivitySteps([toolCall("b", "search")], {});
    expect(steps[0]?.status).toBe("queued");
  });
});

describe("summarizeSteps (footer counts)", () => {
  const step = (status: ActivityStep["status"], id: string): ActivityStep => ({
    id,
    title: "t",
    meta: "",
    status,
  });

  it("counts each non-zero state, joined with a middot", () => {
    const steps = [
      step("done", "1"),
      step("done", "2"),
      step("done", "3"),
      step("running", "4"),
    ];
    expect(summarizeSteps(steps)).toBe("3 done · 1 running");
  });

  it("omits zero-count states and includes queued when present", () => {
    expect(
      summarizeSteps([
        step("done", "1"),
        step("queued", "2"),
        step("queued", "3"),
      ]),
    ).toBe("1 done · 2 queued");
  });
});

describe("ActivityRail", () => {
  it("renders a node per step with its status and the footer summary", () => {
    const steps = deriveActivitySteps(
      [toolCall("a", "read"), toolResult("a"), toolCall("b", "search")],
      { b: "running" },
    );
    render(<ActivityRail steps={steps} color="blue" />);
    expect(screen.getByText("Run activity")).toBeInTheDocument();
    const nodes = screen.getAllByRole("listitem");
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toHaveAttribute("data-step-status", "done");
    expect(nodes[1]).toHaveAttribute("data-step-status", "running");
    expect(screen.getByText("running…")).toBeInTheDocument();
    expect(screen.getByText("1 done · 1 running")).toBeInTheDocument();
  });

  it("shows an empty hint and zero-step footer with no steps", () => {
    render(<ActivityRail steps={[]} color={undefined} />);
    expect(screen.getByText("No tool steps yet.")).toBeInTheDocument();
    expect(screen.getByText("0 steps")).toBeInTheDocument();
  });
});

describe("TranscriptModeToggle", () => {
  it("marks the active segment and toggles on click", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TranscriptModeToggle value="focused" onChange={onChange} />,
    );
    const focused = screen.getByRole("button", { name: "Focused" });
    const activity = screen.getByRole("button", { name: "Activity rail" });
    expect(focused).toHaveAttribute("aria-pressed", "true");
    expect(activity).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(activity);
    expect(onChange).toHaveBeenCalledWith("activity");

    rerender(<TranscriptModeToggle value="activity" onChange={onChange} />);
    expect(
      screen.getByRole("button", { name: "Activity rail" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

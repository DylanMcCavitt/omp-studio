// AGE-704 — the restyled tool card. Locks the header (status dot + icon + mono
// title + "+N −M" counts), the edit card's compact diff lines, and the running
// card (workspace-color border + pulsing header dot + blinking "running…").
// `editDiff` is exercised directly as the pure source of counts/lines.

import type { ToolCallBlock, ToolResultMessage } from "@shared/rpc";
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { editDiff, ToolCallCard } from "./ToolCallCard";

const call = (name: string, args: unknown, id = "t1"): ToolCallBlock => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
});

const ok = (id = "t1"): ToolResultMessage => ({
  role: "toolResult",
  toolCallId: id,
  toolName: "x",
  content: "done",
  isError: false,
});

describe("editDiff", () => {
  test("parses +/- prefixed lines into counts and ordered lines", () => {
    const d = editDiff(
      call("edit", { input: "+added one\n-removed one\n+added two" }),
    );
    expect(d).not.toBeNull();
    expect(d?.added).toBe(2);
    expect(d?.removed).toBe(1);
    expect(d?.lines).toEqual([
      { kind: "add", text: "added one" },
      { kind: "remove", text: "removed one" },
      { kind: "add", text: "added two" },
    ]);
  });

  test("ignores +++/--- file headers", () => {
    const d = editDiff(call("ast_edit", { diff: "+++ a\n--- b\n+real" }));
    expect(d?.added).toBe(1);
    expect(d?.removed).toBe(0);
  });

  test("keeps diff body lines that start with literal +/- content", () => {
    const d = editDiff(
      call("edit", { input: "++value\n-- item\n+keep\n-drop" }),
    );
    expect(d?.added).toBe(2);
    expect(d?.removed).toBe(2);
    expect(d?.lines).toEqual([
      { kind: "add", text: "+value" },
      { kind: "remove", text: "- item" },
      { kind: "add", text: "keep" },
      { kind: "remove", text: "drop" },
    ]);
  });

  test("write counts its whole body as added", () => {
    const d = editDiff(call("write", { content: "line a\nline b\nline c\n" }));
    expect(d?.added).toBe(3);
    expect(d?.removed).toBe(0);
    expect(d?.lines.at(-1)).toEqual({ kind: "add", text: "line c" });
  });

  test("returns null for non-edit tools", () => {
    expect(editDiff(call("bash", { cmd: "ls" }))).toBeNull();
  });
});

describe("ToolCallCard header", () => {
  test("renders the mono title, a success dot, and no edit counts for a plain tool", () => {
    render(<ToolCallCard call={call("bash", { cmd: "ls" })} result={ok()} />);
    expect(screen.getByText("bash")).toBeInTheDocument();
    const dot = document.querySelector('[data-status="success"]');
    expect(dot).not.toBeNull();
    // No edit diff → no counts row.
    expect(screen.queryByText(/^\+\d/)).toBeNull();
  });

  test("edit card shows +N −M counts and a compact diff with add/remove lines", () => {
    render(
      <ToolCallCard
        call={call("edit", { input: "+the new line\n-the old line" })}
        result={ok()}
      />,
    );
    expect(screen.getByText("edit")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
    // Diff preview rows carry kind-tagged classes.
    const add = document.querySelector('[data-diff="add"]');
    const remove = document.querySelector('[data-diff="remove"]');
    expect(add?.className).toContain("text-success");
    expect(remove?.className).toContain("text-danger");
    expect(screen.getByText("the new line")).toBeInTheDocument();
  });

  test("edit diff preview is capped at two lines", () => {
    render(
      <ToolCallCard
        call={call("edit", { input: "+a\n+b\n+c\n+d" })}
        result={ok()}
      />,
    );
    expect(document.querySelectorAll("[data-diff]")).toHaveLength(2);
  });
});

describe("running tool card", () => {
  test("a result-less call in a running session pulses + blinks in the workspace color", () => {
    const { container } = render(
      <ToolCallCard
        call={call("bash", { cmd: "sleep 1" })}
        sessionRunning
        workspaceColorKey="blue"
      />,
    );
    // Border carries the workspace hue inline.
    const card = container.querySelector("[data-running]") as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.style.borderColor).not.toBe("");
    // Header dot is the running Live Dot (pulse animation).
    const dot = document.querySelector(
      '[data-status="running"]',
    ) as HTMLElement;
    expect(dot.className).toContain("animate-omp-pulse");
    // Blinking running label.
    const label = screen.getByText("running…");
    expect(label.className).toContain("animate-omp-blink");
  });

  test("a result-less call in an idle session does not animate as running", () => {
    render(
      <ToolCallCard
        call={call("bash", { cmd: "sleep 1" })}
        sessionRunning={false}
        workspaceColorKey="blue"
      />,
    );
    expect(document.querySelector("[data-running]")).toBeNull();
    expect(screen.queryByText("running…")).toBeNull();
  });
});

// AGE-696 — every TranscriptView render branch coerces content via the shared
// toContentBlocks / blocksText helpers, so a transcript renders any role with
// string | undefined | array content without throwing (the
// `content.map / .filter is not a function` crash family). Builds on AGE-689,
// which fixed only the subagent-assistant case.

import type { OmpMessage } from "@shared/rpc";
import { render, screen } from "@testing-library/react";
import { TranscriptView } from "./TranscriptView";

const message = (role: string, content: unknown): OmpMessage =>
  ({
    role,
    content,
    toolName: "tool",
    toolCallId: "c1",
  }) as unknown as OmpMessage;

const ROLES = ["user", "assistant", "toolResult"] as const;
const SHAPES: ReadonlyArray<readonly [string, unknown]> = [
  ["undefined", undefined],
  ["string", "hello"],
  ["array", [{ type: "text", text: "block" }]],
];

describe("TranscriptView content coercion (AGE-696)", () => {
  for (const role of ROLES) {
    for (const [label, content] of SHAPES) {
      it(`renders a ${role} message with ${label} content without throwing`, () => {
        expect(() =>
          render(<TranscriptView messages={[message(role, content)]} />),
        ).not.toThrow();
      });
    }
  }

  it("renders bare-string assistant content as text", () => {
    render(
      <TranscriptView messages={[message("assistant", "assistant text")]} />,
    );
    expect(screen.getByText("assistant text")).toBeInTheDocument();
  });
});

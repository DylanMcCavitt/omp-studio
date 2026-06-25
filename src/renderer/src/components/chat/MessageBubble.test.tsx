// AGE-656 — MessageBubble must render assistant turns whose `content` arrives as
// a bare string (omp emits text-only turns this way). The assistant branch used
// `message.content.map`, which threw `content.map is not a function` and crashed
// the whole transcript through the error boundary. Guarded both at the reducer
// and here; this locks the render-side guard.

import type { ToolResultMessage } from "@shared/rpc";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { MessageBubble } from "./MessageBubble";

const noResults = new Map<string, ToolResultMessage>();

test("renders an assistant message with array (block) content", () => {
  render(
    <MessageBubble
      message={{
        role: "assistant",
        content: [{ type: "text", text: "block text" }],
      }}
      toolResults={noResults}
    />,
  );
  expect(screen.getByText("block text")).toBeInTheDocument();
});

test("renders an assistant message with bare string content without crashing", () => {
  render(
    <MessageBubble
      message={{ role: "assistant", content: "raw string turn" as never }}
      toolResults={noResults}
    />,
  );
  expect(screen.getByText("raw string turn")).toBeInTheDocument();
});

test("renders an assistant message with empty string content without crashing", () => {
  const { container } = render(
    <MessageBubble
      message={{ role: "assistant", content: "" as never }}
      toolResults={noResults}
    />,
  );
  // No blocks to render, but the bubble shell still mounts (no throw).
  expect(container.firstChild).not.toBeNull();
});

// AGE-704 — turn restyle: user turns lead with an uppercase "YOU" label; the
// assistant turn leads with the ω accent avatar.
test("renders a user turn with a YOU label and its body", () => {
  render(
    <MessageBubble
      message={{ role: "user", content: "hello there" }}
      toolResults={noResults}
    />,
  );
  expect(screen.getByText("YOU")).toBeInTheDocument();
  expect(screen.getByText("hello there")).toBeInTheDocument();
});

test("renders an assistant turn with the ω avatar", () => {
  render(
    <MessageBubble
      message={{ role: "assistant", content: [{ type: "text", text: "hi" }] }}
      toolResults={noResults}
    />,
  );
  expect(screen.getByText("ω")).toBeInTheDocument();
  expect(screen.getByText("hi")).toBeInTheDocument();
});

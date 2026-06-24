// AGE-689 — a freshly-spawned subagent can emit an assistant message with no
// `content`, which crashed the transcript with "Cannot read properties of
// undefined (reading 'map')". TranscriptView's assistant block now coerces
// string | undefined content to ContentBlock[] before mapping. These pin that
// the crash site renders bad-shaped content without throwing and keeps string /
// array rendering intact.

import type { OmpMessage } from "@shared/rpc";
import { render, screen } from "@testing-library/react";
import { TranscriptView } from "./TranscriptView";

// The declared type says content is ContentBlock[]; omp can emit it as a bare
// string or omit it entirely, so build those runtime shapes via a cast.
const assistant = (content: unknown): OmpMessage =>
  ({ role: "assistant", content }) as unknown as OmpMessage;

describe("TranscriptView assistant content (AGE-689)", () => {
  it("renders an assistant message with undefined content without throwing", () => {
    expect(() =>
      render(<TranscriptView messages={[assistant(undefined)]} />),
    ).not.toThrow();
    // The assistant block still renders (its badge), just with no body.
    expect(screen.getByText("assistant")).toBeInTheDocument();
  });

  it("coerces a bare-string assistant content to rendered text", () => {
    render(<TranscriptView messages={[assistant("hello world")]} />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("renders array content blocks unchanged", () => {
    render(
      <TranscriptView
        messages={[assistant([{ type: "text", text: "block text" }])]}
      />,
    );
    expect(screen.getByText("block text")).toBeInTheDocument();
  });
});

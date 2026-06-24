// AGE-689 — normalizeMessageContent must coerce an assistant/toolResult message
// whose `content` is a bare string OR missing (undefined) into ContentBlock[],
// so the subagent pump + transcript never hit `content.map is not a function`.
// User and already-array content pass through unchanged.

import type { OmpMessage } from "@shared/rpc";
import { normalizeMessageContent } from "./session-reducer";

const msg = (role: string, content: unknown): OmpMessage =>
  ({ role, content }) as unknown as OmpMessage;

describe("normalizeMessageContent (AGE-689)", () => {
  it("coerces undefined assistant content to empty blocks", () => {
    expect(
      normalizeMessageContent(msg("assistant", undefined)).content,
    ).toEqual([]);
  });

  it("wraps a bare-string assistant content in a text block", () => {
    expect(normalizeMessageContent(msg("assistant", "hi")).content).toEqual([
      { type: "text", text: "hi" },
    ]);
  });

  it("coerces an empty string to empty blocks", () => {
    expect(normalizeMessageContent(msg("assistant", "")).content).toEqual([]);
  });

  it("leaves already-array content unchanged (same reference)", () => {
    const blocks = [{ type: "text", text: "x" }];
    expect(normalizeMessageContent(msg("assistant", blocks)).content).toBe(
      blocks,
    );
  });

  it("leaves user messages unchanged (string content is valid for users)", () => {
    const m = msg("user", "a question");
    expect(normalizeMessageContent(m)).toBe(m);
  });
});

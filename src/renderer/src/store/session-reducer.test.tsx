// AGE-696 — message content is normalized to ContentBlock[] at one shared choke
// point (toContentBlocks) applied at every store ingestion boundary, so the
// renderer can trust `OmpMessage.content`. normalizeMessageContent coerces ALL
// roles (incl. user); the reducer normalizes get_messages snapshots and
// optimistic user-message appends. Builds on AGE-689 (subagent-assistant case).

import type { OmpMessage, UserMessage } from "@shared/rpc";
import {
  createSession,
  normalizeMessageContent,
  reduceSession,
  sessionStatus,
  studioFrame,
  toContentBlocks,
} from "./session-reducer";

const msg = (role: string, content: unknown): OmpMessage =>
  ({ role, content }) as unknown as OmpMessage;

describe("toContentBlocks (AGE-696)", () => {
  it("returns the same array reference for already-array content", () => {
    const blocks = [{ type: "text", text: "x" }];
    expect(toContentBlocks(blocks)).toBe(blocks);
  });

  it("wraps a non-empty string in one text block", () => {
    expect(toContentBlocks("hi")).toEqual([{ type: "text", text: "hi" }]);
  });

  it("maps an empty string and undefined to no blocks", () => {
    expect(toContentBlocks("")).toEqual([]);
    expect(toContentBlocks(undefined)).toEqual([]);
  });
});

describe("normalizeMessageContent — all roles (AGE-696)", () => {
  it("coerces undefined content to [] for assistant, toolResult, AND user", () => {
    for (const role of ["assistant", "toolResult", "user"]) {
      expect(normalizeMessageContent(msg(role, undefined)).content).toEqual([]);
    }
  });

  it("wraps bare-string content in a text block for every role (incl. user)", () => {
    for (const role of ["assistant", "toolResult", "user"]) {
      expect(normalizeMessageContent(msg(role, "hi")).content).toEqual([
        { type: "text", text: "hi" },
      ]);
    }
  });

  it("returns the same message reference when content is already an array", () => {
    const m = msg("assistant", [{ type: "text", text: "x" }]);
    expect(normalizeMessageContent(m)).toBe(m);
  });
});

describe("reduceSession normalizes at the store boundary (AGE-696)", () => {
  it("normalizes every message in a get_messages snapshot, incl. undefined content", () => {
    const next = reduceSession(
      createSession("s"),
      studioFrame.messages([
        msg("user", "q"),
        msg("assistant", undefined),
        msg("toolResult", "out"),
      ]),
    );
    expect(next.messages.map((m) => m.content)).toEqual([
      [{ type: "text", text: "q" }],
      [],
      [{ type: "text", text: "out" }],
    ]);
  });

  it("normalizes an optimistically-appended user message", () => {
    const next = reduceSession(
      createSession("s"),
      studioFrame.userMessage({
        role: "user",
        content: "hello",
      } as UserMessage),
    );
    expect(next.messages.at(-1)?.content).toEqual([
      { type: "text", text: "hello" },
    ]);
  });
});

describe("sessionStatus — Live Dot triad (AGE-699)", () => {
  it("maps a live, streaming session to running", () => {
    expect(sessionStatus({ live: true, status: "streaming" })).toBe("running");
  });

  it("maps a live, non-streaming session to idle", () => {
    for (const status of ["idle", "spawning", "error", "exited"] as const) {
      expect(sessionStatus({ live: true, status })).toBe("idle");
    }
    // A live session with no status yet still reads as idle, not done.
    expect(sessionStatus({ live: true })).toBe("idle");
  });

  it("maps any session with no live child (hibernated/closed) to done", () => {
    expect(sessionStatus({ live: false })).toBe("done");
    // `live: false` wins even if a stale status is carried alongside.
    expect(sessionStatus({ live: false, status: "streaming" })).toBe("done");
  });
});

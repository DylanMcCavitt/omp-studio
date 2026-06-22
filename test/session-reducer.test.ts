import { expect, test } from "bun:test";
import {
  createSession,
  reduceSession,
  sessionFromState,
  studioFrame,
} from "../src/renderer/src/store/session-reducer";

// The reducer is pure and DOM-free, so we drive it with plain frame objects.
// `RpcFrame` is intentionally loose (`{ type: string; ... }`), so partial
// fixtures exercise exactly the fields each case reads.

// Minimal ChatUiRequestEvent fixture.
function ui(id: string, method = "confirm", sessionId = "s1") {
  return {
    sessionId,
    request: { type: "extension_ui_request", id, method },
    responseRequired: method !== "notify",
  } as never;
}

test("createSession produces a clean empty slice", () => {
  const s = createSession("s1");
  expect(s.sessionId).toBe("s1");
  expect(s.status).toBe("idle");
  expect(s.messages).toEqual([]);
  expect(s.subagents).toEqual([]);
  expect(s.todoPhases).toEqual([]);
  expect(s.availableCommands).toEqual([]);
  expect(s.uiRequests).toEqual([]);
  expect(s.thinkingLevel).toBe("medium");
  expect(s.model).toBeNull();
  expect(s.activeTool).toBeNull();
  expect(s.queuedCount).toBe(0);
});

test("agent_start / turn_start enter streaming and clear live buffers", () => {
  const s0 = {
    ...createSession("s1"),
    status: "idle" as const,
    liveText: "x",
    liveThinking: "y",
    activeTool: "read",
    error: "boom",
  };
  const s = reduceSession(s0, { type: "agent_start" });
  expect(s.status).toBe("streaming");
  expect(s.liveText).toBe("");
  expect(s.liveThinking).toBe("");
  expect(s.activeTool).toBeNull();
  expect(s.error).toBeUndefined();
  expect(reduceSession(s0, { type: "turn_start" }).status).toBe("streaming");
});

test("message_update accumulates text and thinking deltas", () => {
  let s = createSession("s1");
  s = reduceSession(s, {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "He" },
  });
  s = reduceSession(s, {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "llo" },
  });
  expect(s.liveText).toBe("Hello");
  s = reduceSession(s, {
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
  });
  expect(s.liveThinking).toBe("hmm");
  expect(s.liveText).toBe("Hello");
});

test("message_update upserts the trailing assistant snapshot", () => {
  let s = createSession("s1");
  const snap1 = { role: "assistant", content: [{ type: "text", text: "a" }] };
  s = reduceSession(s, {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "a" },
    message: snap1,
  });
  expect(s.messages).toHaveLength(1);
  const snap2 = { role: "assistant", content: [{ type: "text", text: "ab" }] };
  s = reduceSession(s, {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "b" },
    message: snap2,
  });
  expect(s.messages).toHaveLength(1);
  expect(s.messages[0]).toBe(snap2);
});

test("an assistant snapshot after a user message appends a new bubble", () => {
  let s = createSession("s1");
  s = reduceSession(
    s,
    studioFrame.userMessage({ role: "user", content: "hi" }),
  );
  const snap = { role: "assistant", content: [] };
  s = reduceSession(s, {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta" },
    message: snap,
  });
  expect(s.messages).toHaveLength(2);
  expect(s.messages[1]).toBe(snap);
});

test("tool execution sets and clears the active tool", () => {
  let s = createSession("s1");
  s = reduceSession(s, { type: "tool_execution_start", toolName: "bash" });
  expect(s.activeTool).toBe("bash");
  // Same tool on update → no state change (same reference).
  expect(
    reduceSession(s, { type: "tool_execution_update", toolName: "bash" }),
  ).toBe(s);
  s = reduceSession(s, { type: "tool_execution_end" });
  expect(s.activeTool).toBeNull();
  // Already cleared → no-op.
  expect(reduceSession(s, { type: "tool_execution_end" })).toBe(s);
});

test("agent_end / turn_end return to idle and clear live state", () => {
  const s0 = {
    ...createSession("s1"),
    status: "streaming" as const,
    liveText: "x",
    liveThinking: "y",
    activeTool: "read",
  };
  const s = reduceSession(s0, { type: "agent_end", messages: [] });
  expect(s.status).toBe("idle");
  expect(s.liveText).toBe("");
  expect(s.liveThinking).toBe("");
  expect(s.activeTool).toBeNull();
  expect(reduceSession(s0, { type: "turn_end" }).status).toBe("idle");
});

test("available_commands_update stores advertised commands", () => {
  const commands = [{ name: "/compact" }, { name: "/export" }];
  const s = reduceSession(createSession("s1"), {
    type: "available_commands_update",
    commands,
  });
  expect(s.availableCommands).toBe(commands);
  // Missing commands array → no-op.
  expect(
    reduceSession(createSession("s1"), { type: "available_commands_update" })
      .availableCommands,
  ).toEqual([]);
});

test("a get_state snapshot applies context, todos, model, thinking, and queue", () => {
  const rpc = {
    model: { provider: "anthropic", id: "opus" },
    thinkingLevel: "high",
    todoPhases: [{ id: "p1", name: "Plan", tasks: [] }],
    contextUsage: { tokens: 10, contextWindow: 100, percent: 10 },
    queuedMessageCount: 2,
  } as never;
  const s = reduceSession(createSession("s1"), studioFrame.state(rpc));
  expect(s.model).toEqual({ provider: "anthropic", id: "opus" });
  expect(s.thinkingLevel).toBe("high");
  expect(s.todoPhases).toHaveLength(1);
  expect(s.contextUsage).toEqual({
    tokens: 10,
    contextWindow: 100,
    percent: 10,
  });
  expect(s.queuedCount).toBe(2);
});

test("a subagents snapshot replaces the roster", () => {
  const subs = [{ id: "a1", status: "running" }] as never;
  const s = reduceSession(createSession("s1"), studioFrame.subagents(subs));
  expect(s.subagents).toBe(subs);
});

test("a messages snapshot replaces the transcript", () => {
  const msgs = [
    { role: "user", content: "hi" },
    { role: "assistant", content: [] },
  ] as never;
  const s = reduceSession(createSession("s1"), studioFrame.messages(msgs));
  expect(s.messages).toBe(msgs);
});

test("an optimistic user message is appended", () => {
  const u = { role: "user", content: "hey" } as never;
  const s = reduceSession(createSession("s1"), studioFrame.userMessage(u));
  expect(s.messages).toEqual([u]);
});

test("ui-request enqueue adds and dedupes by request id", () => {
  let s = createSession("s1");
  s = reduceSession(s, studioFrame.uiRequest(ui("r1", "confirm")));
  expect(s.uiRequests).toHaveLength(1);
  s = reduceSession(s, studioFrame.uiRequest(ui("r2", "input")));
  expect(s.uiRequests).toHaveLength(2);
  // Re-delivering r1 dedupes (still 2) and moves it to the tail.
  s = reduceSession(s, studioFrame.uiRequest(ui("r1", "confirm")));
  expect(s.uiRequests).toHaveLength(2);
  expect(s.uiRequests.map((u) => u.request.id)).toEqual(["r2", "r1"]);
});

test("ui-request resolve removes the matching request", () => {
  let s = createSession("s1");
  s = reduceSession(s, studioFrame.uiRequest(ui("r1")));
  s = reduceSession(s, studioFrame.uiRequest(ui("r2")));
  s = reduceSession(s, studioFrame.uiResolved("r1"));
  expect(s.uiRequests.map((u) => u.request.id)).toEqual(["r2"]);
  // Unknown id → no-op (same reference).
  expect(reduceSession(s, studioFrame.uiResolved("nope"))).toBe(s);
});

test("signal-only and unknown frames are no-ops", () => {
  const s = createSession("s1");
  expect(reduceSession(s, { type: "todo_reminder" })).toBe(s);
  expect(reduceSession(s, { type: "todo_auto_clear" })).toBe(s);
  expect(reduceSession(s, { type: "subagent_lifecycle", id: "x" })).toBe(s);
  expect(reduceSession(s, { type: "message_start" })).toBe(s);
  expect(reduceSession(s, { type: "totally_unknown" })).toBe(s);
});

test("reducing one session never mutates a sibling session", () => {
  const a0 = createSession("a");
  const b0 = createSession("b");
  const a1 = reduceSession(a0, { type: "agent_start" });
  expect(a1).not.toBe(a0);
  expect(a0.status).toBe("idle"); // original untouched
  expect(b0.status).toBe("idle"); // sibling untouched
  expect(b0.messages).not.toBe(a0.messages); // independent arrays
});

test("reduceSession does not mutate its input", () => {
  const s0 = createSession("s1");
  const before = JSON.stringify(s0);
  reduceSession(s0, {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "abc" },
    message: { role: "assistant", content: [] },
  });
  reduceSession(s0, studioFrame.uiRequest(ui("r1")));
  expect(JSON.stringify(s0)).toBe(before);
});

test("sessionFromState seeds status and fields from a get_state snapshot", () => {
  const s = sessionFromState("s1", {
    isStreaming: true,
    model: { provider: "x", id: "y" },
    thinkingLevel: "low",
    todoPhases: [],
    queuedMessageCount: 0,
    contextUsage: { tokens: 1, contextWindow: 2, percent: 50 },
  } as never);
  expect(s.sessionId).toBe("s1");
  expect(s.status).toBe("streaming");
  expect(s.thinkingLevel).toBe("low");
  expect(s.contextUsage?.percent).toBe(50);
});

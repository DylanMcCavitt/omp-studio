import { expect, test } from "bun:test";
import {
  createSession,
  reduceSession,
} from "../src/renderer/src/store/session-reducer";
import type { AgentProgress } from "../src/shared/rpc";

// Feature 4: the reducer reads the NESTED `frame.payload.*` of subagent_progress
// / subagent_event into `subagentEvents` (keyed by subagent id) with a capped
// event buffer. The reducer is pure and DOM-free, so plain frame objects drive
// it (RpcFrame is intentionally loose).

function progress(
  id: string,
  over: Partial<AgentProgress> = {},
): AgentProgress {
  return {
    index: 0,
    id,
    agent: "task",
    agentSource: "bundled",
    status: "running",
    task: "do the thing",
    recentTools: [],
    recentOutput: [],
    toolCount: 0,
    requests: 0,
    tokens: 0,
    ...over,
  };
}

test("createSession starts with an empty subagentEvents map", () => {
  expect(createSession("s1").subagentEvents).toEqual({});
});

test("subagent_progress stores the NESTED payload.progress per subagent id", () => {
  let s = createSession("s1");
  s = reduceSession(s, {
    type: "subagent_progress",
    payload: {
      index: 0,
      agent: "task",
      agentSource: "bundled",
      task: "t",
      progress: progress("a", { toolCount: 3, tokens: 42 }),
    },
  });
  expect(s.subagentEvents.a?.progress?.toolCount).toBe(3);
  expect(s.subagentEvents.a?.progress?.tokens).toBe(42);
  expect(s.subagentEvents.a?.events).toEqual([]);
});

test("subagent_progress overwrites the latest snapshot but keeps the event buffer", () => {
  let s = createSession("s1");
  s = reduceSession(s, {
    type: "subagent_event",
    payload: {
      id: "a",
      event: { type: "tool_execution_start", toolName: "read" },
    },
  });
  s = reduceSession(s, {
    type: "subagent_progress",
    payload: { progress: progress("a", { tokens: 100 }) },
  });
  s = reduceSession(s, {
    type: "subagent_progress",
    payload: { progress: progress("a", { tokens: 250 }) },
  });
  expect(s.subagentEvents.a?.progress?.tokens).toBe(250);
  expect(s.subagentEvents.a?.events).toHaveLength(1);
});

test("subagent_event appends NESTED payload.event into per-id buffers", () => {
  let s = createSession("s1");
  s = reduceSession(s, {
    type: "subagent_event",
    payload: { id: "a", event: { type: "turn_start" } },
  });
  s = reduceSession(s, {
    type: "subagent_event",
    payload: { id: "a", event: { type: "turn_end" } },
  });
  s = reduceSession(s, {
    type: "subagent_event",
    payload: { id: "b", event: { type: "agent_start" } },
  });
  expect(s.subagentEvents.a?.events.map((e) => e.type)).toEqual([
    "turn_start",
    "turn_end",
  ]);
  expect(s.subagentEvents.b?.events.map((e) => e.type)).toEqual([
    "agent_start",
  ]);
});

test("subagent_event caps the buffer at 200, dropping the oldest", () => {
  let s = createSession("s1");
  for (let i = 0; i < 250; i++) {
    s = reduceSession(s, {
      type: "subagent_event",
      payload: { id: "a", event: { type: "tick", seq: i } },
    });
  }
  const events = s.subagentEvents.a?.events ?? [];
  expect(events).toHaveLength(200);
  // The first 50 (seq 0..49) were evicted; the window is seq 50..249.
  expect((events[0] as { seq: number }).seq).toBe(50);
  expect((events[199] as { seq: number }).seq).toBe(249);
});

test("malformed subagent frames are no-ops (same reference)", () => {
  const s = createSession("s1");
  // progress with no progress.id
  expect(reduceSession(s, { type: "subagent_progress", payload: {} })).toBe(s);
  // event with no event payload
  expect(
    reduceSession(s, { type: "subagent_event", payload: { id: "a" } }),
  ).toBe(s);
  // event with no id
  expect(
    reduceSession(s, {
      type: "subagent_event",
      payload: { event: { type: "x" } },
    }),
  ).toBe(s);
});

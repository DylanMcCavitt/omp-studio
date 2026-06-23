// Feature 4 — the subagent drill-in inspector's degrade matrix:
//   - no sessionFile        → progress-only, explicit "not available yet"
//   - completed + file      → readSession() once; empty/unreadable → EmptyState
//   - live + file           → chat.getSubagentMessages cursor, appended on frame
//   - "Open in Sessions"    → focusSession with the absolute file
// Assertions go through visible copy and store state, never styling.

import type { OmpApi } from "@shared/ipc";
import type { AgentProgress, SubagentSnapshot } from "@shared/rpc";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "@/store/app";
import { useChatStore } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";
import { useShellStore } from "@/store/shell";
import { SubagentInspector } from "./SubagentInspector";

function snap(over: Partial<SubagentSnapshot> = {}): SubagentSnapshot {
  return {
    id: "a1",
    index: 0,
    agent: "task",
    agentSource: "bundled",
    status: "running",
    lastUpdate: 0,
    ...over,
  };
}

function prog(over: Partial<AgentProgress> = {}): AgentProgress {
  return {
    index: 0,
    id: "a1",
    agent: "task",
    agentSource: "bundled",
    status: "running",
    task: "build the thing",
    recentTools: [],
    recentOutput: [],
    toolCount: 4,
    requests: 2,
    tokens: 1234,
    ...over,
  };
}

function stubBridge(overrides: Partial<OmpApi>) {
  Object.assign(window.omp, overrides);
}

beforeEach(() => {
  window.omp = { chat: {} } as unknown as OmpApi;
  useChatStore.setState({
    _subagentInspector: null,
    openSessions: {},
    activeSessionId: null,
  });
  useAppStore.setState({ route: "dashboard", sessionFocus: null });
  useShellStore.setState({ openPanelId: null });
  // Stub the debounced layout persist so setOpenPanel never schedules a real IPC.
  useSettingsStore.setState({ setLayout: vi.fn() });
});

it("with no sessionFile shows progress-only and no transcript pane", () => {
  render(
    <SubagentInspector
      sessionId="s1"
      subagent={snap({
        sessionFile: undefined,
        progress: prog({ lastIntent: "Reading files" }),
      })}
      onBack={vi.fn()}
    />,
  );
  expect(screen.getByText("Transcript not available yet")).toBeInTheDocument();
  // The progress ticker still renders from the snapshot's AgentProgress.
  expect(screen.getByText("Reading files")).toBeInTheDocument();
});

it("reads a completed subagent's transcript via readSession", async () => {
  stubBridge({
    readSession: vi.fn().mockResolvedValue({
      summary: {},
      messages: [{ role: "user", content: "hello from child" }],
    }),
  } as unknown as Partial<OmpApi>);
  render(
    <SubagentInspector
      sessionId="s1"
      subagent={snap({ status: "completed", sessionFile: "/abs/a.jsonl" })}
      onBack={vi.fn()}
    />,
  );
  expect(await screen.findByText("hello from child")).toBeInTheDocument();
  expect(window.omp.readSession).toHaveBeenCalledWith("/abs/a.jsonl");
});

it("degrades a completed subagent with an empty/unreadable transcript to an empty state", async () => {
  stubBridge({
    readSession: vi.fn().mockResolvedValue({ summary: {}, messages: [] }),
  } as unknown as Partial<OmpApi>);
  render(
    <SubagentInspector
      sessionId="s1"
      subagent={snap({ status: "failed", sessionFile: "/abs/gone.jsonl" })}
      onBack={vi.fn()}
    />,
  );
  expect(await screen.findByText("Transcript unavailable")).toBeInTheDocument();
});

it("pumps a live subagent's transcript and advances the cursor", async () => {
  const getSubagentMessages = vi.fn().mockResolvedValue({
    sessionFile: "/abs/a.jsonl",
    fromByte: 0,
    nextByte: 128,
    reset: false,
    entries: [],
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: "live progress tick" }],
      },
    ],
  });
  stubBridge({ chat: { getSubagentMessages } } as unknown as Partial<OmpApi>);
  render(
    <SubagentInspector
      sessionId="s1"
      subagent={snap({ status: "running", sessionFile: "/abs/a.jsonl" })}
      onBack={vi.fn()}
    />,
  );
  expect(await screen.findByText("live progress tick")).toBeInTheDocument();
  expect(getSubagentMessages).toHaveBeenCalledWith("s1", {
    sessionFile: "/abs/a.jsonl",
    fromByte: 0,
  });
  expect(useChatStore.getState()._subagentInspector?.cursor).toBe(128);
});

it("Open in Sessions focuses the subagent's transcript file", async () => {
  const user = userEvent.setup();
  stubBridge({
    readSession: vi.fn().mockResolvedValue({ summary: {}, messages: [] }),
  } as unknown as Partial<OmpApi>);
  render(
    <SubagentInspector
      sessionId="s1"
      subagent={snap({ status: "completed", sessionFile: "/abs/a.jsonl" })}
      onBack={vi.fn()}
    />,
  );
  await user.click(screen.getByLabelText("Open in Sessions"));
  expect(useShellStore.getState().openPanelId).toBe("sessions");
  expect(useAppStore.getState().sessionFocus).toEqual({
    path: "/abs/a.jsonl",
    messageIndex: -1,
  });
});

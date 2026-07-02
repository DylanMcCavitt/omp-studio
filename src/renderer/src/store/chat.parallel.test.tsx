// AGE-779 — dropped-agent parallel routing uses the chat store's real spawn
// path, but must not steal the current chat view. These tests exercise the store
// boundary directly: create options, activation opt-out, no-workspace fallback,
// create failure, and first-prompt behavior.

import type { OmpApi, StudioSettings } from "@shared/ipc";
import { useAppStore } from "@/store/app";
import { useApprovalStore } from "@/store/approvals";
import { useChatStore } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";

const PRISTINE_CHAT = useChatStore.getState();
const PRISTINE_APP = useAppStore.getState();
const PRISTINE_SETTINGS = useSettingsStore.getState();

const SETTINGS: StudioSettings = {
  version: 2,
  theme: "system",
  defaultProject: null,
  defaultModel: "openai/gpt-5.5",
  defaultThinkingLevel: "high",
  defaultApprovalMode: "write",
  defaultAutoApprove: true,
  liveSessionLimit: 4,
  recentProjects: [],
  openSessions: [],
  workspaces: [],
};

function rpcState() {
  return {
    model: null,
    thinkingLevel: "high",
    isStreaming: false,
    isCompacting: false,
    steeringMode: "all",
    followUpMode: "all",
    interruptMode: "immediate",
    autoCompactionEnabled: false,
    messageCount: 0,
    queuedMessageCount: 0,
    todoPhases: [],
  } as never;
}

function stubBridge(
  overrides: Partial<{
    create: OmpApi["chat"]["create"];
    prompt: OmpApi["chat"]["prompt"];
  }> = {},
) {
  const settingsUpdate = vi.fn(async (patch: Partial<StudioSettings>) => ({
    ...SETTINGS,
    ...patch,
  }));
  Object.assign(window.omp, {
    settings: {
      ...window.omp.settings,
      update: settingsUpdate,
    },
    chat: {
      ...window.omp.chat,
      onEvent: vi.fn(() => vi.fn()),
      onLifecycle: vi.fn(() => vi.fn()),
      onUiRequest: vi.fn(() => vi.fn()),
      create:
        overrides.create ??
        vi.fn(async () => ({ sessionId: "new-session", state: rpcState() })),
      prompt: overrides.prompt ?? vi.fn().mockResolvedValue(undefined),
      getMessages: vi.fn(async () => []),
      getSubagents: vi.fn(async () => []),
      getSessionStats: vi.fn(async () => ({})),
    },
  } as unknown as Partial<OmpApi>);
  return {
    settingsUpdate,
    chat: window.omp.chat,
  };
}

beforeEach(() => {
  useChatStore.getState().teardown();
  useChatStore.setState(
    {
      ...PRISTINE_CHAT,
      openSessions: {},
      sessionSummaries: {},
      hibernatedSessions: {},
      activeSessionId: "current-session",
      createError: undefined,
      creating: false,
      _unsub: null,
    },
    true,
  );
  useAppStore.setState(
    { ...PRISTINE_APP, selectedProject: null, route: "dashboard" },
    true,
  );
  useSettingsStore.setState({ ...PRISTINE_SETTINGS, settings: SETTINGS }, true);
  useApprovalStore.setState({ policies: {}, rulesBySession: {} });
  stubBridge();
});

it("start can register a new session without activating it", async () => {
  const bridge = stubBridge();

  const id = await useChatStore
    .getState()
    .start({ cwd: "/repo", model: "openai/gpt-5.5" }, { activate: false });

  expect(id).toBe("new-session");
  expect(useChatStore.getState().activeSessionId).toBe("current-session");
  expect(useAppStore.getState().route).toBe("dashboard");
  expect(useChatStore.getState().openSessions["new-session"]?.cwd).toBe(
    "/repo",
  );
  expect(bridge.chat.create).toHaveBeenCalledWith({
    cwd: "/repo",
    model: "openai/gpt-5.5",
  });
});

it("start returns null and records createError when spawn fails", async () => {
  stubBridge({
    create: vi.fn(async () => {
      throw new Error("spawn failed");
    }),
  });

  const id = await useChatStore
    .getState()
    .start({ cwd: "/repo" }, { activate: false });

  expect(id).toBeNull();
  expect(useChatStore.getState().createError).toBe("spawn failed");
  expect(useChatStore.getState().activeSessionId).toBe("current-session");
});

it("startParallelChat spawns with defaults, stays inactive, and sends the preview prompt", async () => {
  const bridge = stubBridge();

  const id = await useChatStore
    .getState()
    .startParallelChat("Use the `planner` agent.", { cwd: "/repo" });

  expect(id).toBe("new-session");
  expect(bridge.chat.create).toHaveBeenCalledWith({
    cwd: "/repo",
    model: "openai/gpt-5.5",
    thinkingLevel: "high",
    approvalPolicy: { mode: "write", autoApprove: true },
  });
  expect(bridge.chat.prompt).toHaveBeenCalledWith(
    "new-session",
    "Use the `planner` agent.",
    undefined,
  );
  expect(useChatStore.getState().activeSessionId).toBe("current-session");
  expect(useAppStore.getState().route).toBe("dashboard");
  expect(useChatStore.getState().openSessions["new-session"]?.cwd).toBe(
    "/repo",
  );
});

it("startParallelChat falls back to selected/default workspace when cwd is omitted", async () => {
  const bridge = stubBridge();
  useAppStore.setState({ selectedProject: "/selected" });

  const id = await useChatStore.getState().startParallelChat("parallel prompt");
  expect(id).toBe("new-session");
  expect(bridge.chat.create).toHaveBeenCalledWith(
    expect.objectContaining({ cwd: "/selected" }),
  );
});

it("startParallelChat returns null without a resolvable workspace", async () => {
  const bridge = stubBridge();
  useSettingsStore.setState({
    settings: { ...SETTINGS, defaultProject: null },
  });
  useAppStore.setState({ selectedProject: null });

  const id = await useChatStore.getState().startParallelChat("parallel prompt");

  expect(id).toBeNull();
  expect(bridge.chat.create).not.toHaveBeenCalled();
  expect(bridge.chat.prompt).not.toHaveBeenCalled();
});

it("startParallelChat keeps the spawned row visible when the first prompt fails", async () => {
  const bridge = stubBridge({
    prompt: vi.fn(async () => {
      throw new Error("prompt failed");
    }),
  });

  const id = await useChatStore
    .getState()
    .startParallelChat("first prompt", { cwd: "/repo" });

  expect(id).toBe("new-session");
  expect(bridge.chat.prompt).toHaveBeenCalledWith(
    "new-session",
    "first prompt",
    undefined,
  );
  expect(useChatStore.getState().openSessions["new-session"]?.error).toBe(
    "prompt failed",
  );
});

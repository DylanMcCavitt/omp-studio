import type { OmpApi, StudioSettings } from "@shared/ipc";
import type { OmpMessage, RpcFrame, RpcState } from "@shared/rpc";
import { useAppStore } from "@/store/app";
import { useApprovalStore } from "@/store/approvals";
import { useChatStore } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";

const PRISTINE_APP = useAppStore.getState();
const PRISTINE_APPROVALS = useApprovalStore.getState();
const PRISTINE_CHAT = useChatStore.getState();
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

function rpcState(overrides: Partial<RpcState> = {}): RpcState {
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
    ...overrides,
  } as RpcState;
}

function assistantMessage(text: string): OmpMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: 1,
  } as unknown as OmpMessage;
}

function stubBridge(
  overrides: Partial<{
    create: OmpApi["chat"]["create"];
    getMessages: OmpApi["chat"]["getMessages"];
  }> = {},
) {
  let created = 0;
  const create =
    overrides.create ??
    vi.fn(async (opts) => {
      created += 1;
      return {
        sessionId: `session-${created}`,
        state: rpcState({ sessionName: opts.cwd }),
      };
    });
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
      create,
      close: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockResolvedValue(undefined),
      getMessages: overrides.getMessages ?? vi.fn(async () => []),
      getState: vi.fn(async () => rpcState()),
      getSubagents: vi.fn(async () => []),
      getSessionStats: vi.fn(async () => ({})),
      respondUiRequest: vi.fn().mockResolvedValue(undefined),
    },
  } as Partial<OmpApi>);
  return window.omp.chat;
}

beforeEach(() => {
  useChatStore.getState().teardown();
  useChatStore.setState(
    {
      ...PRISTINE_CHAT,
      openSessions: {},
      sessionSummaries: {},
      hibernatedSessions: {},
      activeSessionId: null,
      createError: undefined,
      creating: false,
      _unsub: null,
      inspectedSubagent: null,
      _subagentInspector: null,
    },
    true,
  );
  useAppStore.setState({ ...PRISTINE_APP, selectedProject: null, route: "dashboard" }, true);
  useSettingsStore.setState({ ...PRISTINE_SETTINGS, settings: SETTINGS }, true);
  useApprovalStore.setState({ ...PRISTINE_APPROVALS, policies: {}, rulesBySession: {} }, true);
  stubBridge();
});

it("creates, selects, and closes sessions without leaving a stale active id", async () => {
  const chat = stubBridge();

  const first = await useChatStore.getState().start({ cwd: "/repo/one" });
  const second = await useChatStore.getState().start({ cwd: "/repo/two" });

  expect(first).toBe("session-1");
  expect(second).toBe("session-2");
  expect(useAppStore.getState().route).toBe("chat");
  expect(useChatStore.getState().activeSessionId).toBe("session-2");
  expect(Object.keys(useChatStore.getState().openSessions)).toEqual(["session-1", "session-2"]);

  await useChatStore.getState().closeSession("session-2");

  expect(chat.close).toHaveBeenCalledWith("session-2");
  expect(useChatStore.getState().openSessions["session-2"]).toBeUndefined();
  expect(useChatStore.getState().activeSessionId).toBe("session-1");
  expect(useChatStore.getState().sessionSummaries["session-2"]).toBeUndefined();

  await useChatStore.getState().closeSession("session-1");

  expect(useChatStore.getState().openSessions).toEqual({});
  expect(useChatStore.getState().activeSessionId).toBeNull();
});

it("reduces streaming assistant updates into one transcript row while preserving live text", async () => {
  await useChatStore.getState().openSession("streaming-session", rpcState());

  useChatStore.getState()._handleFrame("streaming-session", { type: "turn_start" } as RpcFrame);
  useChatStore.getState()._handleFrame("streaming-session", {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "Hel" },
    message: assistantMessage("Hel"),
  } as RpcFrame);
  useChatStore.getState()._handleFrame("streaming-session", {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "lo" },
    message: assistantMessage("Hello"),
  } as RpcFrame);

  const session = useChatStore.getState().openSessions["streaming-session"];
  expect(session?.status).toBe("streaming");
  expect(session?.liveText).toBe("Hello");
  expect(session?.messages).toHaveLength(1);
  expect(session?.messages[0]?.role).toBe("assistant");
  expect(session?.messages[0]?.content).toEqual([{ type: "text", text: "Hello" }]);
});

it("routes approval requests to the addressed session and resolves only that queue", async () => {
  const chat = stubBridge();
  await useChatStore.getState().openSession("session-a", rpcState());
  await useChatStore.getState().openSession("session-b", rpcState());

  useChatStore.getState()._handleUiRequest({
    sessionId: "session-b",
    responseRequired: true,
    request: {
      type: "extension_ui_request",
      id: "approval-1",
      method: "confirm",
      message: "Allow write?",
    },
  });

  expect(useChatStore.getState().openSessions["session-a"]?.uiRequests).toEqual([]);
  expect(useChatStore.getState().openSessions["session-b"]?.uiRequests).toHaveLength(1);
  expect(useChatStore.getState().openSessions["session-b"]?.uiRequests[0]?.request.id).toBe("approval-1");

  await useChatStore.getState().respondUi({
    sessionId: "session-b",
    requestId: "approval-1",
    response: { confirmed: true },
  });

  expect(chat.respondUiRequest).toHaveBeenCalledWith({
    sessionId: "session-b",
    requestId: "approval-1",
    response: { confirmed: true },
  });
  expect(useChatStore.getState().openSessions["session-a"]?.uiRequests).toEqual([]);
  expect(useChatStore.getState().openSessions["session-b"]?.uiRequests).toEqual([]);
});

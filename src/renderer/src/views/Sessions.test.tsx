import type { SessionSearchHit, SessionSummary, SessionTranscript } from "@shared/domain";
import type { OmpApi } from "@shared/ipc";
import type { OmpMessage } from "@shared/rpc";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "@/store/app";
import { useChatStore } from "@/store/chat";
import Sessions from "./Sessions";

const PRISTINE_APP = useAppStore.getState();
const PRISTINE_CHAT = useChatStore.getState();

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: overrides.id ?? "session-a",
    path: overrides.path ?? "/sessions/alpha.jsonl",
    project: overrides.project ?? "alpha",
    cwd: overrides.cwd ?? "/repo/alpha",
    title: overrides.title ?? "Alpha refactor",
    createdAt: overrides.createdAt ?? "2026-07-01T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-02T10:00:00.000Z",
    messageCount: overrides.messageCount ?? 2,
    model: overrides.model ?? "openai/gpt-5.5",
    sizeBytes: overrides.sizeBytes ?? 2048,
    archived: overrides.archived,
  };
}

function message(role: "user" | "assistant", text: string): OmpMessage {
  return { role, content: text, timestamp: 1 } as unknown as OmpMessage;
}

function transcript(s: SessionSummary, text: string): SessionTranscript {
  return {
    summary: s,
    messages: [message("user", `Question about ${s.title}`), message("assistant", text)],
  };
}

function installBridge(options: {
  sessions?: SessionSummary[];
  transcripts?: Record<string, SessionTranscript>;
  searchHits?: SessionSearchHit[];
} = {}) {
  const sessions = options.sessions ?? [];
  const transcripts = options.transcripts ?? {};
  Object.assign(window.omp, {
    listSessions: vi.fn(async () => sessions),
    searchSessions: vi.fn(async () => options.searchHits ?? []),
    readSession: vi.fn(async (path: string): Promise<SessionTranscript> => {
      const t = transcripts[path];
      if (!t) throw new Error(`missing transcript fixture: ${path}`);
      return t;
    }),
    session: {
      reveal: vi.fn().mockResolvedValue(undefined),
      exportHtml: vi.fn().mockResolvedValue("/tmp/exported.html"),
      rename: vi.fn().mockResolvedValue(undefined),
      archive: vi.fn().mockResolvedValue(undefined),
      unarchive: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  } satisfies Partial<OmpApi>);
  return window.omp as OmpApi;
}

beforeEach(() => {
  vi.useRealTimers();
  useAppStore.setState({ ...PRISTINE_APP, sessionFocus: null, route: "dashboard" }, true);
  useChatStore.setState(
    {
      ...PRISTINE_CHAT,
      openSessions: {},
      sessionSummaries: {},
      hibernatedSessions: {},
      activeSessionId: null,
      newChat: vi.fn(),
    },
    true,
  );
  installBridge();
});

afterEach(() => {
  vi.useRealTimers();
});

it("shows the empty state and starts a new chat from its call to action", async () => {
  installBridge({ sessions: [] });
  const user = userEvent.setup();

  render(<Sessions />);

  expect(await screen.findByText("No sessions yet")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Start a chat" }));

  expect(useChatStore.getState().newChat).toHaveBeenCalledTimes(1);
});

it("opens a selected historical session and renders its transcript", async () => {
  const alpha = summary({
    id: "alpha",
    path: "/sessions/alpha.jsonl",
    project: "alpha-project",
    title: "Alpha refactor",
  });
  const beta = summary({
    id: "beta",
    path: "/sessions/beta.jsonl",
    project: "beta-project",
    title: "Beta cleanup",
    updatedAt: "2026-07-03T10:00:00.000Z",
  });
  const bridge = installBridge({
    sessions: [alpha, beta],
    transcripts: {
      [alpha.path]: transcript(alpha, "Alpha transcript replayed from disk"),
      [beta.path]: transcript(beta, "Beta transcript replayed from disk"),
    },
  });
  const user = userEvent.setup();

  render(<Sessions />);

  expect(await screen.findByText("alpha-project")).toBeInTheDocument();
  expect(screen.getByText("beta-project")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Alpha refactor/ }));

  expect(await screen.findByText("Alpha transcript replayed from disk")).toBeInTheDocument();
  expect(bridge.readSession).toHaveBeenCalledWith(alpha.path);
  expect(screen.queryByText("Beta transcript replayed from disk")).not.toBeInTheDocument();
});

it("switches search mode to matching transcript hits and opens the clicked hit", async () => {
  const alpha = summary({ id: "alpha", path: "/sessions/alpha.jsonl", title: "Alpha refactor" });
  const beta = summary({
    id: "beta",
    path: "/sessions/beta.jsonl",
    title: "Token rotation fix",
    project: "security",
    updatedAt: "2026-07-03T10:00:00.000Z",
  });
  const hit: SessionSearchHit = {
    session: beta,
    messageIndex: 1,
    role: "assistant",
    snippet: "Rotate the token before retrying",
    ranges: [{ start: 11, end: 16 }],
    updatedAt: beta.updatedAt,
  };
  const bridge = installBridge({
    sessions: [alpha, beta],
    searchHits: [hit],
    transcripts: {
      [beta.path]: transcript(beta, "Token transcript opened at search hit"),
    },
  });
  const user = userEvent.setup();

  render(<Sessions />);
  expect(await screen.findByText("Alpha refactor")).toBeInTheDocument();

  vi.useFakeTimers();
  fireEvent.change(screen.getByPlaceholderText("Search transcripts"), {
    target: { value: "token" },
  });
  await act(async () => {
    vi.advanceTimersByTime(200);
    await Promise.resolve();
  });
  vi.useRealTimers();

  await waitFor(() =>
    expect(bridge.searchSessions).toHaveBeenCalledWith("token", {
      includeArchived: false,
    }),
  );
  expect(await screen.findByText("Token rotation fix")).toBeInTheDocument();
  expect(screen.queryByText("Alpha refactor")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /Rotate the token before retrying/ }));
  expect(await screen.findByText("Token transcript opened at search hit")).toBeInTheDocument();
  expect(bridge.readSession).toHaveBeenCalledWith(beta.path);
});

it("routes reveal and export actions for the selected session through the session bridge", async () => {
  const alpha = summary({ path: "/sessions/alpha.jsonl", title: "Alpha refactor" });
  const bridge = installBridge({
    sessions: [alpha],
    transcripts: { [alpha.path]: transcript(alpha, "Transcript body") },
  });
  const user = userEvent.setup();

  render(<Sessions />);
  await user.click(await screen.findByRole("button", { name: /Alpha refactor/ }));
  await screen.findByText("Transcript body");

  await user.click(screen.getByRole("button", { name: "Session actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Reveal in file manager" }));
  expect(bridge.session.reveal).toHaveBeenCalledWith(alpha.path);

  await user.click(screen.getByRole("button", { name: "Session actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Export HTML…" }));
  await waitFor(() => expect(bridge.session.exportHtml).toHaveBeenCalledWith(alpha.path));
  expect(bridge.session.reveal).toHaveBeenLastCalledWith("/tmp/exported.html");
});

it("routes rename, archive, and delete mutations and refreshes the Sessions view", async () => {
  const alpha = summary({ path: "/sessions/alpha.jsonl", title: "Alpha refactor" });
  const bridge = installBridge({
    sessions: [alpha],
    transcripts: { [alpha.path]: transcript(alpha, "Transcript body") },
  });
  const user = userEvent.setup();

  render(<Sessions />);
  await user.click(await screen.findByRole("button", { name: /Alpha refactor/ }));
  await screen.findByText("Transcript body");

  await user.click(screen.getByRole("button", { name: "Session actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Rename…" }));
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "  New alias  ");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(bridge.session.rename).toHaveBeenCalledWith(alpha.path, "New alias"));
  expect(bridge.listSessions).toHaveBeenCalledTimes(2);

  await user.click(screen.getByRole("button", { name: "Session actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Archive" }));
  await waitFor(() => expect(bridge.session.archive).toHaveBeenCalledWith(alpha.path));
  expect(await screen.findByText("Select a session")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /Alpha refactor/ }));
  await screen.findByText("Transcript body");
  await user.click(screen.getByRole("button", { name: "Session actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Delete…" }));
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(bridge.session.delete).toHaveBeenCalledWith(alpha.path));
  expect(await screen.findByText("Select a session")).toBeInTheDocument();
});

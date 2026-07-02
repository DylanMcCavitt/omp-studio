// AGE-606 — the Cmd+K overlay's deliberate empty/loading/error states. The
// transcript scan is debounced + async, so these assert the three states a user
// sees while it runs: an in-flight "Searching…" indicator, an explicit
// "No results for <query>" when the scan returns nothing, and an error notice
// (never a silent "no matches") when the scan rejects. Assertions go through
// visible text and the alert role, never styling.

import type { OmpApi } from "@shared/ipc";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "@/store/app";
import { useChatStore } from "@/store/chat";
import { useUiStore } from "@/store/ui";
import { GlobalSearch } from "./GlobalSearch";

vi.mock("@/lib/nav-registry", () => ({ RAIL_ENTRIES: [] }));

// A query that matches no nav route and no open session, so the result set is
// driven entirely by the (mocked) transcript scan.
const QUERY = "zqxwv";

function stubBridge(overrides: Partial<OmpApi>) {
  Object.assign(window.omp, overrides);
}

beforeEach(() => {
  useUiStore.setState({ searchOpen: true });
  useChatStore.setState({ openSessions: {}, sessionSummaries: {} });
  useAppStore.setState({ selectedProject: null });
});

it("shows summary-only live sessions before typing without transcript objects", async () => {
  const searchSessions = vi.fn().mockResolvedValue([]);
  stubBridge({ searchSessions });
  useChatStore.setState({
    openSessions: {},
    sessionSummaries: {
      s1: {
        sessionId: "s1",
        sessionName: "Release checklist",
        cwd: "/work/release",
        status: "streaming",
        lastActivityAt: 200,
      },
    },
  });

  render(<GlobalSearch />);
  expect(await screen.findByText("Live sessions")).toBeInTheDocument();
  expect(
    await screen.findByRole("option", { name: /Release checklist\s+live/i }),
  ).toBeInTheDocument();
  expect(searchSessions).not.toHaveBeenCalled();
});

it("shows a searching indicator while the transcript scan is in flight", async () => {
  const user = userEvent.setup();
  // Never resolves: the overlay stays in its loading state for the assertion.
  stubBridge({ searchSessions: vi.fn(() => new Promise<never>(() => {})) });
  render(<GlobalSearch />);

  await user.type(screen.getByLabelText("Search query"), QUERY);

  expect(await screen.findByText("Searching…")).toBeInTheDocument();
});

it("shows an explicit no-results message naming the query", async () => {
  const user = userEvent.setup();
  stubBridge({ searchSessions: vi.fn().mockResolvedValue([]) });
  render(<GlobalSearch />);

  await user.type(screen.getByLabelText("Search query"), QUERY);

  const empty = await screen.findByText(/No results for/);
  expect(empty).toHaveTextContent(QUERY);
});

it("surfaces a scan failure as an error instead of a silent no-results", async () => {
  const user = userEvent.setup();
  stubBridge({
    searchSessions: vi.fn().mockRejectedValue(new Error("index offline")),
  });
  render(<GlobalSearch />);

  await user.type(screen.getByLabelText("Search query"), QUERY);

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Transcript search failed");
  expect(alert).toHaveTextContent("index offline");
  // The failure must not also read as "no results".
  expect(screen.queryByText(/No results for/)).not.toBeInTheDocument();
});

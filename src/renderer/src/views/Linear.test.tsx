// AGE-623 — the Linear view. Two behaviors that matter: (1) with no validated
// key it degrades to the connect form and fires NO issue query; (2) once
// authenticated it renders the fetched issues and the client-side project filter
// narrows the rendered list without a refetch.

import type { LinearIssue, LinearStatusInfo } from "@shared/domain";
import type { OmpApi } from "@shared/ipc";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLinearStore } from "@/store/linear";
import Linear from "./Linear";

const UNAUTH: LinearStatusInfo = {
  status: "unauthenticated",
  writesEnabled: false,
};
const AUTHED: LinearStatusInfo = {
  status: "authenticated",
  writesEnabled: false,
  viewer: { id: "u1", name: "Ada" },
};

function issue(
  over: Partial<LinearIssue> & Pick<LinearIssue, "id" | "title">,
): LinearIssue {
  return {
    identifier: over.id.toUpperCase(),
    url: `https://linear.app/${over.id}`,
    state: { name: "Todo", type: "unstarted" },
    updatedAt: "2026-06-01T00:00:00.000Z",
    createdAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

function resetStore() {
  useLinearStore.setState({
    status: null,
    statusLoading: false,
    connecting: false,
    teams: [],
    projects: [],
    issues: [],
    loading: false,
    error: undefined,
  });
}

function stubLinear(over: Record<string, unknown>) {
  Object.assign(window.omp, {
    openExternal: vi.fn(),
    linear: {
      status: vi.fn().mockResolvedValue(UNAUTH),
      setApiKey: vi.fn().mockResolvedValue(AUTHED),
      clearApiKey: vi.fn().mockResolvedValue(undefined),
      listTeams: vi.fn().mockResolvedValue([]),
      listProjects: vi.fn().mockResolvedValue([]),
      listIssues: vi.fn().mockResolvedValue([]),
      getIssue: vi.fn().mockResolvedValue(null),
      ...over,
    },
  } as unknown as Partial<OmpApi>);
}

beforeEach(resetStore);

it("degrades to the connect form (and fires no issue query) when unauthenticated", async () => {
  stubLinear({ status: vi.fn().mockResolvedValue(UNAUTH) });

  render(<Linear />);

  expect(await screen.findByText("Connect Linear")).toBeInTheDocument();
  expect(screen.getByLabelText("Linear API key")).toBeInTheDocument();
  // No key → never query issues (or it would render a misleading empty list).
  expect(window.omp.linear.listIssues).not.toHaveBeenCalled();
});

it("renders fetched issues and narrows them with the project filter", async () => {
  const user = userEvent.setup();
  const issues = [
    issue({ id: "eng-1", title: "Fix login", project: { name: "Apollo" } }),
    issue({ id: "eng-2", title: "Add export", project: { name: "Zephyr" } }),
  ];
  stubLinear({
    status: vi.fn().mockResolvedValue(AUTHED),
    listTeams: vi
      .fn()
      .mockResolvedValue([{ id: "t1", key: "ENG", name: "Engineering" }]),
    listProjects: vi.fn().mockResolvedValue([
      { id: "p1", name: "Apollo" },
      { id: "p2", name: "Zephyr" },
    ]),
    listIssues: vi.fn().mockResolvedValue(issues),
  });

  render(<Linear />);

  // Both issues render once the key validates and the query resolves.
  expect(await screen.findByText("Fix login")).toBeInTheDocument();
  expect(screen.getByText("Add export")).toBeInTheDocument();

  // Pick "Apollo" in the project filter (client-side narrowing, no refetch).
  await user.click(screen.getByRole("combobox", { name: "Project filter" }));
  await user.click(await screen.findByRole("option", { name: "Apollo" }));

  expect(screen.getByText("Fix login")).toBeInTheDocument();
  expect(screen.queryByText("Add export")).not.toBeInTheDocument();
  // The filter is local: issues were fetched exactly once (initial load).
  expect(window.omp.linear.listIssues).toHaveBeenCalledTimes(1);
});

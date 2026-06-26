// AGE-623 — the Linear view. Two behaviors that matter: (1) with no validated
// key it degrades to the connect form and fires NO issue query; (2) once
// authenticated it renders the fetched issues and the client-side project filter
// narrows the rendered list without a refetch.

import type { LinearIssue, LinearStatusInfo } from "@shared/domain";
import type { OmpApi } from "@shared/ipc";
import { render, screen, within } from "@testing-library/react";
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

it("groups fetched issues by workflow state", async () => {
  const issues = [
    issue({ id: "age-1", title: "Plan next slice" }),
    issue({
      id: "age-2",
      title: "Ship panel",
      state: { name: "In Progress", type: "started" },
    }),
    issue({ id: "age-3", title: "Refine copy" }),
    issue({
      id: "age-4",
      title: "Merged slice",
      state: { name: "Done", type: "completed" },
    }),
  ];
  stubLinear({
    status: vi.fn().mockResolvedValue(AUTHED),
    listIssues: vi.fn().mockResolvedValue(issues),
  });

  render(<Linear />);

  const todoGroup = await screen.findByRole("region", { name: "Todo" });
  const runningGroup = screen.getByRole("region", { name: "In Progress" });
  const doneGroup = screen.getByRole("region", { name: "Done" });

  expect(within(todoGroup).getAllByRole("button")).toHaveLength(2);
  expect(within(todoGroup).getByText("Plan next slice")).toBeInTheDocument();
  expect(within(todoGroup).getByText("Refine copy")).toBeInTheDocument();
  expect(within(runningGroup).getByText("Ship panel")).toBeInTheDocument();
  expect(within(doneGroup).getByText("Merged slice")).toBeInTheDocument();
});

it("keeps narrow issue rows contained without crowding badges", async () => {
  const longTitle =
    "Add shared agent deterministic checkpoint title rendering without clipping adjacent state badges";
  stubLinear({
    status: vi.fn().mockResolvedValue(AUTHED),
    listIssues: vi.fn().mockResolvedValue([
      issue({
        id: "age-900",
        title: longTitle,
        priority: 1,
        state: {
          name: "Backlog With A Deliberately Long Workflow State Name",
          type: "backlog",
        },
        team: { key: "LOO" },
        project: { name: "Factory Nucleus With A Deliberately Long Name" },
        assignee: { name: "Ada Lovelace With A Deliberately Long Name" },
      }),
    ]),
  });

  render(<Linear />);

  const row = (await screen.findByText(longTitle)).closest("button");
  expect(row).not.toBeNull();
  expect((row as HTMLElement).className).toContain("min-w-0");
  expect((row as HTMLElement).className).toContain("overflow-hidden");
  const titleLine = (row as HTMLElement).firstElementChild as HTMLElement;
  const metadataLine = (row as HTMLElement).lastElementChild as HTMLElement;
  const title = within(row as HTMLElement).getByText(longTitle);
  expect(titleLine.className).toContain("items-start");
  expect(title.className).toContain("line-clamp-2");
  expect(title.className).toContain("[overflow-wrap:anywhere]");
  expect(metadataLine.className).toContain("min-w-0");
  expect(metadataLine.className).toContain("flex-wrap");
  expect(metadataLine.className).toContain("gap-y-1");
  expect(within(row as HTMLElement).getByText("Urgent").className).toContain(
    "shrink-0",
  );
  const stateBadge = within(row as HTMLElement).getByText(
    "Backlog With A Deliberately Long Workflow State Name",
  );
  expect(stateBadge.className).toContain("max-w-full");
  expect(stateBadge.className).toContain("shrink");
  expect(stateBadge.className).toContain("truncate");
  expect(within(row as HTMLElement).getByText("LOO").className).toContain(
    "shrink-0",
  );
  expect(
    within(row as HTMLElement).getByText(
      "Factory Nucleus With A Deliberately Long Name",
    ).className,
  ).toContain("truncate");
  expect(
    within(row as HTMLElement).getByText(
      "Ada Lovelace With A Deliberately Long Name",
    ).className,
  ).toContain("truncate");
});

it("renders Linear state dots in the live-dot language", async () => {
  const issues = [
    issue({
      id: "age-1",
      title: "Ship panel",
      state: { name: "In Progress", type: "started" },
    }),
    issue({ id: "age-2", title: "Plan next slice" }),
    issue({
      id: "age-3",
      title: "Merged slice",
      state: { name: "Done", type: "completed" },
    }),
  ];
  stubLinear({
    status: vi.fn().mockResolvedValue(AUTHED),
    listIssues: vi.fn().mockResolvedValue(issues),
  });

  render(<Linear />);

  const runningRow = (await screen.findByText("Ship panel")).closest("button");
  const todoRow = screen.getByText("Plan next slice").closest("button");
  const doneRow = screen.getByText("Merged slice").closest("button");
  expect(runningRow).not.toBeNull();
  expect(todoRow).not.toBeNull();
  expect(doneRow).not.toBeNull();

  const runningDot = (runningRow as HTMLElement).querySelector(
    '[data-state-dot="running"]',
  ) as HTMLElement;
  expect(runningDot).toHaveAttribute("data-state-dot", "running");
  expect(runningDot.className).toContain("animate-omp-pulse");
  expect(runningDot).toHaveStyle({ backgroundColor: "#f2c94c" });

  const todoDot = (todoRow as HTMLElement).querySelector(
    '[data-state-dot="todo"]',
  ) as HTMLElement;
  expect(todoDot).toHaveAttribute("data-state-dot", "todo");
  expect(todoDot.className).not.toContain("animate-omp-pulse");
  expect(todoDot).toHaveStyle({ boxShadow: "inset 0 0 0 1.5px #6c6c78" });

  const doneDot = (doneRow as HTMLElement).querySelector(
    '[data-state-dot="done"]',
  ) as HTMLElement;
  expect(doneDot).toHaveAttribute("data-state-dot", "done");
  expect(doneDot).toHaveStyle({ backgroundColor: "#5e6ad2" });
  expect(doneDot.querySelector("svg")).not.toBeNull();
});

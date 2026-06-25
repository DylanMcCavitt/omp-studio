// AGE-606 — the GitHub view's "needs a project" guidance. The Issues and PRs
// tabs are scoped to the selected project's repo, so with no project selected
// they must guide the user to pick one (a clear empty state) rather than fire a
// pointless query and render a misleading "No issues". With a project set they
// fall through to the normal (here empty) listing.

import type { OmpApi } from "@shared/ipc";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "@/store/app";
import GitHub, { languageDotColor } from "./GitHub";

function stubBridge(overrides: Partial<OmpApi>) {
  Object.assign(window.omp, overrides);
}

function githubStub(overrides: Record<string, unknown>) {
  stubBridge({
    openExternal: vi.fn(),
    pickDirectory: vi.fn().mockResolvedValue(null),
    github: {
      listRepos: vi.fn().mockResolvedValue([]),
      currentRepo: vi.fn().mockResolvedValue(null),
      listIssues: vi.fn().mockResolvedValue([]),
      listPullRequests: vi.fn().mockResolvedValue([]),
      ...overrides,
    },
  } as unknown as Partial<OmpApi>);
}

it("guides the user to pick a project on the Issues tab when none is selected", async () => {
  const user = userEvent.setup();
  useAppStore.setState({ selectedProject: null });
  githubStub({});
  render(<GitHub />);

  await user.click(screen.getByRole("button", { name: "Issues" }));

  expect(await screen.findByText("No project selected")).toBeInTheDocument();
  expect(screen.getByText(/its issues/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Choose project/ }),
  ).toBeInTheDocument();
  // No project → no pointless query, and never a misleading "No issues".
  expect(window.omp.github.listIssues).not.toHaveBeenCalled();
  expect(screen.queryByText("No issues")).not.toBeInTheDocument();
});

it("queries the selected project's issues once a project is chosen", async () => {
  const user = userEvent.setup();
  useAppStore.setState({ selectedProject: "/work/foo" });
  const listIssues = vi.fn().mockResolvedValue([]);
  githubStub({ listIssues });
  render(<GitHub />);

  await user.click(screen.getByRole("button", { name: "Issues" }));

  expect(await screen.findByText("No issues")).toBeInTheDocument();
  expect(listIssues).toHaveBeenCalledWith(undefined, "/work/foo");
  expect(screen.queryByText("No project selected")).not.toBeInTheDocument();
});

it("consolidates the empty repos view into one empty state with a next action", async () => {
  useAppStore.setState({ selectedProject: null });
  githubStub({}); // no current repo, no repos
  render(<GitHub />);

  // The body settles to one empty state carrying a clear next action…
  expect(await screen.findByText("No repositories")).toBeInTheDocument();
  // …and the header shows exactly one canonical title (rendered once
  // currentRepo resolves; until then it's a loading spinner).
  expect(
    await screen.findByRole("heading", { name: "GitHub", level: 1 }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Open GitHub/ }),
  ).toBeInTheDocument();
  // The old redundant header message is gone — no second "nothing here".
  expect(
    screen.queryByText("No repository detected in this directory"),
  ).not.toBeInTheDocument();
});

it("uses GitHub language colors for repository language dots", () => {
  expect(languageDotColor("TypeScript")).toBe("#3178c6");
  expect(languageDotColor("Rust")).toBe("#dea584");
  expect(languageDotColor("JavaScript")).toBe("#f1e05a");
  expect(languageDotColor("Python")).toBe("#3572A5");
  expect(languageDotColor("Unknown Thing")).toBe("#8b949e");
});

it("renders repo rows with language dots, stars, and relative age", async () => {
  const dateNow = vi
    .spyOn(Date, "now")
    .mockReturnValue(new Date("2026-06-25T12:00:00Z").getTime());
  try {
    useAppStore.setState({ selectedProject: null });
    githubStub({
      listRepos: vi.fn().mockResolvedValue([
        {
          nameWithOwner: "DylanMcCavitt/omp-studio",
          name: "omp-studio",
          description: "Desktop cockpit",
          isPrivate: false,
          url: "https://github.com/DylanMcCavitt/omp-studio",
          stargazerCount: 1234,
          updatedAt: "2026-06-11T12:00:00Z",
          primaryLanguage: "TypeScript",
        },
      ]),
    });

    render(<GitHub />);

    const name = await screen.findByText("DylanMcCavitt/omp-studio");
    const row = name.closest("button");
    expect(row).not.toBeNull();
    const rowQueries = within(row as HTMLElement);
    expect(rowQueries.getByText("public")).toBeInTheDocument();
    const language = rowQueries.getByText("TypeScript");
    expect(language.previousElementSibling).toHaveStyle(
      "background-color: rgb(49, 120, 198)",
    );
    expect(rowQueries.getByText("★ 1,234")).toBeInTheDocument();
    expect(rowQueries.getByText("2 weeks ago")).toBeInTheDocument();
  } finally {
    dateNow.mockRestore();
  }
});

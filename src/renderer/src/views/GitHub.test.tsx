// AGE-606 — the GitHub view's "needs a project" guidance. The Issues and PRs
// tabs are scoped to the selected project's repo, so with no project selected
// they must guide the user to pick one (a clear empty state) rather than fire a
// pointless query and render a misleading "No issues". With a project set they
// fall through to the normal (here empty) listing.

import type { OmpApi } from "@shared/ipc";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "@/store/app";
import GitHub from "./GitHub";

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

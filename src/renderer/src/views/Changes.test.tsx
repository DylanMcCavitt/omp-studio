// AGE-711 — the Changes view. Workspace-scoped, read-only local diffs. Covers:
// the "no workspace" guidance (and that no status query fires), the non-git
// notice, the clean-repo empty state, the changed-file list with status badges,
// drilling into a file diff with add/remove lines, and the reload action.

import type { ChangesStatus, FileDiff } from "@shared/domain";
import type { OmpApi } from "@shared/ipc";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "@/store/app";
import Changes from "./Changes";

const REPO_EMPTY: ChangesStatus = { repo: true, files: [] };

function stubChanges(
  status: () => Promise<ChangesStatus>,
  diff: () => Promise<FileDiff | null>,
): void {
  Object.assign(window.omp, {
    changes: { status, diff },
  } as unknown as Partial<OmpApi>);
}

beforeEach(() => {
  useAppStore.setState({ selectedProject: null });
});

it("guides the user to pick a workspace when none is selected", async () => {
  const status = vi.fn();
  stubChanges(status, vi.fn());
  render(<Changes />);

  expect(await screen.findByText("No workspace selected")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Choose project/ }),
  ).toBeInTheDocument();
  // No workspace -> no status query fires.
  expect(status).not.toHaveBeenCalled();
});

it("shows a notice when the workspace is not a git repository", async () => {
  useAppStore.setState({ selectedProject: "/work/foo" });
  const status = vi.fn().mockResolvedValue({ repo: false, files: [] });
  stubChanges(status, vi.fn());
  render(<Changes />);

  expect(await screen.findByText("Not a Git workspace")).toBeInTheDocument();
  expect(status).toHaveBeenCalledWith("/work/foo");
});

it("shows a clean state when a git workspace has no changes", async () => {
  useAppStore.setState({ selectedProject: "/work/foo" });
  const status = vi.fn().mockResolvedValue(REPO_EMPTY);
  stubChanges(status, vi.fn());
  render(<Changes />);

  expect(await screen.findByText("No uncommitted changes")).toBeInTheDocument();
});

it("lists changed files and drills into a file diff with add/remove lines", async () => {
  useAppStore.setState({ selectedProject: "/work/foo" });
  const status = vi.fn().mockResolvedValue({
    repo: true,
    files: [
      { relPath: "src/a.ts", status: "modified" },
      { relPath: "src/new.ts", status: "untracked" },
    ],
  } satisfies ChangesStatus);
  const diff = vi.fn().mockResolvedValue({
    relPath: "src/a.ts",
    binary: false,
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        lines: [
          { type: "context", text: "keep" },
          { type: "remove", text: "old" },
          { type: "add", text: "new" },
        ],
      },
    ],
  } satisfies FileDiff);
  stubChanges(status, diff);
  const user = userEvent.setup();
  render(<Changes />);

  expect(await screen.findByText("src/a.ts")).toBeInTheDocument();
  expect(screen.getByText("src/new.ts")).toBeInTheDocument();
  expect(screen.getByText("modified")).toBeInTheDocument();
  expect(screen.getByText("untracked")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /src\/a\.ts/ }));

  expect(await screen.findByText("-old")).toBeInTheDocument();
  expect(screen.getByText("+new")).toBeInTheDocument();
  expect(diff).toHaveBeenCalledWith("src/a.ts", "/work/foo");
});

it("reloads changes when the reload button is pressed", async () => {
  useAppStore.setState({ selectedProject: "/work/foo" });
  const status = vi.fn().mockResolvedValue(REPO_EMPTY);
  stubChanges(status, vi.fn());
  const user = userEvent.setup();
  render(<Changes />);

  await screen.findByText("No uncommitted changes");
  await user.click(screen.getByRole("button", { name: /Reload changes/ }));
  expect(status).toHaveBeenCalledTimes(2);
});

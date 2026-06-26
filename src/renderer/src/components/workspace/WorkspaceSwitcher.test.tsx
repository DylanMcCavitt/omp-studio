// AGE-671 — the switcher surfaces a colored workspace's swatch in its trigger
// (rendered in the sidebar), proving the "shows in switcher + sidebar"
// acceptance. Store state is driven directly; assertions go through the role +
// the inline swatch element, never an exact hex.

import type { WorkspaceColorKey } from "@shared/ipc";
import { render, screen } from "@testing-library/react";
import { useAppStore } from "@/store/app";
import { useSettingsStore } from "@/store/settings";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

function seedWorkspace(color: WorkspaceColorKey | undefined) {
  useSettingsStore.setState({
    settings: {
      workspaces: [
        {
          id: "w1",
          cwd: "/p/alpha",
          label: "Alpha",
          pinned: false,
          lastUsedAt: "t",
          color,
        },
      ],
    } as never,
    recordWorkspace: vi.fn(),
  });
  useAppStore.setState({ selectedProject: "/p/alpha" } as never);
  Object.assign(window.omp, {
    changes: {
      workspaceInfo: vi.fn(() => new Promise(() => {})),
    },
  });
}

it("shows the current workspace's color swatch in the trigger when set", () => {
  seedWorkspace("blue");
  render(<WorkspaceSwitcher />);

  const trigger = screen.getByRole("button", { name: /Alpha/ });
  const swatch = trigger.querySelector("span[style]") as HTMLElement | null;
  expect(swatch).not.toBeNull();
  expect(swatch?.style.backgroundColor).not.toBe("");
});

it("shows no swatch in the trigger when the workspace has no color", () => {
  seedWorkspace(undefined);
  render(<WorkspaceSwitcher />);

  const trigger = screen.getByRole("button", { name: /Alpha/ });
  expect(trigger.querySelector("span[style]")).toBeNull();
});

it("shows active git branch and worktree path in the trigger", async () => {
  seedWorkspace("blue");
  vi.mocked(window.omp.changes.workspaceInfo).mockResolvedValue({
    repo: true,
    branch: "feature/alpha",
    worktreePath: "/private/tmp/omp-wt/age-741",
  });

  render(<WorkspaceSwitcher />);

  expect(
    await screen.findByText(/feature\/alpha .*\/private\/tmp\/omp-wt\/age-741/),
  ).toBeInTheDocument();
  expect(window.omp.changes.workspaceInfo).toHaveBeenCalledWith("/p/alpha");
});

it("refreshes git metadata when the window regains focus", async () => {
  seedWorkspace("blue");
  vi.mocked(window.omp.changes.workspaceInfo)
    .mockResolvedValueOnce({
      repo: true,
      branch: "main",
      worktreePath: "/p/alpha",
    })
    .mockResolvedValueOnce({
      repo: true,
      branch: "feature/focus",
      worktreePath: "/p/alpha",
    });

  render(<WorkspaceSwitcher />);
  await screen.findByText(/main .*\/p\/alpha/);

  window.dispatchEvent(new Event("focus"));

  await screen.findByText(/feature\/focus .*\/p\/alpha/);
});

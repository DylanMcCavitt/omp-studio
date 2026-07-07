import type { OmpApi, StudioSettings } from "@shared/ipc";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "@/store/app";
import { useSettingsStore } from "@/store/settings";
import { useToastStore } from "@/store/toast";
import { AddWorkspaceDialog } from "./AddWorkspaceDialog";

const PRISTINE_APP = useAppStore.getState();
const PRISTINE_SETTINGS = useSettingsStore.getState();

const SETTINGS: StudioSettings = {
  version: 2,
  theme: "system",
  defaultProject: null,
  defaultModel: null,
  defaultThinkingLevel: "medium",
  defaultApprovalMode: "always-ask",
  defaultAutoApprove: false,
  liveSessionLimit: 4,
  recentProjects: [],
  openSessions: [],
  workspaces: [],
};

beforeEach(() => {
  Object.assign(window.omp, {
    pickDirectory: vi.fn().mockResolvedValue(null),
  } as Partial<OmpApi>);
  useAppStore.setState({ ...PRISTINE_APP, selectedProject: null }, true);
  useSettingsStore.setState(
    {
      ...PRISTINE_SETTINGS,
      settings: SETTINGS,
      addWorkspace: vi.fn().mockResolvedValue(undefined),
    },
    true,
  );
  useToastStore.setState({ toasts: [] });
});

it("blocks submit until a directory has been picked", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();

  render(<AddWorkspaceDialog onClose={onClose} />);

  const submit = screen.getByRole("button", { name: "Add workspace" });
  expect(submit).toBeDisabled();
  await user.click(submit);

  expect(useSettingsStore.getState().addWorkspace).not.toHaveBeenCalled();
  expect(useAppStore.getState().selectedProject).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});

it("picks a directory, trims the optional label, persists the color, and selects the workspace", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  vi.mocked(window.omp.pickDirectory).mockResolvedValue("/repo/omp-studio");

  render(<AddWorkspaceDialog onClose={onClose} />);

  await user.click(
    screen.getByRole("button", { name: /Choose a project directory/ }),
  );
  expect(await screen.findByText("/repo/omp-studio")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Label (optional)"), "  Studio UI  ");
  await user.click(screen.getByRole("button", { name: "Blue" }));
  await user.click(screen.getByRole("button", { name: "Add workspace" }));

  await waitFor(() =>
    expect(useSettingsStore.getState().addWorkspace).toHaveBeenCalledWith(
      "/repo/omp-studio",
      "Studio UI",
      "blue",
    ),
  );
  expect(useAppStore.getState().selectedProject).toBe("/repo/omp-studio");
  expect(useToastStore.getState().toasts[0]?.title).toBe(
    "Added workspace “Studio UI”",
  );
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("cancel leaves the workspace stores untouched", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  vi.mocked(window.omp.pickDirectory).mockResolvedValue("/repo/not-saved");

  render(<AddWorkspaceDialog onClose={onClose} />);

  await user.click(
    screen.getByRole("button", { name: /Choose a project directory/ }),
  );
  expect(await screen.findByText("/repo/not-saved")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Label (optional)"), "Discard me");
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(useSettingsStore.getState().addWorkspace).not.toHaveBeenCalled();
  expect(useAppStore.getState().selectedProject).toBeNull();
  expect(onClose).toHaveBeenCalledTimes(1);
});

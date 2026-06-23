// AGE-622 — the Terminal view's capability gate. Two behaviours that matter:
// (1) while `settings.terminal.enabled` is false the shell surface is NEVER
// mounted — an honest acknowledgement modal blocks it, and the copy never
// claims the terminal is secure/sandboxed; (2) enabling flips
// `settings.terminal.enabled` (preserving the persisted concurrency cap) and
// reveals the shell scoped to the active workspace cwd.
//
// XtermView is stubbed: it owns a live xterm.js/canvas pipeline that jsdom
// can't run, and this suite is about the gate, not the pty.

import type { StudioSettings } from "@shared/ipc";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "@/store/app";
import { useSettingsStore } from "@/store/settings";
import Terminal from "./Terminal";

vi.mock("@/components/terminal/XtermView", () => ({
  XtermView: ({ cwd }: { cwd: string }) => (
    <div data-testid="xterm-surface" data-cwd={cwd} />
  ),
}));

const BASE: StudioSettings = {
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
};

/**
 * Seed the settings store and stub `update` so an enable flip merges the patch
 * back into `settings` (pessimistic adopt), driving the view's re-render.
 */
function seedSettings(terminal: StudioSettings["terminal"]) {
  const update = vi.fn(async (patch: Partial<StudioSettings>) => {
    useSettingsStore.setState((s) => ({
      settings: { ...(s.settings as StudioSettings), ...patch },
    }));
  });
  useSettingsStore.setState({
    settings: { ...BASE, terminal },
    update,
    loading: false,
    error: undefined,
  });
  return update;
}

beforeEach(() => {
  useAppStore.setState({ selectedProject: "/work/app", route: "dashboard" });
});

it("blocks the shell behind an honest acknowledgement gate when disabled", () => {
  seedSettings({ enabled: false, maxConcurrent: 4 });

  render(<Terminal />);

  // The blocking modal is shown with honest, non-reassuring copy.
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("Enable the terminal?")).toBeInTheDocument();
  expect(screen.getByText(/full user-account privileges/i)).toBeInTheDocument();
  expect(screen.getByText(/not sandboxed/i)).toBeInTheDocument();
  // It must NEVER claim the terminal is secure or safe.
  expect(screen.queryByText(/secure terminal/i)).toBeNull();
  expect(screen.queryByText(/sandboxed and safe|perfectly safe/i)).toBeNull();
  // The gate blocks the shell: the pty surface is not mounted.
  expect(screen.queryByTestId("xterm-surface")).toBeNull();
});

it("enabling flips settings.terminal.enabled (preserving the cap) and reveals the shell", async () => {
  const user = userEvent.setup();
  const update = seedSettings({ enabled: false, maxConcurrent: 7 });

  render(<Terminal />);
  expect(screen.queryByTestId("xterm-surface")).toBeNull();

  await user.click(screen.getByRole("button", { name: /enable terminal/i }));

  // Flips enabled while preserving the persisted concurrency cap.
  expect(update).toHaveBeenCalledWith({
    terminal: { enabled: true, maxConcurrent: 7 },
  });
  // Gate dismissed; the shell mounts scoped to the active workspace cwd.
  const surface = await screen.findByTestId("xterm-surface");
  expect(surface).toHaveAttribute("data-cwd", "/work/app");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows an empty state (no shell) when enabled but no workspace is selected", () => {
  useAppStore.setState({ selectedProject: null });
  seedSettings({ enabled: true, maxConcurrent: 4 });

  render(<Terminal />);

  expect(screen.getByText("No workspace selected")).toBeInTheDocument();
  expect(screen.queryByTestId("xterm-surface")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

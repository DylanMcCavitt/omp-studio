// AGE-622 — the Terminal view's capability gate. Two behaviours that matter:
// (1) while `settings.terminal.enabled` is false the shell surface is NEVER
// mounted — an honest acknowledgement modal blocks it, and the copy never
// claims the terminal is secure/sandboxed; (2) enabling flips
// `settings.terminal.enabled` (preserving the persisted concurrency cap) and
// reveals the shell scoped to the active workspace cwd.
//
// XtermView is stubbed: it owns a live xterm.js/canvas pipeline that jsdom
// can't run, and this suite is about the gate, not the pty.

import type { ExternalTerminalLauncherInfo, StudioSettings } from "@shared/ipc";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "@/store/app";
import { useSettingsStore } from "@/store/settings";
import { useTerminalStore } from "@/store/terminal";
import Terminal from "./Terminal";

vi.mock("@/components/terminal/XtermView", () => ({
  XtermView: ({
    id,
    cwd,
    active,
  }: {
    id: string;
    cwd: string;
    active?: boolean;
  }) => (
    <div
      data-testid="xterm-surface"
      data-id={id}
      data-cwd={cwd}
      data-active={String(active)}
    />
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

function installTerminalMock(launchers?: ExternalTerminalLauncherInfo[]) {
  let seq = 0;
  const create = vi.fn(async ({ cwd }: { cwd: string }) => {
    seq += 1;
    return {
      id: `term-${seq}`,
      cwd,
      shell: "/bin/zsh",
      createdAt: `2026-01-01T00:00:0${seq}.000Z`,
    };
  });
  const kill = vi.fn(async () => {});
  const externalLaunchers = vi.fn(() =>
    launchers ? Promise.resolve(launchers) : new Promise(() => {}),
  );
  const openExternal = vi.fn(
    async ({ cwd, profile }: { cwd: string; profile?: string }) => ({
      id: "launch-1",
      cwd,
      profile: profile ?? "system",
      label: profile === "ghostty" ? "Ghostty" : "System terminal",
      launchedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  Object.assign(window.omp, {
    terminal: {
      create,
      kill,
      write: vi.fn(async () => {}),
      resize: vi.fn(async () => {}),
      list: vi.fn(async () => []),
      externalLaunchers,
      openExternal,
      onData: vi.fn(() => () => {}),
      onExit: vi.fn(() => () => {}),
    },
  });
  return { create, kill, externalLaunchers, openExternal };
}

beforeEach(() => {
  useAppStore.setState({ selectedProject: "/work/app", route: "dashboard" });
  useTerminalStore.setState({ terminals: {}, _unsub: null });
  installTerminalMock();
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

  // Flips enabled while preserving the persisted terminal settings.
  expect(update).toHaveBeenCalledWith({
    terminal: {
      enabled: true,
      maxConcurrent: 7,
      defaultTarget: "built-in",
      externalProfile: "system",
    },
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

it("renders workspace-scoped terminal tabs and creates a second tab without killing the first", async () => {
  const user = userEvent.setup();
  const terminal = installTerminalMock();
  seedSettings({ enabled: true, maxConcurrent: 4 });

  render(<Terminal />);
  expect(await screen.findByRole("tab", { name: /Terminal 1/ })).toBeVisible();
  expect(screen.getByTestId("xterm-surface")).toHaveAttribute(
    "data-id",
    "term-1",
  );

  await user.click(screen.getByRole("button", { name: "New terminal" }));

  expect(await screen.findByRole("tab", { name: /Terminal 2/ })).toBeVisible();
  expect(terminal.create).toHaveBeenCalledTimes(2);
  expect(terminal.kill).not.toHaveBeenCalled();
  expect(screen.getAllByTestId("xterm-surface")).toHaveLength(2);
});

it("opens the selected external terminal without spawning a built-in tab", async () => {
  const user = userEvent.setup();
  const terminal = installTerminalMock([
    {
      profile: "ghostty",
      label: "Ghostty",
      available: true,
      kind: "mac-app",
      detectedPath: "/Applications/Ghostty.app",
    },
  ]);
  seedSettings({
    enabled: true,
    maxConcurrent: 4,
    defaultTarget: "external",
    externalProfile: "ghostty",
  });

  render(<Terminal />);

  const openExternal = await screen.findByRole("button", {
    name: /open ghostty/i,
  });
  expect(openExternal).toHaveAttribute(
    "title",
    "Open Ghostty as a separate app",
  );
  expect(
    await screen.findByText(
      "Open Ghostty as a separate app, or create a built-in xterm tab for this workspace.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("No terminal tabs")).toBeInTheDocument();
  expect(terminal.create).not.toHaveBeenCalled();

  await user.click(openExternal);

  expect(terminal.openExternal).toHaveBeenCalledWith({
    cwd: "/work/app",
    profile: "ghostty",
  });
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Opened Ghostty for app.",
  );
  expect(terminal.openExternal).toHaveBeenCalledTimes(1);
  expect(terminal.create).not.toHaveBeenCalled();
  expect(screen.queryByRole("tab")).toBeNull();
  expect(screen.queryByTestId("xterm-surface")).toBeNull();
});

it("disables the external affordance when the selected profile is unavailable", async () => {
  installTerminalMock([
    {
      profile: "ghostty",
      label: "Ghostty",
      available: false,
      kind: "unavailable",
      reason: "Not installed",
    },
  ]);
  seedSettings({
    enabled: true,
    maxConcurrent: 4,
    defaultTarget: "external",
    externalProfile: "ghostty",
  });

  render(<Terminal />);

  const openGhostty = await screen.findByRole("button", {
    name: /open ghostty/i,
  });
  expect(openGhostty).toBeDisabled();
  expect(openGhostty).toHaveAttribute(
    "title",
    "Ghostty is not available; external terminals open as separate apps.",
  );
});

it("switches tabs without killing ptys; close tab explicitly kills one", async () => {
  const user = userEvent.setup();
  const terminal = installTerminalMock();
  seedSettings({ enabled: true, maxConcurrent: 4 });

  render(<Terminal />);
  await screen.findByRole("tab", { name: /Terminal 1/ });
  await user.click(screen.getByRole("button", { name: "New terminal" }));
  const first = screen.getByRole("tab", { name: /Terminal 1/ });
  const second = await screen.findByRole("tab", { name: /Terminal 2/ });

  await user.click(first);
  expect(first).toHaveAttribute("aria-selected", "true");
  expect(terminal.kill).not.toHaveBeenCalled();
  expect(screen.getAllByTestId("xterm-surface")).toHaveLength(2);
  expect(
    screen
      .getAllByTestId("xterm-surface")
      .find((el) => el.dataset.id === "term-1"),
  ).toHaveAttribute("data-active", "true");

  await user.click(second);
  expect(second).toHaveAttribute("aria-selected", "true");
  expect(
    screen
      .getAllByTestId("xterm-surface")
      .find((el) => el.dataset.id === "term-2"),
  ).toHaveAttribute("data-active", "true");
  expect(terminal.kill).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Close Terminal 1" }));
  expect(terminal.kill).toHaveBeenCalledWith("term-1");
});

it("closing and reopening the panel keeps the pty until the tab is closed", async () => {
  const terminal = installTerminalMock();
  seedSettings({ enabled: true, maxConcurrent: 4 });

  const { unmount } = render(<Terminal />);
  expect(await screen.findByRole("tab", { name: /Terminal 1/ })).toBeVisible();

  unmount();
  expect(terminal.kill).not.toHaveBeenCalled();

  render(<Terminal />);

  expect(await screen.findByRole("tab", { name: /Terminal 1/ })).toBeVisible();
  expect(screen.getByTestId("xterm-surface")).toHaveAttribute(
    "data-id",
    "term-1",
  );
  expect(terminal.create).toHaveBeenCalledTimes(1);
});

it("closing the only tab does not auto-spawn a replacement", async () => {
  const user = userEvent.setup();
  const terminal = installTerminalMock();
  seedSettings({ enabled: true, maxConcurrent: 4 });

  render(<Terminal />);
  await screen.findByRole("tab", { name: /Terminal 1/ });

  await user.click(screen.getByRole("button", { name: "Close Terminal 1" }));

  expect(terminal.kill).toHaveBeenCalledWith("term-1");
  expect(terminal.create).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("No terminal tabs")).toBeInTheDocument();
});

it("surfaces terminal creation failures with a retry path", async () => {
  const user = userEvent.setup();
  const terminal = installTerminalMock();
  terminal.create.mockRejectedValueOnce(new Error("max terminals reached"));
  seedSettings({ enabled: true, maxConcurrent: 4 });

  render(<Terminal />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "max terminals reached",
  );
  expect(terminal.create).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "Retry" }));

  expect(await screen.findByRole("tab", { name: /Terminal 1/ })).toBeVisible();
  expect(terminal.create).toHaveBeenCalledTimes(2);
});

it("lists exited terminal sessions in the tab bar", async () => {
  seedSettings({ enabled: true, maxConcurrent: 4 });
  useTerminalStore.setState({
    terminals: {
      exited: {
        id: "exited",
        cwd: "/work/app",
        shell: "/bin/zsh",
        createdAt: "2026-01-01T00:00:00.000Z",
        exited: true,
        exitCode: 0,
      },
    },
  });

  render(<Terminal />);

  expect(screen.getByRole("tab", { name: /Terminal 1 exited/ })).toBeVisible();
  expect(screen.getByText("exited")).toBeInTheDocument();
});

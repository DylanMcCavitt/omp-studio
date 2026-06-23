// AGE-612 §3 — the Collapsible disclosure primitive. Verifies the chevron header
// toggles the body open/closed with correct aria, reads its initial state from
// the persisted `settings.ui.collapsed` map, and writes a toggle back through a
// debounced settings update. Behaviour + roles only.

import type { StudioSettingsV1 } from "@shared/ipc";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSettingsStore } from "@/store/settings";
import { Collapsible } from "./Collapsible";

const BASE: StudioSettingsV1 = {
  version: 1,
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

function seedCollapsed(collapsed: Record<string, boolean>) {
  useSettingsStore.setState({
    settings: { ...BASE, ui: { collapsed } } as unknown as StudioSettingsV1,
    loading: false,
    error: undefined,
  });
}

beforeEach(() => {
  // No persisted settings by default → persistKey falls back to local state.
  useSettingsStore.setState({
    settings: null,
    loading: false,
    error: undefined,
  });
});

it("renders the title and toggles the body open/closed", async () => {
  const user = userEvent.setup();
  render(
    <Collapsible title="Details">
      <p>Body content</p>
    </Collapsible>,
  );

  const toggle = screen.getByRole("button", { name: "Details" });
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Body content")).toBeInTheDocument();

  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("Body content")).not.toBeInTheDocument();

  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Body content")).toBeInTheDocument();
});

it("starts collapsed when settings.ui.collapsed has the key set", () => {
  seedCollapsed({ "panel.details": true });
  render(
    <Collapsible title="Details" persistKey="panel.details">
      <p>Body content</p>
    </Collapsible>,
  );

  const toggle = screen.getByRole("button", { name: "Details" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("Body content")).not.toBeInTheDocument();
});

it("persists a toggle through a debounced settings update", () => {
  vi.useFakeTimers();
  try {
    const update = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({
      settings: BASE,
      update,
      loading: false,
      error: undefined,
    });

    render(
      <Collapsible title="Details" persistKey="panel.details" defaultOpen>
        <p>Body content</p>
      </Collapsible>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    // Debounced — nothing persisted until the trailing window elapses.
    expect(update).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      ui: { collapsed: { "panel.details": true } },
    });
  } finally {
    vi.useRealTimers();
  }
});

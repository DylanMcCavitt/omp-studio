// AGE-627 — the settings-store layout actions. `setLayout` debounces a
// resize/reorder drag into one `settings:update` (coalescing successive patches
// by key on a trailing window), and `resetLayout` clears `settings.layout` and
// cancels any in-flight debounce. Mirrors Collapsible.test.tsx's debounced-
// write pattern: stub `update` with a spy and drive fake timers.

import type { StudioSettings } from "@shared/ipc";
import { useSettingsStore } from "@/store/settings";

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

function seed(settings: StudioSettings) {
  const update = vi.fn().mockResolvedValue(undefined);
  useSettingsStore.setState({
    settings,
    update,
    loading: false,
    error: undefined,
  });
  return update;
}

beforeEach(() => {
  vi.useFakeTimers();
  useSettingsStore.setState({
    settings: null,
    loading: false,
    error: undefined,
  });
});

afterEach(() => {
  // Flush any pending debounce so the closure timer never leaks into the next
  // test, then drop back to real timers.
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

it("setLayout debounces, then persists a single merged layout patch", () => {
  const update = seed({ ...BASE });
  useSettingsStore.getState().setLayout({ sidebarWidthPct: 22 });

  // Trailing-edge: nothing persisted until the window elapses.
  expect(update).not.toHaveBeenCalled();

  vi.advanceTimersByTime(250);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith({ layout: { sidebarWidthPct: 22 } });
});

it("setLayout coalesces a burst into one trailing update with the last value", () => {
  const update = seed({ ...BASE });
  const { setLayout } = useSettingsStore.getState();
  setLayout({ sidebarWidthPct: 20 });
  setLayout({ sidebarWidthPct: 25 });
  setLayout({ sidebarWidthPct: 30 });

  vi.advanceTimersByTime(250);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith({ layout: { sidebarWidthPct: 30 } });
});

it("setLayout merges patches across different keys in one flush", () => {
  const update = seed({ ...BASE });
  const { setLayout } = useSettingsStore.getState();
  setLayout({ sidebarWidthPct: 20 });
  setLayout({ chatRailWidthPct: 30 });

  vi.advanceTimersByTime(250);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith({
    layout: { sidebarWidthPct: 20, chatRailWidthPct: 30 },
  });
});

it("setLayout persists right panel pixel widths by route", () => {
  const update = seed({
    ...BASE,
    layout: { rightPanelWidthsPx: { skills: 460 } },
  });
  useSettingsStore.getState().setLayout({
    rightPanelWidthsPx: { skills: 500, browser: 720 },
  });

  vi.advanceTimersByTime(250);
  expect(update).toHaveBeenCalledWith({
    layout: { rightPanelWidthsPx: { skills: 500, browser: 720 } },
  });
});

it("setLayout preserves the already-persisted layout it patches onto", () => {
  const update = seed({ ...BASE, layout: { navHidden: ["mcp"] } });
  useSettingsStore.getState().setLayout({ sidebarWidthPct: 20 });

  vi.advanceTimersByTime(250);
  expect(update).toHaveBeenCalledWith({
    layout: { navHidden: ["mcp"], sidebarWidthPct: 20 },
  });
});

it("resetLayout clears settings.layout and cancels a pending debounce", async () => {
  const update = seed({ ...BASE, layout: { sidebarWidthPct: 40 } });
  const store = useSettingsStore.getState();

  // A drag is mid-flight (pending) when the user hits Reset.
  store.setLayout({ sidebarWidthPct: 50 });
  await store.resetLayout();

  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith({ layout: {} });

  // The cancelled debounce must NOT fire a second update afterwards.
  vi.advanceTimersByTime(250);
  expect(update).toHaveBeenCalledTimes(1);
});

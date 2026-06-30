// AGE-624 — the Browser view. Two behaviors that matter: (1) with the browser
// capability OFF it shows the HONEST enable gate (states it loads untrusted
// remote content, never claims "secure"), enabling flips the setting and NO
// view is created; (2) with it ON the view creates the main-owned WebContentsView
// (empty start url + measured bounds) and renders the address chrome.

import type { BrowserViewState } from "@shared/domain";
import type { OmpApi, StudioSettings } from "@shared/ipc";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useBrowserStore } from "@/store/browser";
import { useSettingsStore } from "@/store/settings";
import Browser from "./Browser";

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

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function seedSettings(
  browser: boolean | NonNullable<StudioSettings["browser"]>,
  applyUpdates = false,
) {
  const initialBrowser =
    typeof browser === "boolean" ? { enabled: browser } : browser;
  const update = vi.fn(async (patch: Partial<StudioSettings>) => {
    if (!applyUpdates) return;
    const current = useSettingsStore.getState().settings ?? BASE;
    useSettingsStore.setState({
      settings: { ...current, ...patch },
    });
  });
  useSettingsStore.setState({
    settings: { ...BASE, browser: initialBrowser },
    loading: false,
    error: undefined,
    update,
  });
  return update;
}

function resetBrowserStore() {
  useBrowserStore.setState(useBrowserStore.getInitialState());
}

beforeEach(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    FakeResizeObserver;
  resetBrowserStore();
});

it("shows the honest enable gate when the browser capability is off", async () => {
  const update = seedSettings(false);
  const create = vi.fn();
  Object.assign(window.omp, {
    browser: { create, onState: vi.fn(() => () => {}), destroy: vi.fn() },
  } as unknown as Partial<OmpApi>);

  render(<Browser />);

  expect(screen.getByText("Embedded browser is off")).toBeInTheDocument();
  // The copy must be honest about the threat model and must NOT claim safety.
  expect(screen.getByText("untrusted remote web pages")).toBeInTheDocument();
  const body = document.body.textContent ?? "";
  expect(body).toContain("untrusted remote web pages");
  expect(body).toContain('not a hardened or "secure" browser');

  await userEvent.click(
    screen.getByRole("button", { name: /enable embedded browser/i }),
  );
  expect(update).toHaveBeenCalledWith({ browser: { enabled: true } });
  // The gate never creates a view; that only happens once enabled.
  expect(create).not.toHaveBeenCalled();
});

it("creates the first browser tab and renders the chrome when enabled", async () => {
  seedSettings(true);
  const initial: BrowserViewState = {
    id: "v1",
    url: "",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  const create = vi.fn().mockResolvedValue(initial);
  Object.assign(window.omp, {
    browser: {
      create,
      onState: vi.fn(() => () => {}),
      setBounds: vi.fn(),
      navigate: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      destroy: vi.fn(),
    },
  } as unknown as Partial<OmpApi>);

  render(<Browser />);

  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  // Empty homepage (deferred) + the measured placeholder rect (0s in jsdom).
  expect(create).toHaveBeenCalledWith({
    url: "",
    bounds: { x: 0, y: 0, width: 0, height: 0 },
  });
  // The chrome (not the gate) is mounted.
  expect(
    screen.getByRole("tablist", { name: "Browser tabs" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Tab 1: New tab" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.getByRole("button", { name: "New browser tab" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Address")).toBeInTheDocument();
  expect(screen.getByText("Start with an http(s) URL.")).toBeInTheDocument();
  expect(screen.queryByText("Embedded browser is off")).not.toBeInTheDocument();
});

it("creates, switches, and closes browser tabs from the tab strip", async () => {
  const user = userEvent.setup();
  seedSettings(true);
  const first: BrowserViewState = {
    id: "v1",
    url: "https://one.test",
    title: "One",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  const second: BrowserViewState = {
    id: "v2",
    url: "https://two.test",
    title: "Two",
    canGoBack: true,
    canGoForward: false,
    loading: false,
  };
  const create = vi
    .fn()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second);
  const destroy = vi.fn();
  Object.assign(window.omp, {
    browser: {
      create,
      onState: vi.fn(() => () => {}),
      setBounds: vi.fn(),
      navigate: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      destroy,
    },
  } as unknown as Partial<OmpApi>);

  render(<Browser />);

  const firstTab = await screen.findByRole("tab", { name: "Tab 1: One" });
  expect(firstTab).toHaveAttribute("aria-selected", "true");
  await waitFor(() =>
    expect(screen.getByLabelText("Address")).toHaveValue("https://one.test"),
  );

  await user.click(screen.getByRole("button", { name: "New browser tab" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  const secondTab = await screen.findByRole("tab", { name: "Tab 2: Two" });
  expect(secondTab).toHaveAttribute("aria-selected", "true");
  await waitFor(() =>
    expect(screen.getByLabelText("Address")).toHaveValue("https://two.test"),
  );
  expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();

  await user.click(firstTab);
  expect(firstTab).toHaveAttribute("aria-selected", "true");
  await waitFor(() =>
    expect(screen.getByLabelText("Address")).toHaveValue("https://one.test"),
  );
  expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Close tab 1: One" }));
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(destroy).toHaveBeenCalledWith("v1");
  expect(destroy).not.toHaveBeenCalledWith("v2");
});

it("disambiguates duplicate tab labels and clears stale blank-tab input on switch", async () => {
  const user = userEvent.setup();
  seedSettings(true);
  const first: BrowserViewState = {
    id: "v1",
    url: "",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  const second: BrowserViewState = {
    id: "v2",
    url: "",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  const create = vi
    .fn()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second);
  const navigate = vi.fn();
  Object.assign(window.omp, {
    browser: {
      create,
      onState: vi.fn(() => () => {}),
      setBounds: vi.fn(),
      navigate,
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      destroy: vi.fn(),
    },
  } as unknown as Partial<OmpApi>);

  render(<Browser />);

  const firstTab = await screen.findByRole("tab", { name: "Tab 1: New tab" });
  await user.click(screen.getByRole("button", { name: "New browser tab" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));

  const secondTab = await screen.findByRole("tab", { name: "Tab 2: New tab" });
  expect(firstTab).toHaveAttribute("aria-selected", "false");
  expect(secondTab).toHaveAttribute("aria-selected", "true");
  expect(
    screen.getByRole("button", { name: "Close tab 1: New tab" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Close tab 2: New tab" }),
  ).toBeInTheDocument();

  const input = screen.getByLabelText("Address");
  await user.type(input, "file:///tmp/secret");
  await user.click(screen.getByRole("button", { name: "Go" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Blocked scheme");
  expect(navigate).not.toHaveBeenCalled();

  await user.click(firstTab);
  await waitFor(() => expect(input).toHaveValue(""));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(firstTab).toHaveAttribute("aria-selected", "true");
});

it("shows a no-tab state after closing the last tab and recovers with a new tab", async () => {
  const user = userEvent.setup();
  seedSettings({
    enabled: true,
    bookmarks: [
      {
        url: "https://bookmark.test",
        title: "Bookmark",
        createdAt: "2026-06-30T00:00:00.000Z",
      },
    ],
    history: [
      {
        url: "https://history.test",
        title: "History",
        lastVisitedAt: "2026-06-30T00:00:00.000Z",
      },
    ],
  });
  const first: BrowserViewState = {
    id: "v1",
    url: "",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  const second: BrowserViewState = {
    id: "v2",
    url: "",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  const create = vi
    .fn()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second);
  const destroy = vi.fn();
  Object.assign(window.omp, {
    browser: {
      create,
      onState: vi.fn(() => () => {}),
      setBounds: vi.fn(),
      navigate: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      destroy,
    },
  } as unknown as Partial<OmpApi>);

  render(<Browser />);

  await screen.findByRole("tab", { name: "Tab 1: New tab" });
  await user.click(
    screen.getByRole("button", { name: "Close tab 1: New tab" }),
  );

  expect(destroy).toHaveBeenCalledWith("v1");
  expect(screen.getByText("No browser tabs are open.")).toBeInTheDocument();
  expect(screen.getByLabelText("Address")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "Bookmarks" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "Recent pages" })).toBeDisabled();

  const [, emptyStateNewTab] = screen.getAllByRole("button", {
    name: "New browser tab",
  });
  if (!emptyStateNewTab) throw new Error("Missing empty-state new-tab action");
  await user.click(emptyStateNewTab);
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(
    await screen.findByRole("tab", { name: "Tab 1: New tab" }),
  ).toHaveAttribute("aria-selected", "true");
});

it("destroys every browser tab when the panel unmounts", async () => {
  const user = userEvent.setup();
  seedSettings(true);
  const first: BrowserViewState = {
    id: "v1",
    url: "https://one.test",
    title: "One",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  const second: BrowserViewState = {
    id: "v2",
    url: "https://two.test",
    title: "Two",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  const destroy = vi.fn();
  Object.assign(window.omp, {
    browser: {
      create: vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second),
      onState: vi.fn(() => () => {}),
      setBounds: vi.fn(),
      navigate: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      destroy,
    },
  } as unknown as Partial<OmpApi>);

  const { unmount } = render(<Browser />);

  await screen.findByRole("tab", { name: "Tab 1: One" });
  await user.click(screen.getByRole("button", { name: "New browser tab" }));
  await screen.findByRole("tab", { name: "Tab 2: Two" });

  unmount();

  expect(destroy).toHaveBeenCalledTimes(2);
  expect(destroy).toHaveBeenCalledWith("v1");
  expect(destroy).toHaveBeenCalledWith("v2");
});

it("dispatches explicit diagnostics affordances from local user clicks", async () => {
  seedSettings(true);
  const openDevTools = vi.fn();
  const openExternal = vi.fn();
  const initial: BrowserViewState = {
    id: "v1",
    url: "https://example.com",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  Object.assign(window.omp, {
    browser: {
      create: vi.fn().mockResolvedValue(initial),
      onState: vi.fn(() => () => {}),
      setBounds: vi.fn(),
      navigate: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      openDevTools,
      openExternal,
      destroy: vi.fn(),
    },
  } as unknown as Partial<OmpApi>);

  render(<Browser />);

  await userEvent.click(
    await screen.findByRole("button", { name: "Open browser DevTools" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Open current page externally" }),
  );

  expect(openDevTools).toHaveBeenCalledWith("v1");
  expect(openExternal).toHaveBeenCalledWith("v1");
});

it("shows loading and navigation errors in the enabled panel", async () => {
  seedSettings(true);
  const initial: BrowserViewState = {
    id: "v1",
    url: "https://example.com",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: true,
    error:
      "Blocked file:///etc/passwd. Embedded browser navigation allows only http(s) URLs.",
  };
  Object.assign(window.omp, {
    browser: {
      create: vi.fn().mockResolvedValue(initial),
      onState: vi.fn(() => () => {}),
      setBounds: vi.fn(),
      navigate: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      destroy: vi.fn(),
    },
  } as unknown as Partial<OmpApi>);

  render(<Browser />);

  expect(await screen.findByRole("status")).toHaveTextContent("Loading page");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "allows only http(s) URLs",
  );
});

it("explains blocked address schemes before navigating", async () => {
  seedSettings(true);
  const navigate = vi.fn();
  const initial: BrowserViewState = {
    id: "v1",
    url: "",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  Object.assign(window.omp, {
    browser: {
      create: vi.fn().mockResolvedValue(initial),
      onState: vi.fn(() => () => {}),
      setBounds: vi.fn(),
      navigate,
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      destroy: vi.fn(),
    },
  } as unknown as Partial<OmpApi>);

  render(<Browser />);
  const input = await screen.findByLabelText("Address");

  await userEvent.type(input, "file:///etc/passwd");
  await userEvent.click(screen.getByRole("button", { name: "Go" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Blocked scheme");
  expect(navigate).not.toHaveBeenCalled();

  await userEvent.clear(input);
  await userEvent.type(input, "localhost:3000");
  await userEvent.click(screen.getByRole("button", { name: "Go" }));

  expect(navigate).toHaveBeenCalledWith("v1", "https://localhost:3000");
});

it("saves and removes the current page bookmark metadata only", async () => {
  const user = userEvent.setup();
  const update = seedSettings(
    { enabled: true, bookmarks: [], history: [] },
    true,
  );
  const initial: BrowserViewState = {
    id: "v1",
    url: "https://example.com/docs",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  Object.assign(window.omp, {
    browser: {
      create: vi.fn().mockResolvedValue(initial),
      onState: vi.fn(() => () => {}),
      setBounds: vi.fn(),
      navigate: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      destroy: vi.fn(),
    },
  } as unknown as Partial<OmpApi>);

  render(<Browser />);

  await user.click(
    await screen.findByRole("button", {
      name: "Save current page bookmark",
    }),
  );

  await waitFor(() =>
    expect(update).toHaveBeenLastCalledWith({
      browser: {
        enabled: true,
        bookmarks: [
          {
            url: "https://example.com/docs",
            title: "https://example.com/docs",
            createdAt: expect.any(String),
          },
        ],
        history: [
          {
            url: "https://example.com/docs",
            title: "https://example.com/docs",
            lastVisitedAt: expect.any(String),
          },
        ],
      },
    }),
  );
  expect(update.mock.lastCall?.[0].browser).not.toHaveProperty("partition");

  await user.click(
    await screen.findByRole("button", {
      name: "Remove current page bookmark",
    }),
  );

  await waitFor(() =>
    expect(update).toHaveBeenLastCalledWith({
      browser: {
        enabled: true,
        bookmarks: [],
        history: [
          {
            url: "https://example.com/docs",
            title: "https://example.com/docs",
            lastVisitedAt: expect.any(String),
          },
        ],
      },
    }),
  );
});

it("persists history metadata across remounts and navigates bookmark and history picks", async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  seedSettings(
    {
      enabled: true,
      bookmarks: [
        {
          url: "https://bookmark.test",
          title: "Bookmark",
          createdAt: "2026-06-30T00:00:00.000Z",
        },
      ],
      history: [],
    },
    true,
  );
  const initial: BrowserViewState = {
    id: "v1",
    url: "https://docs.test",
    title: "Docs",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  const remounted: BrowserViewState = {
    id: "v2",
    url: "",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  const create = vi
    .fn()
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce(remounted);
  Object.assign(window.omp, {
    browser: {
      create,
      onState: vi.fn(() => () => {}),
      setBounds: vi.fn(),
      navigate,
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      destroy: vi.fn(),
    },
  } as unknown as Partial<OmpApi>);

  const view = render(<Browser />);

  await waitFor(() =>
    expect(useSettingsStore.getState().settings?.browser?.history).toEqual([
      {
        url: "https://docs.test",
        title: "Docs",
        lastVisitedAt: expect.any(String),
      },
    ]),
  );

  view.unmount();
  resetBrowserStore();
  render(<Browser />);
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));

  await user.click(await screen.findByRole("combobox", { name: "Bookmarks" }));
  await user.click(await screen.findByRole("option", { name: /Bookmark/ }));
  expect(navigate).toHaveBeenCalledWith("v2", "https://bookmark.test");

  await user.click(screen.getByRole("combobox", { name: "Recent pages" }));
  await user.click(await screen.findByRole("option", { name: /Docs/ }));
  expect(navigate).toHaveBeenCalledWith("v2", "https://docs.test");
});

it("clears bookmark and history metadata without disabling the browser", async () => {
  const user = userEvent.setup();
  const update = seedSettings(
    {
      enabled: true,
      bookmarks: [
        {
          url: "https://bookmark.test",
          title: "Bookmark",
          createdAt: "2026-06-30T00:00:00.000Z",
        },
      ],
      history: [
        {
          url: "https://history.test",
          title: "History",
          lastVisitedAt: "2026-06-30T00:00:00.000Z",
        },
      ],
    },
    true,
  );
  const initial: BrowserViewState = {
    id: "v1",
    url: "",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  Object.assign(window.omp, {
    browser: {
      create: vi.fn().mockResolvedValue(initial),
      onState: vi.fn(() => () => {}),
      setBounds: vi.fn(),
      navigate: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      destroy: vi.fn(),
    },
  } as unknown as Partial<OmpApi>);

  render(<Browser />);

  await user.click(
    await screen.findByRole("button", {
      name: "Clear browser bookmarks and history metadata",
    }),
  );

  await waitFor(() =>
    expect(update).toHaveBeenLastCalledWith({
      browser: { enabled: true, bookmarks: [], history: [] },
    }),
  );
  expect(
    screen.getByRole("button", { name: "Save current page bookmark" }),
  ).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "Bookmarks" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "Recent pages" })).toBeDisabled();
  expect(
    screen.getByRole("button", {
      name: "Clear browser bookmarks and history metadata",
    }),
  ).toBeDisabled();
});

it("saves a same-url revisit after clearing metadata", async () => {
  const user = userEvent.setup();
  seedSettings(
    {
      enabled: true,
      bookmarks: [],
      history: [
        {
          url: "https://same.test",
          title: "Same",
          lastVisitedAt: "2026-06-30T00:00:00.000Z",
        },
      ],
    },
    true,
  );
  const initial: BrowserViewState = {
    id: "v1",
    url: "https://same.test",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  const navigate = vi.fn();
  Object.assign(window.omp, {
    browser: {
      create: vi.fn().mockResolvedValue(initial),
      onState: vi.fn(() => () => {}),
      setBounds: vi.fn(),
      navigate,
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      destroy: vi.fn(),
    },
  } as unknown as Partial<OmpApi>);

  render(<Browser />);

  await user.click(
    await screen.findByRole("button", {
      name: "Clear browser bookmarks and history metadata",
    }),
  );
  await waitFor(() =>
    expect(useSettingsStore.getState().settings?.browser?.history).toEqual([]),
  );

  await user.click(screen.getByRole("button", { name: "Go" }));
  expect(navigate).toHaveBeenCalledWith("v1", "https://same.test");
  await waitFor(() =>
    expect(useSettingsStore.getState().settings?.browser?.history).toEqual([
      {
        url: "https://same.test",
        title: "https://same.test",
        lastVisitedAt: expect.any(String),
      },
    ]),
  );
});

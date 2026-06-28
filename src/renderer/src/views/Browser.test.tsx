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

function seedSettings(enabled: boolean) {
  const update = vi.fn().mockResolvedValue(undefined);
  useSettingsStore.setState({
    settings: { ...BASE, browser: { enabled } },
    loading: false,
    error: undefined,
    update,
  });
  return update;
}

function resetBrowserStore() {
  useBrowserStore.setState({
    viewId: null,
    state: null,
    history: [],
    creating: false,
    error: undefined,
    _unsub: null,
  });
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

it("creates the main-owned view and renders the chrome when enabled", async () => {
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
  expect(screen.getByLabelText("Address")).toBeInTheDocument();
  expect(screen.getByText("Start with an http(s) URL.")).toBeInTheDocument();
  expect(screen.queryByText("Embedded browser is off")).not.toBeInTheDocument();
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

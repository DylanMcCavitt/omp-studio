// AGE-624 — the embedded-browser store. The behaviors that matter: `create`
// adopts the main-returned view id + initial state and primes history; the
// global `onState` push reduces into `state` + a deduped history and DROPS
// foreign view ids; control intents forward to the bridge with the active id
// (and no-op without a live view); the subscription is single-flight.

import type { BrowserViewState } from "@shared/domain";
import type { OmpApi } from "@shared/ipc";
import { useBrowserStore } from "@/store/browser";

function stubBrowser(over: Record<string, unknown>) {
  Object.assign(window.omp, {
    browser: over,
  } as unknown as Partial<OmpApi>);
}

function viewState(over: Partial<BrowserViewState>): BrowserViewState {
  return {
    id: "v1",
    url: "",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
    ...over,
  };
}

beforeEach(() => {
  useBrowserStore.setState({
    viewId: null,
    state: null,
    history: [],
    creating: false,
    error: undefined,
    _unsub: null,
  });
});

it("create adopts the returned id + initial state and primes history", async () => {
  const create = vi
    .fn()
    .mockResolvedValue(
      viewState({ id: "v1", url: "https://a.com", title: "A" }),
    );
  stubBrowser({ create, onState: vi.fn(() => () => {}) });

  await useBrowserStore.getState().create({
    url: "https://a.com",
    bounds: { x: 0, y: 0, width: 10, height: 10 },
  });

  const s = useBrowserStore.getState();
  expect(create).toHaveBeenCalledWith({
    url: "https://a.com",
    bounds: { x: 0, y: 0, width: 10, height: 10 },
  });
  expect(s.viewId).toBe("v1");
  expect(s.state?.url).toBe("https://a.com");
  expect(s.history).toEqual(["https://a.com"]);
});

it("does not create a second view while one already exists", async () => {
  const create = vi.fn().mockResolvedValue(viewState({ id: "v1" }));
  stubBrowser({ create });
  useBrowserStore.setState({ viewId: "v1" });

  await useBrowserStore.getState().create({
    url: "https://a.com",
    bounds: { x: 0, y: 0, width: 0, height: 0 },
  });

  expect(create).not.toHaveBeenCalled();
});

it("reduces onState pushes into state + deduped history, dropping foreign ids", () => {
  let push!: (s: BrowserViewState) => void;
  stubBrowser({
    onState: vi.fn((cb: (s: BrowserViewState) => void) => {
      push = cb;
      return () => {};
    }),
  });
  useBrowserStore.setState({ viewId: "v1", history: ["https://a.com"] });
  useBrowserStore.getState().ensureSubscribed();

  push(
    viewState({ id: "v1", url: "https://b.com", title: "B", loading: true }),
  );
  expect(useBrowserStore.getState().state?.title).toBe("B");
  expect(useBrowserStore.getState().state?.loading).toBe(true);
  expect(useBrowserStore.getState().history).toEqual([
    "https://b.com",
    "https://a.com",
  ]);

  // A late push for a different (torn-down) view never touches our state.
  push(viewState({ id: "other", url: "https://evil.com" }));
  expect(useBrowserStore.getState().history).toEqual([
    "https://b.com",
    "https://a.com",
  ]);

  // Same head URL (e.g. a loading→idle transition) is not duplicated.
  push(viewState({ id: "v1", url: "https://b.com", loading: false }));
  expect(useBrowserStore.getState().state?.loading).toBe(false);
  expect(useBrowserStore.getState().history).toEqual([
    "https://b.com",
    "https://a.com",
  ]);
});

it("forwards control intents to the bridge with the active view id", () => {
  const navigate = vi.fn();
  const goBack = vi.fn();
  const goForward = vi.fn();
  const reload = vi.fn();
  const destroy = vi.fn();
  const openDevTools = vi.fn();
  const openExternal = vi.fn();
  stubBrowser({
    navigate,
    goBack,
    goForward,
    reload,
    openDevTools,
    openExternal,
    destroy,
  });
  useBrowserStore.setState({ viewId: "v1" });

  const s = useBrowserStore.getState();
  s.navigate("https://c.com");
  s.back();
  s.forward();
  s.reload();
  s.openDevTools();
  s.openExternal();
  s.destroy();

  expect(navigate).toHaveBeenCalledWith("v1", "https://c.com");
  expect(goBack).toHaveBeenCalledWith("v1");
  expect(goForward).toHaveBeenCalledWith("v1");
  expect(reload).toHaveBeenCalledWith("v1");
  expect(openDevTools).toHaveBeenCalledWith("v1");
  expect(openExternal).toHaveBeenCalledWith("v1");
  expect(destroy).toHaveBeenCalledWith("v1");
  // destroy clears local state so a late push can't resurrect it.
  expect(useBrowserStore.getState().viewId).toBeNull();
  expect(useBrowserStore.getState().state).toBeNull();
});

it("control intents are no-ops when there is no live view", () => {
  const navigate = vi.fn();
  const reload = vi.fn();
  const openDevTools = vi.fn();
  const openExternal = vi.fn();
  stubBrowser({ navigate, reload, openDevTools, openExternal });

  useBrowserStore.getState().navigate("https://x.com");
  useBrowserStore.getState().reload();
  useBrowserStore.getState().openDevTools();
  useBrowserStore.getState().openExternal();

  expect(navigate).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  expect(openDevTools).not.toHaveBeenCalled();
  expect(openExternal).not.toHaveBeenCalled();
});

it("subscribes once and releases the listener on teardown", () => {
  const off = vi.fn();
  const onState = vi.fn(() => off);
  stubBrowser({ onState });

  const s = useBrowserStore.getState();
  s.ensureSubscribed();
  s.ensureSubscribed();
  expect(onState).toHaveBeenCalledTimes(1);

  s.teardown();
  expect(off).toHaveBeenCalledTimes(1);
});

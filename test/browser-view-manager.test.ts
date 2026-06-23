import { expect, test } from "bun:test";
import type { BrowserViewState } from "@shared/domain";
import {
  BrowserViewManager,
  isUrlAllowed,
  type ManagedView,
  type ViewBounds,
} from "../src/main/browser/view-manager";

// A fake WebContents whose events the test drives by hand, so the manager's
// nav-state push and allowlist gating are exercised with no electron runtime.
class FakeWebContents {
  url = "";
  title = "";
  loading = false;
  destroyed = false;
  back = false;
  forward = false;
  readonly loadCalls: string[] = [];
  reloaded = false;
  stopped = false;
  closed = false;
  windowOpenHandler?: (d: { url: string }) => { action: "allow" | "deny" };
  private readonly listeners = new Map<
    string,
    Array<(...a: unknown[]) => void>
  >();
  readonly navigationHistory = {
    canGoBack: () => this.back,
    canGoForward: () => this.forward,
    goBack: () => {
      this.url = "back";
    },
    goForward: () => {
      this.url = "forward";
    },
  };

  loadURL(u: string): Promise<void> {
    this.loadCalls.push(u);
    this.url = u;
    return Promise.resolve();
  }
  getURL(): string {
    return this.url;
  }
  getTitle(): string {
    return this.title;
  }
  isLoading(): boolean {
    return this.loading;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  reload(): void {
    this.reloaded = true;
  }
  stop(): void {
    this.stopped = true;
  }
  close(): void {
    this.closed = true;
    this.destroyed = true;
  }
  on(event: string, listener: (...a: unknown[]) => void): this {
    const arr = this.listeners.get(event) ?? [];
    arr.push(listener);
    this.listeners.set(event, arr);
    return this;
  }
  setWindowOpenHandler(
    h: (d: { url: string }) => { action: "allow" | "deny" },
  ): void {
    this.windowOpenHandler = h;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const l of this.listeners.get(event) ?? []) l(...args);
  }
}

class FakeView {
  readonly webContents = new FakeWebContents();
  bounds?: ViewBounds;
  setBounds(b: ViewBounds): void {
    this.bounds = b;
  }
}

const BOUNDS: ViewBounds = { x: 0, y: 0, width: 800, height: 600 };

interface Harness {
  manager: BrowserViewManager;
  created: FakeView[];
  states: BrowserViewState[];
  openedExternally: string[];
}

function harness(allowlist?: readonly string[]): Harness {
  const created: FakeView[] = [];
  const states: BrowserViewState[] = [];
  const openedExternally: string[] = [];
  // getWindow returns null so attach/teardown skip electron window ops; the
  // factory hands back fakes the test drives directly.
  const manager = new BrowserViewManager(() => null, {
    allowlist,
    createView: () => {
      const v = new FakeView();
      created.push(v);
      // FakeView structurally satisfies ManagedView; the cast is only needed
      // because TS cannot prove the loose `on` shape covers the source.
      return v as unknown as ManagedView;
    },
    openExternal: (u) => openedExternally.push(u),
  });
  manager.onState((s) => states.push(s));
  return { manager, created, states, openedExternally };
}

function wcOf(view: FakeView | undefined): FakeWebContents {
  if (!view) throw new Error("view was not created");
  return view.webContents;
}

// ---- the allowlist gate (pure predicate) --------------------------------

test("isUrlAllowed permits http/https and blocks every other scheme", () => {
  expect(isUrlAllowed("http://example.com")).toBe(true);
  expect(isUrlAllowed("https://example.com/path")).toBe(true);
  expect(isUrlAllowed("file:///etc/passwd")).toBe(false);
  expect(isUrlAllowed("about:blank")).toBe(false);
  expect(isUrlAllowed("data:text/html,<h1>x</h1>")).toBe(false);
  expect(isUrlAllowed("chrome://settings")).toBe(false);
  expect(isUrlAllowed("not a url")).toBe(false);
});

test("isUrlAllowed enforces the host allowlist (incl. subdomains) when set", () => {
  const list = ["example.com", "linear.app"];
  expect(isUrlAllowed("https://example.com", list)).toBe(true);
  expect(isUrlAllowed("https://docs.example.com", list)).toBe(true);
  expect(isUrlAllowed("https://linear.app/team", list)).toBe(true);
  expect(isUrlAllowed("https://evil.com", list)).toBe(false);
  // A look-alike suffix must NOT match: notexample.com !== *.example.com.
  expect(isUrlAllowed("https://notexample.com", list)).toBe(false);
  // An empty allowlist locks everything out (still http(s)-gated first).
  expect(isUrlAllowed("https://example.com", [])).toBe(false);
  expect(isUrlAllowed("file:///x", [])).toBe(false);
});

// ---- create + nav-state push ---------------------------------------------

test("create loads the initial url and returns a snapshot with an id", () => {
  const { manager, created } = harness();
  const state = manager.create({ url: "https://example.com", bounds: BOUNDS });
  expect(created).toHaveLength(1);
  expect(wcOf(created[0]).loadCalls).toEqual(["https://example.com"]);
  expect(created[0]?.bounds).toEqual(BOUNDS);
  expect(state.id.length).toBeGreaterThan(0);
  expect(state.url).toBe("https://example.com");
});

test("navigation/title/loading events push a computed BrowserViewState", () => {
  const { manager, created, states } = harness();
  const { id } = manager.create({ url: "https://example.com", bounds: BOUNDS });
  const wc = wcOf(created[0]);
  states.length = 0; // ignore states emitted during create; assert deltas only

  wc.title = "Example";
  wc.back = true;
  wc.loading = true;
  wc.emit("did-start-loading");
  expect(states.at(-1)).toEqual({
    id,
    url: "https://example.com",
    title: "Example",
    canGoBack: true,
    canGoForward: false,
    loading: true,
  });

  wc.loading = false;
  wc.url = "https://example.com/next";
  wc.emit("did-navigate");
  expect(states.at(-1)).toMatchObject({
    url: "https://example.com/next",
    loading: false,
  });

  // page-title-updated alone also refreshes the snapshot.
  wc.title = "Renamed";
  wc.emit("page-title-updated");
  expect(states.at(-1)?.title).toBe("Renamed");
});

// ---- allowlist gating through the manager --------------------------------

test("navigate only loads allowlisted http(s) urls", () => {
  const { manager, created } = harness(["example.com"]);
  const { id } = manager.create({ url: "https://example.com", bounds: BOUNDS });
  const wc = wcOf(created[0]);
  expect(wc.loadCalls).toEqual(["https://example.com"]);

  manager.navigate(id, "https://evil.com"); // disallowed host → blocked
  manager.navigate(id, "file:///etc/passwd"); // non-http(s) → blocked
  manager.navigate(id, "https://docs.example.com/ok"); // subdomain → allowed
  expect(wc.loadCalls).toEqual([
    "https://example.com",
    "https://docs.example.com/ok",
  ]);
});

test("will-navigate is prevented for disallowed targets, allowed otherwise", () => {
  const { manager, created } = harness(["example.com"]);
  manager.create({ url: "https://example.com", bounds: BOUNDS });
  const wc = wcOf(created[0]);

  let prevented = false;
  wc.emit("will-navigate", {
    url: "https://evil.com",
    preventDefault: () => {
      prevented = true;
    },
  });
  expect(prevented).toBe(true);

  prevented = false;
  wc.emit("will-navigate", {
    url: "https://example.com/inner",
    preventDefault: () => {
      prevented = true;
    },
  });
  expect(prevented).toBe(false);
});

test("will-redirect and will-frame-navigate are gated like will-navigate", () => {
  const { manager, created } = harness(["example.com"]);
  manager.create({ url: "https://example.com", bounds: BOUNDS });
  const wc = wcOf(created[0]);

  // A 30x redirect from an allowlisted page to a disallowed host is blocked.
  let prevented = false;
  wc.emit("will-redirect", {
    url: "https://evil.com",
    preventDefault: () => {
      prevented = true;
    },
  });
  expect(prevented).toBe(true);

  // A subframe navigation to a disallowed host is blocked too.
  prevented = false;
  wc.emit("will-frame-navigate", {
    url: "https://tracker.example.org",
    isMainFrame: false,
    preventDefault: () => {
      prevented = true;
    },
  });
  expect(prevented).toBe(true);

  // An allowlisted redirect target passes through untouched.
  prevented = false;
  wc.emit("will-redirect", {
    url: "https://example.com/after",
    preventDefault: () => {
      prevented = true;
    },
  });
  expect(prevented).toBe(false);
});

test("setWindowOpenHandler always denies; opens allowed targets externally", () => {
  const { manager, created, openedExternally } = harness(["example.com"]);
  manager.create({ url: "https://example.com", bounds: BOUNDS });
  const handler = wcOf(created[0]).windowOpenHandler;
  expect(handler).toBeDefined();

  expect(handler?.({ url: "https://example.com/pop" })).toEqual({
    action: "deny",
  });
  expect(handler?.({ url: "https://evil.com" })).toEqual({ action: "deny" });
  expect(handler?.({ url: "file:///x" })).toEqual({ action: "deny" });
  // Only the allowed http(s) target is handed to the OS browser.
  expect(openedExternally).toEqual(["https://example.com/pop"]);
});

// ---- back/forward/reload/setBounds/destroy lifecycle ---------------------

test("goBack/goForward respect navigation history availability", () => {
  const { manager, created } = harness();
  const { id } = manager.create({ url: "https://example.com", bounds: BOUNDS });
  const wc = wcOf(created[0]);

  wc.back = false;
  manager.goBack(id);
  expect(wc.url).toBe("https://example.com"); // no-op when canGoBack is false

  wc.back = true;
  manager.goBack(id);
  expect(wc.url).toBe("back");

  wc.forward = true;
  manager.goForward(id);
  expect(wc.url).toBe("forward");
});

test("reload and setBounds delegate to the view", () => {
  const { manager, created } = harness();
  const { id } = manager.create({ url: "https://example.com", bounds: BOUNDS });
  manager.reload(id);
  expect(wcOf(created[0]).reloaded).toBe(true);

  const next: ViewBounds = { x: 10, y: 20, width: 100, height: 200 };
  manager.setBounds(id, next);
  expect(created[0]?.bounds).toEqual(next);
});

test("destroy tears the view down and unregisters it", () => {
  const { manager, created } = harness();
  const { id } = manager.create({ url: "https://example.com", bounds: BOUNDS });
  const wc = wcOf(created[0]);

  manager.destroy(id);
  expect(wc.stopped).toBe(true);
  expect(wc.closed).toBe(true);

  // Gone from the registry: a later navigate must not reload the dead view.
  manager.navigate(id, "https://example.com/again");
  expect(wc.loadCalls).toEqual(["https://example.com"]);
});

test("destroyAll closes every view and empties the registry", () => {
  const { manager, created } = harness();
  manager.create({ url: "https://example.com", bounds: BOUNDS });
  manager.create({ url: "https://example.com/two", bounds: BOUNDS });
  expect(created).toHaveLength(2);

  manager.destroyAll();
  expect(created.every((v) => v.webContents.closed)).toBe(true);
});

test("unknown ids are silent no-ops (degrade, never throw)", () => {
  const { manager } = harness();
  expect(() => {
    manager.navigate("nope", "https://example.com");
    manager.goBack("nope");
    manager.goForward("nope");
    manager.reload("nope");
    manager.setBounds("nope", BOUNDS);
    manager.destroy("nope");
  }).not.toThrow();
});

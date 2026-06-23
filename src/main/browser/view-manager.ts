// Main-owned manager for embedded browser views (feature 8). Each browser tab is
// a distinct WebContentsView with its OWN WebContents — a separate web context
// from the main renderer, so embedding remote content NEVER relaxes the main
// window's CSP (see the platform design §6). Every view is locked down hard:
//   - sandbox + contextIsolation + nodeIntegration:false + NO preload, so web
//     content cannot reach `window.omp`, ipcRenderer, or Node — the embedded
//     view has no IPC bridge of any kind.
//   - an EPHEMERAL session partition by default ("omp-browser": in-memory, so
//     cookies/storage/cache are discarded on exit). A persisted partition is a
//     human opt-in only, never the default.
//   - navigation is policed by MAIN: file:// (and every non-http/https scheme)
//     is blocked, window.open / new-window popups are denied (an allowed http(s)
//     target opens in the OS browser instead), and an optional host allowlist
//     gates the rest (allowlist-first).
//
// All control (navigate/back/forward/reload/bounds/destroy) is driven by main on
// behalf of the trusted main renderer; the manager positions each view over a
// renderer-reported rect (win.contentView.addChildView + view.setBounds) and
// emits BrowserViewState so the bridge can push evt:browser-state. Like every
// other service, it degrades — it never throws across IPC.

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { BrowserViewState } from "@shared/domain";
import type { BrowserWindow, WebContentsView } from "electron";
import { scoped } from "../logger";

const log = scoped("browser");

/** Default ephemeral (non-`persist:`) partition — in-memory, cleared on exit. */
const DEFAULT_PARTITION = "omp-browser";

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Minimal STRUCTURAL surface of the electron objects the manager touches. It is
// declared here (not imported as a value) so this module never resolves
// electron's named exports at static link time — `bun test` loads it with an
// injected fake factory and no electron runtime, mirroring secret-store.ts.
export interface ManagedWebContents {
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  isLoading(): boolean;
  isDestroyed(): boolean;
  reload(): void;
  stop(): void;
  close(): void;
  readonly navigationHistory: {
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
  };
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: "allow" | "deny" },
  ): void;
}

export interface ManagedView {
  readonly webContents: ManagedWebContents;
  setBounds(bounds: ViewBounds): void;
}

export interface CreateViewOptions {
  partition: string;
}

export type ViewFactory = (opts: CreateViewOptions) => ManagedView;

export interface BrowserViewManagerOptions {
  /** Test seam: build the view. Defaults to a real sandboxed WebContentsView. */
  createView?: ViewFactory;
  /** Session partition; a non-`persist:` name (the default) is ephemeral. */
  partition?: string;
  /**
   * Host allowlist (allowlist-first). `undefined` imposes no host restriction
   * (any http/https host is allowed); a provided list — even an empty one —
   * permits ONLY the listed hosts and their subdomains. The http/https-only +
   * file:// block is always enforced regardless of this option.
   */
  allowlist?: readonly string[];
  /** Open an allowed popup target in the OS browser. Defaults to shell.openExternal. */
  openExternal?: (url: string) => void;
}

// True when `rawUrl` may be loaded in an embedded view: a well-formed http/https
// URL whose host passes the allowlist (when one is configured). Everything else
// — file://, about:, data:, chrome://, malformed URLs, disallowed hosts — is
// rejected. Exported so the gate can be unit-tested directly.
export function isUrlAllowed(
  rawUrl: string,
  allowlist?: readonly string[],
): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!allowlist) return true;
  const host = url.hostname.toLowerCase();
  return allowlist.some((entry) => {
    const e = entry.trim().toLowerCase();
    return e.length > 0 && (host === e || host.endsWith(`.${e}`));
  });
}

// Electron is reached only through this minimal structural surface so the module
// (a) never resolves electron's named exports at static link time and (b) is
// importable in plain-node test graphs that inject `createView`/`openExternal`.
interface ElectronBrowserBackend {
  WebContentsView: new (options: {
    webPreferences?: Record<string, unknown>;
  }) => ManagedView;
  session: { fromPartition(partition: string): unknown };
  shell: { openExternal(url: string): Promise<unknown> };
}
const requireCjs = createRequire(import.meta.url);
function electron(): ElectronBrowserBackend {
  return requireCjs("electron") as unknown as ElectronBrowserBackend;
}

function defaultCreateView(opts: CreateViewOptions): ManagedView {
  const { WebContentsView, session } = electron();
  return new WebContentsView({
    webPreferences: {
      // A separate, isolated web context — NOT the main renderer.
      session: session.fromPartition(opts.partition),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // No preload on purpose: the embedded view has no IPC bridge.
    },
  });
}

function defaultOpenExternal(url: string): void {
  void electron().shell.openExternal(url);
}

interface ViewRecord {
  id: string;
  view: ManagedView;
}

export class BrowserViewManager {
  private readonly views = new Map<string, ViewRecord>();
  private readonly stateListeners = new Set<
    (state: BrowserViewState) => void
  >();
  private readonly createView: ViewFactory;
  private readonly partition: string;
  private readonly allowlist?: readonly string[];
  private readonly openExternal: (url: string) => void;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    options: BrowserViewManagerOptions = {},
  ) {
    this.createView = options.createView ?? defaultCreateView;
    this.partition = options.partition ?? DEFAULT_PARTITION;
    this.allowlist = options.allowlist;
    this.openExternal = options.openExternal ?? defaultOpenExternal;
  }

  /** Subscribe to per-view state pushes; returns an unsubscribe. */
  onState(cb: (state: BrowserViewState) => void): () => void {
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  /** Create a new embedded view, position it over `bounds`, and load `url`. */
  create(opts: { url: string; bounds: ViewBounds }): BrowserViewState {
    const id = randomUUID();
    const view = this.createView({ partition: this.partition });
    this.views.set(id, { id, view });
    this.wire(id, view);
    view.setBounds(opts.bounds);
    this.attach(view);
    this.load(id, opts.url);
    return this.stateOf(id, view);
  }

  navigate(id: string, url: string): void {
    this.load(id, url);
  }

  goBack(id: string): void {
    const wc = this.views.get(id)?.view.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  goForward(id: string): void {
    const wc = this.views.get(id)?.view.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(id: string): void {
    this.views.get(id)?.view.webContents.reload();
  }

  setBounds(id: string, bounds: ViewBounds): void {
    this.views.get(id)?.view.setBounds(bounds);
  }

  destroy(id: string): void {
    const record = this.views.get(id);
    if (!record) return;
    this.views.delete(id);
    this.teardown(record.view);
  }

  destroyAll(): void {
    for (const record of this.views.values()) this.teardown(record.view);
    this.views.clear();
  }

  // ---- internals --------------------------------------------------------

  private load(id: string, url: string): void {
    const wc = this.views.get(id)?.view.webContents;
    if (!wc) return;
    if (!isUrlAllowed(url, this.allowlist)) {
      log.warn("blocked navigation to disallowed url", { id, url });
      return;
    }
    // Fire-and-forget: title/loading/can-go-* flow back via the wired events.
    void wc.loadURL(url).catch((error) => {
      log.warn("loadURL failed", { id, url, error });
    });
  }

  private wire(id: string, view: ManagedView): void {
    const wc = view.webContents;
    // Police EVERY navigation the loaded content can trigger against the same
    // scheme + allowlist gate, not just the user/page in-page navigation:
    //   - will-navigate       — page- or user-initiated navigations
    //   - will-redirect       — server-side 30x redirects (an allowlisted page
    //                           could otherwise 302 the view to a blocked host)
    //   - will-frame-navigate — subframe navigations (the allowlist must cover
    //                           ALL loaded web content, frames included)
    // loadURL is policed separately in load(); none of these fire for the
    // main-process load() call itself.
    const guard = (eventName: string): void => {
      wc.on(eventName, (...args) => {
        const event = args[0] as { url: string; preventDefault(): void };
        if (!isUrlAllowed(event.url, this.allowlist)) {
          log.warn("blocked navigation", {
            id,
            event: eventName,
            url: event.url,
          });
          event.preventDefault();
        }
      });
    };
    guard("will-navigate");
    guard("will-redirect");
    guard("will-frame-navigate");
    // Deny every popup / new window inside the embedded view; open an allowed
    // target in the OS browser instead. The view never spawns child windows.
    wc.setWindowOpenHandler(({ url }) => {
      if (isUrlAllowed(url, this.allowlist)) this.openExternal(url);
      return { action: "deny" };
    });
    // Re-emit state on every navigation / title / loading transition.
    const push = (): void => this.emitState(id);
    for (const event of [
      "did-navigate",
      "did-navigate-in-page",
      "page-title-updated",
      "did-start-loading",
      "did-stop-loading",
    ]) {
      wc.on(event, push);
    }
  }

  private attach(view: ManagedView): void {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;
    win.contentView.addChildView(view as unknown as WebContentsView);
  }

  private teardown(view: ManagedView): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      win.contentView.removeChildView(view as unknown as WebContentsView);
    }
    const wc = view.webContents;
    if (!wc.isDestroyed()) {
      wc.stop();
      wc.close();
    }
  }

  private emitState(id: string): void {
    const record = this.views.get(id);
    if (!record) return;
    const state = this.stateOf(id, record.view);
    for (const cb of this.stateListeners) cb(state);
  }

  private stateOf(id: string, view: ManagedView): BrowserViewState {
    const wc = view.webContents;
    return {
      id,
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
    };
  }
}

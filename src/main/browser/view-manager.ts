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
  openDevTools(opts?: {
    mode?: "right" | "bottom" | "undocked" | "detach";
    activate?: boolean;
  }): void;
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

function blockedMessage(allowlist?: readonly string[]): string {
  const hostHint =
    allowlist && allowlist.length > 0
      ? ` and these hosts: ${allowlist.join(", ")}`
      : "";
  return `Blocked navigation. Embedded browser navigation allows only http(s) URLs${hostHint}.`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ViewRecord {
  id: string;
  view: ManagedView;
  error?: string;
}

export class BrowserViewManager {
  private readonly views = new Map<string, ViewRecord>();
  private readonly stateListeners = new Set<
    (state: BrowserViewState) => void
  >();
  private readonly createView: ViewFactory;
  private readonly partition: string;
  private readonly allowlist?: readonly string[];
  private readonly openExternalUrl: (url: string) => void;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    options: BrowserViewManagerOptions = {},
  ) {
    this.createView = options.createView ?? defaultCreateView;
    this.partition = options.partition ?? DEFAULT_PARTITION;
    this.allowlist = options.allowlist;
    this.openExternalUrl = options.openExternal ?? defaultOpenExternal;
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
    const record: ViewRecord = { id, view };
    this.views.set(id, record);
    this.wire(id, view);
    view.setBounds(opts.bounds);
    this.attach(view);
    this.load(id, opts.url);
    return this.stateOf(id, record);
  }

  navigate(id: string, url: string): void {
    this.load(id, url);
  }

  openDevTools(id: string): void {
    this.views.get(id)?.view.webContents.openDevTools({
      mode: "detach",
      activate: true,
    });
  }

  openExternal(id: string): void {
    const record = this.views.get(id);
    const url = record?.view.webContents.getURL();
    if (!record || !url) return;
    if (!isUrlAllowed(url, this.allowlist)) {
      record.error =
        "Cannot open externally. The current browser URL is not an allowed http(s) URL.";
      this.emitState(id);
      return;
    }
    this.openExternalUrl(url);
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
    const record = this.views.get(id);
    if (!record) return;
    record.error = undefined;
    this.emitState(id);
    record.view.webContents.reload();
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
    const record = this.views.get(id);
    const wc = record?.view.webContents;
    if (!record || !wc) return;
    if (url.trim() === "") {
      record.error = undefined;
      this.emitState(id);
      return;
    }
    if (!isUrlAllowed(url, this.allowlist)) {
      record.error = blockedMessage(this.allowlist);
      log.warn("blocked navigation to disallowed url", { id, url });
      this.emitState(id);
      return;
    }
    record.error = undefined;
    this.emitState(id);
    // Fire-and-forget: title/loading/can-go-* flow back via the wired events.
    void wc.loadURL(url).catch((error) => {
      record.error = `Failed to load ${url}: ${messageOf(error)}`;
      log.warn("loadURL failed", { id, url, error });
      this.emitState(id);
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
          const record = this.views.get(id);
          if (record) record.error = blockedMessage(this.allowlist);
          log.warn("blocked navigation", {
            id,
            event: eventName,
            url: event.url,
          });
          event.preventDefault();
          this.emitState(id);
          return;
        }
        const record = this.views.get(id);
        if (record && eventName === "will-navigate") record.error = undefined;
      });
    };
    guard("will-navigate");
    guard("will-redirect");
    guard("will-frame-navigate");
    // Deny every popup / new window inside the embedded view; open an allowed
    // target in the OS browser instead. The view never spawns child windows.
    wc.setWindowOpenHandler(({ url }) => {
      if (isUrlAllowed(url, this.allowlist)) this.openExternalUrl(url);
      return { action: "deny" };
    });
    // Re-emit state on every navigation / title / loading transition.
    const push = (): void => this.emitState(id);
    const clearAndPush = (): void => {
      const record = this.views.get(id);
      if (record) record.error = undefined;
      this.emitState(id);
    };
    for (const event of [
      "did-navigate",
      "did-navigate-in-page",
      "did-start-loading",
    ]) {
      wc.on(event, clearAndPush);
    }
    for (const event of ["page-title-updated", "did-stop-loading"]) {
      wc.on(event, push);
    }
    wc.on(
      "did-fail-load",
      (_event, code, description, _validatedUrl, isMainFrame) => {
        const record = this.views.get(id);
        if (!record || code === -3 || isMainFrame === false) return;
        record.error = `Failed to load current page: ${String(description || "navigation failed")}`;
        this.emitState(id);
      },
    );
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
    const state = this.stateOf(id, record);
    for (const cb of this.stateListeners) cb(state);
  }

  private stateOf(id: string, record: ViewRecord): BrowserViewState {
    const wc = record.view.webContents;
    const state: BrowserViewState = {
      id,
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
    };
    if (record.error) state.error = record.error;
    return state;
  }
}

// Feature 8 — embedded browser panel. The renderer renders ONLY the chrome
// (BrowserChrome) and an empty placeholder div; the actual web page is a
// main-owned, sandboxed `WebContentsView` overlaid on the placeholder rect. The
// main renderer window never loads remote content, so its CSP stays `'self'`.
//
// Off by default (`settings.browser.enabled`). When disabled we show an honest
// enable gate: the embedded browser loads UNTRUSTED remote content in a
// separate sandboxed view — we state the model plainly and never call it
// "secure". On unmount the view is destroyed and the subscription released.

import { Globe, Navigation, ShieldAlert } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { BrowserChrome } from "@/components/browser/BrowserChrome";
import { useBrowserBounds } from "@/components/browser/useBrowserBounds";
import { Button, EmptyState } from "@/components/ui";
import { useBrowserStore } from "@/store/browser";
import { useSettingsStore } from "@/store/settings";

export default function Browser() {
  const enabled = useSettingsStore(
    (s) => s.settings?.browser?.enabled ?? false,
  );
  const updateSettings = useSettingsStore((s) => s.update);

  const viewId = useBrowserStore((s) => s.viewId);
  const state = useBrowserStore((s) => s.state);
  const history = useBrowserStore((s) => s.history);
  const error = useBrowserStore((s) => s.error);
  const ensureSubscribed = useBrowserStore((s) => s.ensureSubscribed);
  const teardown = useBrowserStore((s) => s.teardown);
  const createView = useBrowserStore((s) => s.create);
  const navigate = useBrowserStore((s) => s.navigate);
  const back = useBrowserStore((s) => s.back);
  const forward = useBrowserStore((s) => s.forward);
  const reload = useBrowserStore((s) => s.reload);
  const openDevTools = useBrowserStore((s) => s.openDevTools);
  const openExternal = useBrowserStore((s) => s.openExternal);
  const destroy = useBrowserStore((s) => s.destroy);

  const placeholderRef = useRef<HTMLDivElement>(null);
  useBrowserBounds(viewId, placeholderRef);

  // While this view is mounted (and the capability is on): subscribe to state
  // pushes BEFORE creating, create the main-owned view once the placeholder has
  // a measurable rect, then destroy the view + release the subscription on
  // unmount (route change) or when the capability is turned off.
  useLayoutEffect(() => {
    if (!enabled) return;
    ensureSubscribed();
    const el = placeholderRef.current;
    if (el && !useBrowserStore.getState().viewId) {
      const r = el.getBoundingClientRect();
      void createView({
        // No homepage in v2 (deferred); the view starts blank awaiting input.
        url: "",
        bounds: {
          x: Math.round(r.left),
          y: Math.round(r.top),
          width: Math.round(r.width),
          height: Math.round(r.height),
        },
      });
    }
    return () => {
      destroy();
      teardown();
    };
  }, [enabled, ensureSubscribed, createView, destroy, teardown]);

  if (!enabled) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={<Globe className="h-8 w-8" />}
          title="Embedded browser is off"
          hint={
            <>
              Turning this on loads <strong>untrusted remote web pages</strong>{" "}
              inside OMP Studio. The page runs in a separate, sandboxed view
              with its own ephemeral session — isolated from the app, your
              files, and the OMP bridge — but it can still reach the internet
              and run whatever any web page can. It is not a hardened or{" "}
              {'"secure"'} browser; enable it only if you accept that risk.
            </>
          }
          action={
            <Button
              variant="primary"
              onClick={() =>
                void updateSettings({ browser: { enabled: true } })
              }
            >
              <ShieldAlert className="h-4 w-4" />
              Enable embedded browser
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <BrowserChrome
        state={state}
        history={history}
        onNavigate={navigate}
        onBack={back}
        onForward={forward}
        onReload={reload}
        onOpenDevTools={openDevTools}
        onOpenExternal={openExternal}
      />
      <BrowserPanelState state={state} error={error} />
      {/* Empty overlay target — the main-owned WebContentsView is positioned on
          top of this rect (see useBrowserBounds); no remote content lives here. */}
      <div ref={placeholderRef} className="min-h-0 flex-1" />
    </div>
  );
}

function BrowserPanelState({
  state,
  error,
}: {
  state: { url: string; loading: boolean; error?: string } | null;
  error: string | undefined;
}) {
  if (error) {
    return (
      <div
        role="alert"
        className="border-b border-danger/30 px-4 py-3 text-sm text-danger"
      >
        Browser view failed to start: {error}
      </div>
    );
  }

  if (state?.url || state?.loading || state?.error) return null;

  return (
    <div className="border-b border-border-subtle bg-bg-panel px-4 py-3">
      <div className="flex items-start gap-3 text-sm">
        <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div>
          <p className="font-medium text-ink">Start with an http(s) URL.</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">
            Enter a website above. The page opens in an isolated, ephemeral
            WebContentsView with no preload, Node access, OMP bridge, or agent
            auto-control.
          </p>
        </div>
      </div>
    </div>
  );
}

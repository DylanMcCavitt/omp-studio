// Toolbar for the embedded browser: back / forward / reload, an editable
// address field (free-text → navigate), a Go submit, and a history dropdown.
//
// "Omnibox via Combobox for history": the Combobox primitive is the sanctioned
// filterable picker, but it only SELECTS from a fixed option list — it cannot
// submit arbitrary typed text. A browser must navigate to URLs that aren't in
// history yet, so the editable <input> owns free-text navigation while the
// Combobox surfaces the visited-URL history (selecting one navigates to it).
// All web content is the main-owned sandboxed view; this is just chrome.

import type { BrowserViewState } from "@shared/domain";
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  CornerDownLeft,
  ExternalLink,
  RotateCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Combobox, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";

export interface BrowserChromeProps {
  /** Latest nav state for the live view, or null before one is created. */
  state: BrowserViewState | null;
  /** Visited URLs (most-recent first) backing the history dropdown. */
  history: string[];
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onOpenDevTools: () => void;
  onOpenExternal: () => void;
}

/**
 * Coerce omnibox input into a loadable URL. Main only loads http/https, so a
 * bare host like `example.com` is promoted to `https://`; explicit non-http(s)
 * schemes are rejected with user-facing copy before they reach IPC.
 */
function toUrl(raw: string): { url: string | null; error?: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { url: null };
  if (/^https?:\/\//i.test(trimmed)) return { url: trimmed };
  if (/^[^/\s:]+:\d+(?:[/?#]|$)/.test(trimmed)) {
    return { url: `https://${trimmed}` };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return {
      url: null,
      error:
        "Blocked scheme. Embedded browser navigation allows only http(s) URLs.",
    };
  }
  return { url: `https://${trimmed}` };
}

export function BrowserChrome({
  state,
  history,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onOpenDevTools,
  onOpenExternal,
}: BrowserChromeProps) {
  const [address, setAddress] = useState("");
  const [inputError, setInputError] = useState<string | undefined>();

  // Mirror the committed URL into the address bar, but never clobber an
  // in-progress edit: adopt the live URL only when it actually changes.
  const liveUrl = state?.url ?? "";
  const lastUrl = useRef(liveUrl);
  useEffect(() => {
    if (liveUrl !== lastUrl.current) {
      lastUrl.current = liveUrl;
      setAddress(liveUrl);
    }
  }, [liveUrl]);

  const go = (raw: string) => {
    const next = toUrl(raw);
    setInputError(next.error);
    if (next.url) onNavigate(next.url);
  };

  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex items-center gap-1.5 px-3 py-2">
        <IconButton label="Back" disabled={!state?.canGoBack} onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="Forward"
          disabled={!state?.canGoForward}
          onClick={onForward}
        >
          <ArrowRight className="h-4 w-4" />
        </IconButton>
        <IconButton label="Reload" onClick={onReload}>
          <RotateCw
            className={cn("h-4 w-4", state?.loading && "animate-spin")}
          />
        </IconButton>
        <IconButton
          label="Open current page externally"
          disabled={!state?.url}
          onClick={onOpenExternal}
        >
          <ExternalLink className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="Open browser DevTools"
          disabled={!state}
          onClick={onOpenDevTools}
        >
          <Bug className="h-4 w-4" />
        </IconButton>

        <form
          className="flex min-w-0 flex-1 items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            go(address);
          }}
        >
          <input
            aria-label="Address"
            value={address}
            onChange={(e) => {
              setInputError(undefined);
              setAddress(e.target.value);
            }}
            placeholder="Enter an http(s) URL"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className={cn(
              "min-w-0 flex-1 rounded-lg border border-border-subtle bg-bg-raised px-3 py-1.5 text-sm text-ink",
              "placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              inputError && "border-danger/60",
            )}
          />
          <IconButton type="submit" label="Go">
            <CornerDownLeft className="h-4 w-4" />
          </IconButton>
        </form>

        {history.length > 0 && (
          <Combobox
            aria-label="History"
            className="w-44"
            align="end"
            value=""
            options={history.map((url) => ({ value: url, label: url }))}
            onChange={(url) => {
              setAddress(url);
              go(url);
            }}
            placeholder="History"
            searchPlaceholder="Search history…"
            emptyText="No history"
          />
        )}
      </div>
      {state?.loading && (
        <div role="status" className="px-3 pb-2 text-xs text-ink-muted">
          Loading page…
        </div>
      )}
      {(inputError || state?.error) && (
        <div role="alert" className="px-3 pb-2 text-xs text-danger">
          {inputError ?? state?.error}
        </div>
      )}
    </div>
  );
}

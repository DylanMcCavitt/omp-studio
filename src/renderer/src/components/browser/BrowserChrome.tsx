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
import { ArrowLeft, ArrowRight, CornerDownLeft, RotateCw } from "lucide-react";
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
}

/**
 * Coerce omnibox input into a loadable URL. Main only loads http/https, so a
 * bare host like `example.com` is promoted to `https://`; blank input is
 * rejected (returns null) rather than navigating nowhere.
 */
function toUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function BrowserChrome({
  state,
  history,
  onNavigate,
  onBack,
  onForward,
  onReload,
}: BrowserChromeProps) {
  const [address, setAddress] = useState("");

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
    const url = toUrl(raw);
    if (url) onNavigate(url);
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2">
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
        <RotateCw className={cn("h-4 w-4", state?.loading && "animate-spin")} />
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
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Enter a URL"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className={cn(
            "min-w-0 flex-1 rounded-lg border border-border-subtle bg-bg-raised px-3 py-1.5 text-sm text-ink",
            "placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
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
  );
}

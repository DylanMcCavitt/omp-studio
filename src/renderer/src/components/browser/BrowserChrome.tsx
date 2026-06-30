// Chrome for the embedded browser: tab strip, back / forward / reload, an
// editable address field (free-text → navigate), a Go submit, and history.
//
// "Omnibox via Combobox for history": the Combobox primitive is the sanctioned
// filterable picker, but it only SELECTS from a fixed option list — it cannot
// submit arbitrary typed text. A browser must navigate to URLs that aren't in
// history yet, so the editable <input> owns free-text navigation while the
// Combobox surfaces the visited-URL history (selecting one navigates to it).
// All web content is the main-owned sandboxed view; this is just chrome.

import type { BrowserViewState } from "@shared/domain";
import type { BrowserBookmark, BrowserHistoryEntry } from "@shared/ipc";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Bug,
  CornerDownLeft,
  ExternalLink,
  Plus,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Combobox, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  loading: boolean;
}

const TAB_BASE =
  "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
const TAB_ACTIVE = "bg-bg-hover text-ink";
const TAB_INACTIVE = "text-ink-muted hover:bg-bg-hover/60 hover:text-ink";

export interface BrowserChromeProps {
  /** Open browser tabs mirrored from the store. */
  tabs: BrowserTab[];
  /** Active browser tab id. */
  activeTabId: string | null;
  /** Latest nav state for the active view, or null before one is created. */
  state: BrowserViewState | null;
  /** Visited URLs (most-recent first) backing the history dropdown. */
  history: BrowserHistoryEntry[];
  /** Explicit bookmarks persisted in settings metadata. */
  bookmarks: BrowserBookmark[];
  onCreateTab: () => void;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onOpenDevTools: () => void;
  onOpenExternal: () => void;
  onSaveBookmark: () => void;
  onRemoveBookmark: () => void;
  onClearMetadata: () => void;
  isCurrentBookmarked: boolean;
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
  tabs,
  activeTabId,
  state,
  history,
  bookmarks,
  onCreateTab,
  onSwitchTab,
  onCloseTab,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onOpenDevTools,
  onOpenExternal,
  onSaveBookmark,
  onRemoveBookmark,
  onClearMetadata,
  isCurrentBookmarked,
}: BrowserChromeProps) {
  const [address, setAddress] = useState("");
  const [inputError, setInputError] = useState<string | undefined>();

  // Mirror the committed URL into the address bar, but never clobber an
  // in-progress edit within the same tab. A tab switch is different: always
  // adopt the new active tab's current URL and clear local validation state,
  // even when both tabs are blank.
  const liveUrl = state?.url ?? "";
  const lastUrl = useRef(liveUrl);
  const lastActiveTabId = useRef(activeTabId);
  useEffect(() => {
    if (activeTabId !== lastActiveTabId.current) {
      lastActiveTabId.current = activeTabId;
      lastUrl.current = liveUrl;
      setAddress(liveUrl);
      setInputError(undefined);
      return;
    }

    if (liveUrl !== lastUrl.current) {
      lastUrl.current = liveUrl;
      setAddress(liveUrl);
    }
  }, [activeTabId, liveUrl]);

  const go = (raw: string) => {
    const next = toUrl(raw);
    setInputError(next.error);
    if (next.url) onNavigate(next.url);
  };

  const hasCurrentUrl = Boolean(state?.url);
  const hasMetadata = bookmarks.length > 0 || history.length > 0;
  const bookmarkLabel = isCurrentBookmarked
    ? "Remove current page bookmark"
    : "Save current page bookmark";
  const bookmarkOptions = bookmarks.map((entry) => ({
    value: entry.url,
    label: entry.title || entry.url,
    description: entry.url,
  }));
  const historyOptions = history.map((entry) => ({
    value: entry.url,
    label: entry.title || entry.url,
    description: entry.url,
  }));

  return (
    <div className="shrink-0 border-b border-border">
      <div
        role="tablist"
        aria-label="Browser tabs"
        className="flex h-9 items-center gap-0.5 overflow-x-auto border-b border-border-subtle bg-bg-raised px-1.5"
      >
        {tabs.map((tab, index) => {
          const label = tab.title || tab.url || "New tab";
          const position = index + 1;
          const active = tab.id === activeTabId;
          return (
            <div key={tab.id} className="relative flex shrink-0 items-stretch">
              <button
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`Tab ${position}: ${label}`}
                title={tab.url || label}
                onClick={() => onSwitchTab(tab.id)}
                className={cn(
                  TAB_BASE,
                  "pr-7",
                  active ? TAB_ACTIVE : TAB_INACTIVE,
                )}
              >
                <span className="max-w-[11rem] truncate">{label}</span>
                {tab.loading && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                )}
              </button>
              <button
                type="button"
                aria-label={`Close tab ${position}: ${label}`}
                onClick={() => onCloseTab(tab.id)}
                className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-ink-faint transition-colors hover:bg-bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          aria-label="New browser tab"
          onClick={onCreateTab}
          className={cn(TAB_BASE, TAB_INACTIVE)}
        >
          <Plus size={14} className="shrink-0" />
        </button>
      </div>
      <div className="flex items-center gap-1.5 px-3 pt-2">
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
        <IconButton label="Reload" disabled={!state} onClick={onReload}>
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
        <IconButton
          label={bookmarkLabel}
          disabled={!hasCurrentUrl}
          onClick={isCurrentBookmarked ? onRemoveBookmark : onSaveBookmark}
        >
          {isCurrentBookmarked ? (
            <BookmarkCheck className="h-4 w-4" />
          ) : (
            <Bookmark className="h-4 w-4" />
          )}
        </IconButton>
        <IconButton
          label="Clear browser bookmarks and history metadata"
          disabled={!hasMetadata}
          onClick={onClearMetadata}
        >
          <Trash2 className="h-4 w-4" />
        </IconButton>

        <form
          className="flex min-w-0 flex-1 items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (state) go(address);
          }}
        >
          <input
            aria-label="Address"
            value={address}
            onChange={(e) => {
              setInputError(undefined);
              setAddress(e.target.value);
            }}
            placeholder={
              state ? "Enter an http(s) URL" : "Open a new tab first"
            }
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            disabled={!state}
            className={cn(
              "min-w-0 flex-1 rounded-lg border border-border-subtle bg-bg-raised px-3 py-1.5 text-sm text-ink",
              "placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              inputError && "border-danger/60",
            )}
          />
          <IconButton type="submit" label="Go" disabled={!state}>
            <CornerDownLeft className="h-4 w-4" />
          </IconButton>
        </form>
      </div>

      <div className="flex justify-end gap-1.5 px-3 py-2">
        <Combobox
          aria-label="Bookmarks"
          className="w-44"
          align="end"
          value=""
          options={bookmarkOptions}
          disabled={!state || bookmarkOptions.length === 0}
          onChange={(url) => {
            setAddress(url);
            go(url);
          }}
          placeholder="Bookmarks"
          searchPlaceholder="Search bookmarks…"
          emptyText="No bookmarks"
        />
        <Combobox
          aria-label="Recent pages"
          className="w-44"
          align="end"
          value=""
          options={historyOptions}
          disabled={!state || historyOptions.length === 0}
          onChange={(url) => {
            setAddress(url);
            go(url);
          }}
          placeholder="Recent pages"
          searchPlaceholder="Search recent pages…"
          emptyText="No recent pages"
        />
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

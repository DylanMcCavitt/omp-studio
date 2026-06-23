// Non-blocking surfaces for the passive UI-request methods. Hints (notify/
// setStatus/setWidget/setTitle/set_editor_text) appear as auto-dismissing
// toasts; open_url renders a persistent banner that opens the URL only on an
// explicit click (the renderer's explicit-action guard; main guards too). None
// of these block the agent — they are fire-and-forget on the wire.

import type { ChatUiRequestEvent } from "@shared/ipc";
import type { ExtensionUiRequest } from "@shared/rpc";
import { ExternalLink, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { asString } from "./logic";

const HINT_DURATION_MS = 6000;

type HintTone = "info" | "warn" | "danger";

interface HintDisplay {
  tone: HintTone;
  title: string;
  body?: string;
}

/** Map a hint request to its toast tone + text from structured fields only. */
function hintDisplay(req: ExtensionUiRequest): HintDisplay {
  switch (req.method) {
    case "notify": {
      const notifyType = asString(req.notifyType);
      const tone: HintTone =
        notifyType === "error"
          ? "danger"
          : notifyType === "warning"
            ? "warn"
            : "info";
      return { tone, title: asString(req.message) ?? "Notification" };
    }
    case "setStatus":
      return {
        tone: "info",
        title: asString(req.statusKey) ?? "Status",
        body: asString(req.statusText),
      };
    case "setWidget": {
      const lines = Array.isArray(req.widgetLines)
        ? req.widgetLines.filter((l): l is string => typeof l === "string")
        : [];
      return {
        tone: "info",
        title: asString(req.widgetKey) ?? "Widget",
        body: lines.join("\n") || undefined,
      };
    }
    case "setTitle":
      return { tone: "info", title: asString(req.title) ?? "Title updated" };
    case "set_editor_text":
      return {
        tone: "info",
        title: "Editor text set by agent",
        body: asString(req.text),
      };
    default:
      return { tone: "info", title: asString(req.message) ?? req.method };
  }
}

const TONE_CLASS: Record<HintTone, string> = {
  info: "border-border bg-bg-panel",
  warn: "border-warn/40 bg-warn/10",
  danger: "border-danger/40 bg-danger/10",
};

const TONE_DOT: Record<HintTone, string> = {
  info: "bg-accent",
  warn: "bg-warn",
  danger: "bg-danger",
};

export interface UiHintsProps {
  hints: ChatUiRequestEvent[];
  openUrls: ChatUiRequestEvent[];
  /** Dequeue a hint/open_url from the session queue (no response written). */
  onDismiss(requestId: string): void;
  /** Open the URL externally, then dequeue. */
  onOpenUrl(url: string, requestId: string): void;
}

export function UiHints({
  hints,
  openUrls,
  onDismiss,
  onOpenUrl,
}: UiHintsProps) {
  if (hints.length === 0 && openUrls.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-80 flex-col gap-2">
      {openUrls.map((event) => (
        <OpenUrlBanner
          key={event.request.id}
          request={event.request}
          onOpen={onOpenUrl}
          onDismiss={onDismiss}
        />
      ))}
      {hints.map((event) => (
        <HintToast
          key={event.request.id}
          request={event.request}
          onDismiss={onDismiss}
        />
      ))}
    </div>,
    document.body,
  );
}

function HintToast({
  request,
  onDismiss,
}: {
  request: ExtensionUiRequest;
  onDismiss(requestId: string): void;
}) {
  const { tone, title, body } = hintDisplay(request);

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(request.id), HINT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [request.id, onDismiss]);

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto animate-fade-in rounded-lg border px-3 py-2 shadow-panel",
        TONE_CLASS[tone],
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
            TONE_DOT[tone],
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium text-ink">{title}</p>
          {body && (
            <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-xs text-ink-muted">
              {body}
            </p>
          )}
        </div>
        <IconButton
          label="Dismiss"
          className="-mr-1 -mt-0.5 h-6 w-6"
          onClick={() => onDismiss(request.id)}
        >
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

function OpenUrlBanner({
  request,
  onOpen,
  onDismiss,
}: {
  request: ExtensionUiRequest;
  onOpen(url: string, requestId: string): void;
  onDismiss(requestId: string): void;
}) {
  const url = asString(request.url);
  const instructions = asString(request.instructions);
  if (!url) return null;

  return (
    <div className="pointer-events-auto animate-fade-in rounded-lg border border-accent/40 bg-bg-panel px-3 py-2.5 shadow-panel">
      <div className="flex items-start gap-2">
        <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">
            {instructions ?? "The agent wants to open a link"}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-muted" title={url}>
            {url}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => onOpen(url, request.id)}
            >
              Open link
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDismiss(request.id)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

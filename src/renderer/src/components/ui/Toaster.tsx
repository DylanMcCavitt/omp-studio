// Renders the active toast notifications (from the toast store) in a fixed
// bottom-right stack via a portal, and owns per-toast auto-dismiss timing. Toasts
// are transient progress/error feedback — never a blocking spinner. Mounted once
// in Layout so notifications survive route changes.

import {
  CircleAlert,
  CircleCheck,
  Info,
  type LucideIcon,
  X,
} from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { type Toast, type ToastKind, useToastStore } from "@/store/toast";

const ICON: Record<ToastKind, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  error: CircleAlert,
};

const ACCENT: Record<ToastKind, string> = {
  info: "text-accent",
  success: "text-success",
  error: "text-danger",
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (toast.duration <= 0) return;
    const t = setTimeout(onDismiss, toast.duration);
    return () => clearTimeout(t);
  }, [toast.duration, onDismiss]);

  const Icon = ICON[toast.kind];
  return (
    <div
      role="status"
      className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border bg-bg-panel p-3 shadow-panel"
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", ACCENT[toast.kind])} />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium text-ink">
          {toast.title}
        </p>
        {toast.detail && (
          <p className="mt-0.5 break-words text-xs text-ink-muted">
            {toast.detail}
          </p>
        )}
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              onDismiss();
            }}
            className="mt-1.5 rounded text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
        className="rounded p-0.5 text-ink-faint transition-colors hover:bg-bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (typeof document === "undefined") return null;
  return createPortal(
    <section
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </section>,
    document.body,
  );
}

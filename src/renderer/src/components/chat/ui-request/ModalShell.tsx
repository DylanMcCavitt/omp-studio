// Shared scaffolding for the four blocking UI-request dialogs (confirm/select/
// input/editor). Owns the accessibility the assignment calls for (role=dialog,
// aria-modal, labelled title+description, Esc to dismiss, Cmd/Ctrl+Enter for the
// primary action) and renders through a portal so the overlay escapes any
// transformed ancestor. Focus behaviour — focus the default action on open, trap
// Tab within, restore focus to the trigger on close — comes from the shared
// useFocusTrap hook so every dialog inherits one implementation.

import { type ReactNode, useId } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/lib/useFocusTrap";

export interface ModalShellProps {
  title: string;
  /** Optional supporting prose shown under the title and used as aria-describedby. */
  message?: string;
  /** Esc routes here (deny / cancel). */
  onDismiss(): void;
  /** Cmd/Ctrl+Enter primary action (approve / submit). */
  onSubmit?(): void;
  /** Body content (option list, input, textarea). */
  children?: ReactNode;
  /** Action buttons, right-aligned in the footer. */
  footer: ReactNode;
  /** A small badge/label shown in the header. */
  kicker?: ReactNode;
}

export function ModalShell({
  title,
  message,
  onDismiss,
  onSubmit,
  children,
  footer,
  kicker,
}: ModalShellProps) {
  const panelRef = useFocusTrap<HTMLDivElement>();
  const titleId = useId();
  const descId = useId();

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
      return;
    }
    if (onSubmit && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onSubmit();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop: dims the app but does NOT dismiss on click — a blocking
          approval requires an explicit Deny/Cancel or Esc, never a stray click. */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px]" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? descId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          "relative w-full max-w-md animate-fade-in rounded-xl border border-border",
          "bg-bg-panel shadow-panel focus:outline-none",
        )}
      >
        <div className="border-b border-border-subtle px-5 py-3.5">
          {kicker && <div className="mb-1.5">{kicker}</div>}
          <h2 id={titleId} className="text-sm font-semibold text-ink">
            {title}
          </h2>
          {message && (
            <p
              id={descId}
              className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-muted"
            >
              {message}
            </p>
          )}
        </div>
        {children && <div className="px-5 py-4">{children}</div>}
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { X } from "lucide-react";
import type { KeyboardEvent, PointerEvent } from "react";
import { useId } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "@/components/ui";
import { useFocusTrap } from "@/lib/useFocusTrap";
import Settings from "@/views/Settings";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useFocusTrap<HTMLDivElement>();
  const titleId = useId();

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  const onBackdropPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    onClose();
  };

  return createPortal(
    <div
      data-testid="settings-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onPointerDown={onBackdropPointerDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex h-[min(780px,calc(100vh-2rem))] w-[min(1040px,calc(100vw-2rem))] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-panel focus:outline-none"
      >
        <Settings
          titleId={titleId}
          toolbarEnd={
            <IconButton
              label="Close Settings"
              onClick={onClose}
              data-autofocus
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </IconButton>
          }
        />
      </div>
    </div>,
    document.body,
  );
}

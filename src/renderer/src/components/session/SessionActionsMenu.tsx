// Shared overflow menu of session-management actions, used by BOTH the live
// SessionRail rows and the historical Sessions detail header. Each caller passes
// a `target` describing the session; the menu adapts which actions it shows and
// routes every file action through `window.omp.session.*` on the JSONL path:
//
//   • Rename   — studio display alias (no JSONL rewrite); both surfaces.
//   • Close    — live only; disposes the child, transcript untouched. Delegated
//                via `onClose` so the rail's streaming-confirm stays the single
//                close path (Close ≠ Delete).
//   • Export   — `session.exportHtml` then reveals the produced file.
//   • Reveal   — host file manager.
//   • Archive / Unarchive — historical only (moves the JSONL between roots).
//   • Delete   — confirm → OS trash (recoverable). On a live session the child
//                is disposed first so the file is no longer held open.
//
// Progress and errors surface as toasts, never a blocking spinner. The dropdown
// renders through a portal (fixed-positioned, viewport-flipped) so it is never
// clipped by the rail's scroll container.

import {
  Archive,
  ArchiveRestore,
  FileDown,
  FolderOpen,
  type LucideIcon,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { RenameSessionDialog } from "@/components/session/RenameSessionDialog";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useChatStore } from "@/store/chat";
import { toast } from "@/store/toast";

/** Describes the session a menu instance acts on. */
export interface SessionActionTarget {
  /** Absolute JSONL path the file actions operate on (undefined until known). */
  path?: string;
  /** Current display title (alias or omp/header title). */
  title: string | null;
  /** Whether the session lives in the archive root (historical only). */
  archived: boolean;
  /** Present for a live session — enables live-specific semantics. */
  liveSessionId?: string;
}

/** What changed, so the caller can refresh its list/detail accordingly. */
export type SessionActionResult =
  | { kind: "renamed"; title: string }
  | { kind: "deleted" }
  | { kind: "archived" }
  | { kind: "unarchived" };

export interface SessionActionsMenuProps {
  target: SessionActionTarget;
  /** Notified after a listing-affecting change so the caller can refresh. */
  onChanged?: (result: SessionActionResult) => void;
  /**
   * Live-only: invoked for the Close action. Provided by the rail so the
   * existing streaming-confirm close path is reused rather than duplicated.
   */
  onClose?: () => void;
  /** Sizing/positioning classes for the trigger button. */
  className?: string;
  /**
   * Tab-order index for the trigger. The rail passes -1 so the row is a single
   * roving Tab stop (the trigger stays mouse-clickable and focusable on demand);
   * other callers leave it in the natural tab order.
   */
  triggerTabIndex?: number;
}

interface MenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function SessionActionsMenu({
  target,
  onChanged,
  onClose,
  className,
  triggerTabIndex,
}: SessionActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const path = target.path;
  const label = target.title?.trim() || "session";
  const isLive = target.liveSessionId !== undefined;

  const closeMenu = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  // Position the portal menu under the trigger, flipping above when it would
  // overflow the viewport, and clamping horizontally. Runs before paint so the
  // menu never flashes at its initial (0,0) position.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const r = trigger.getBoundingClientRect();
    const mh = menu.offsetHeight;
    const mw = menu.offsetWidth;
    const gap = 4;
    const margin = 8;
    let top = r.bottom + gap;
    if (top + mh > window.innerHeight - margin) {
      top = Math.max(margin, r.top - gap - mh);
    }
    let left = r.right - mw;
    left = Math.max(margin, Math.min(left, window.innerWidth - mw - margin));
    setCoords({ top, left });
  }, [open]);

  // Move focus into the menu on open (keyboard-operable).
  useEffect(() => {
    if (!open) return;
    const first =
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
  }, [open]);

  // Dismiss on outside click, scroll, or resize (avoids a stale position).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) {
        return;
      }
      setOpen(false);
    }
    function onReflow() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open]);

  const revealPath = useCallback((p: string) => {
    void window.omp.session
      .reveal(p)
      .catch((e) =>
        toast.error("Couldn't reveal file", { detail: errorMessage(e) }),
      );
  }, []);

  const runExport = useCallback(
    async (p: string) => {
      const id = toast.info("Exporting transcript to HTML…", { duration: 0 });
      try {
        const out = await window.omp.session.exportHtml(p);
        toast.dismiss(id);
        toast.success("Exported transcript to HTML", {
          action: { label: "Reveal", onClick: () => revealPath(out) },
        });
        revealPath(out);
      } catch (e) {
        toast.dismiss(id);
        toast.error("Export failed", { detail: errorMessage(e) });
      }
    },
    [revealPath],
  );

  const runListingChange = useCallback(
    async (
      op: () => Promise<void>,
      success: string,
      result: SessionActionResult,
      failTitle: string,
    ) => {
      try {
        await op();
        toast.success(success);
        onChanged?.(result);
      } catch (e) {
        toast.error(failTitle, { detail: errorMessage(e) });
      }
    },
    [onChanged],
  );

  const runRename = useCallback(
    async (title: string) => {
      if (!path) return;
      try {
        await window.omp.session.rename(path, title);
        toast.success(title ? `Renamed to “${title}”` : "Cleared session name");
        onChanged?.({ kind: "renamed", title });
      } catch (e) {
        toast.error("Rename failed", { detail: errorMessage(e) });
        throw e; // keep the dialog open so the user can retry
      }
    },
    [path, onChanged],
  );

  const runDelete = useCallback(async () => {
    if (!path) return;
    try {
      if (target.liveSessionId) {
        // Dispose the live child first so the JSONL is no longer held open.
        await useChatStore.getState().closeSession(target.liveSessionId);
      }
      await window.omp.session.delete(path);
      toast.success(`Moved “${label}” to the Trash`);
      onChanged?.({ kind: "deleted" });
    } catch (e) {
      toast.error("Delete failed", { detail: errorMessage(e) });
    }
  }, [path, label, target.liveSessionId, onChanged]);

  // Build the action list for this target. `path` gates the file actions;
  // Close is live-only; Archive/Unarchive are historical-only.
  const top: MenuItem[] = [];
  if (path) {
    top.push({
      key: "rename",
      label: "Rename…",
      icon: Pencil,
      onSelect: () => {
        closeMenu(false);
        setRenaming(true);
      },
    });
  }
  if (onClose) {
    top.push({
      key: "close",
      label: "Close session",
      icon: X,
      onSelect: () => {
        closeMenu(false);
        onClose();
      },
    });
  }

  const mid: MenuItem[] = [];
  if (path) {
    mid.push({
      key: "export",
      label: "Export HTML…",
      icon: FileDown,
      onSelect: () => {
        closeMenu(true);
        void runExport(path);
      },
    });
    mid.push({
      key: "reveal",
      label: "Reveal in file manager",
      icon: FolderOpen,
      onSelect: () => {
        closeMenu(true);
        revealPath(path);
      },
    });
    if (!isLive && !target.archived) {
      mid.push({
        key: "archive",
        label: "Archive",
        icon: Archive,
        onSelect: () => {
          closeMenu(true);
          void runListingChange(
            () => window.omp.session.archive(path),
            `Archived “${label}”`,
            { kind: "archived" },
            "Archive failed",
          );
        },
      });
    }
    if (!isLive && target.archived) {
      mid.push({
        key: "unarchive",
        label: "Unarchive",
        icon: ArchiveRestore,
        onSelect: () => {
          closeMenu(true);
          void runListingChange(
            () => window.omp.session.unarchive(path),
            `Unarchived “${label}”`,
            { kind: "unarchived" },
            "Unarchive failed",
          );
        },
      });
    }
  }

  const bottom: MenuItem[] = [];
  if (path) {
    bottom.push({
      key: "delete",
      label: "Delete…",
      icon: Trash2,
      danger: true,
      onSelect: () => {
        closeMenu(false);
        setConfirmingDelete(true);
      },
    });
  }

  const groups = [top, mid, bottom].filter((g) => g.length > 0);

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ) ?? [],
    );
    if (items.length === 0) return;
    const len = items.length;
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        items[(idx + 1 + len) % len]?.focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        items[(idx - 1 + len) % len]?.focus();
        break;
      case "Home":
        e.preventDefault();
        items[0]?.focus();
        break;
      case "End":
        e.preventDefault();
        items[len - 1]?.focus();
        break;
      case "Escape":
        e.preventDefault();
        closeMenu(true);
        break;
      case "Tab":
        closeMenu(false);
        break;
      default:
        break;
    }
  }

  if (groups.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        tabIndex={triggerTabIndex}
        aria-label="Session actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn(
          "inline-flex items-center justify-center rounded-md text-ink-faint transition-colors",
          "hover:bg-bg-hover hover:text-ink",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          className,
        )}
      >
        <MoreHorizontal size={16} />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Session actions"
            onKeyDown={onMenuKeyDown}
            style={{ top: coords.top, left: coords.left }}
            className="fixed z-[55] w-56 overflow-hidden rounded-lg border border-border bg-bg-panel py-1 shadow-panel"
          >
            {groups.map((group, gi) => (
              <div
                key={group[0]?.key ?? gi}
                className={cn(
                  gi > 0 && "mt-1 border-t border-border-subtle pt-1",
                )}
              >
                {group.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      role="menuitem"
                      onClick={item.onSelect}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors focus:outline-none",
                        item.danger
                          ? "text-danger hover:bg-danger/10 focus:bg-danger/10"
                          : "text-ink hover:bg-bg-hover focus:bg-bg-hover",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 opacity-80" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body,
        )}

      {renaming && (
        <RenameSessionDialog
          initialTitle={target.title}
          onSubmit={runRename}
          onClose={() => {
            setRenaming(false);
            triggerRef.current?.focus();
          }}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete session"
          message={
            isLive
              ? `Close “${label}” and move its transcript to the Trash? You can restore it from the Trash.`
              : `Move “${label}” to the Trash? You can restore it from the Trash.`
          }
          confirmLabel="Delete"
          onConfirm={runDelete}
          onClose={() => {
            setConfirmingDelete(false);
            triggerRef.current?.focus();
          }}
        />
      )}
    </>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        tabIndex={-1}
        className="w-full max-w-md rounded-xl border border-danger/40 bg-bg-panel p-5 shadow-panel focus:outline-none"
      >
        <div className="mb-3 flex items-center gap-2 text-danger">
          <Trash2 className="h-5 w-5 shrink-0" />
          <h2 id="confirm-title" className="text-sm font-semibold">
            {title}
          </h2>
        </div>
        <p id="confirm-message" className="mb-5 text-sm text-ink-muted">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy ? "Deleting…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

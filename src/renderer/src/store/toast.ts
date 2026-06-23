// Lightweight, imperative toast notifications for transient progress + error
// feedback (session actions, exports, …). A tiny zustand store holds the active
// toasts; the <Toaster> surface (mounted once in Layout) renders them and owns
// auto-dismiss timing. Call sites use the `toast` helper:
//
//   toast.success("Renamed session");
//   toast.error("Export failed", { detail: err.message });
//   toast.info("Exported transcript", { action: { label: "Reveal", onClick } });
//
// This is intentionally separate from the protocol-driven UI-hint surface (which
// reacts to a session's extension_ui_request queue); converging the two is a
// later concern.

import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  /** Optional secondary line (e.g. an error detail). */
  detail?: string;
  /** Optional inline action button (e.g. "Reveal"). */
  action?: ToastAction;
  /** Ms before auto-dismiss; 0 keeps it until dismissed. */
  duration: number;
}

export interface ToastInput {
  kind?: ToastKind;
  title: string;
  detail?: string;
  action?: ToastAction;
  duration?: number;
}

/** Default dwell per kind; errors linger longer (and usually carry a detail). */
const DEFAULT_DURATION: Record<ToastKind, number> = {
  info: 4000,
  success: 3500,
  error: 8000,
};

let counter = 0;
function nextId(): string {
  counter += 1;
  return `toast-${counter}`;
}

interface ToastState {
  toasts: Toast[];
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (input) => {
    const kind = input.kind ?? "info";
    const id = nextId();
    const next: Toast = {
      id,
      kind,
      title: input.title,
      detail: input.detail,
      action: input.action,
      duration: input.duration ?? DEFAULT_DURATION[kind],
    };
    set((s) => ({ toasts: [...s.toasts, next] }));
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

type ToastOpts = Omit<ToastInput, "title" | "kind">;

/** Imperative entry points used across the app for transient feedback. */
export const toast = {
  info: (title: string, opts: ToastOpts = {}) =>
    useToastStore.getState().push({ ...opts, kind: "info", title }),
  success: (title: string, opts: ToastOpts = {}) =>
    useToastStore.getState().push({ ...opts, kind: "success", title }),
  error: (title: string, opts: ToastOpts = {}) =>
    useToastStore.getState().push({ ...opts, kind: "error", title }),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
};

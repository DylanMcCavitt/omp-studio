// The single global keyboard-shortcut manager (G2). Wired once from App so there
// is exactly ONE window keydown listener for studio chords — the per-component
// listeners that used to own Cmd+K (GlobalSearch), Cmd+W (ChatWorkspace), and
// Cmd+Shift+P (PromptComposer) were removed and routed through here + the ui
// store so nothing double-fires.
//
// Shortcut map:
//   Cmd/Ctrl+T or N    new chat
//   Cmd/Ctrl+W         close the active session (confirm if streaming)
//   Cmd/Ctrl+1..9      switch to the Nth open session
//   Cmd/Ctrl+K         toggle the navigation palette
//   Cmd/Ctrl+Shift+F   toggle global search
//   Cmd/Ctrl+Shift+P   toggle the slash-command palette
//   Esc                close the topmost soft overlay (nav palette / global search)
//
// While focus is in a text-entry field (input/textarea/contenteditable) the app
// chords are suppressed so a chord pressed mid-draft (Cmd+W, Cmd+T, …) never
// discards the user's typing — only Esc acts from a field, closing the topmost
// overlay. Likewise, while a *blocking* modal (approval/compact/rename/confirm/
// danger) owns the screen the chords are suppressed so a reflexive press never
// mutates sessions behind a safety prompt.

import { useEffect } from "react";
import { closeSessionWithConfirm } from "@/components/chat/SessionList";
import { useChatStore } from "@/store/chat";
import { useUiStore } from "@/store/ui";

/**
 * A blocking modal is open. The soft overlays (global search, the nav palette)
 * are also `aria-modal` but are tagged `data-search-overlay` / `data-nav-overlay`
 * and excluded — they are soft overlays the chords may still toggle.
 */
function blockingModalOpen(): boolean {
  return (
    document.querySelector(
      '[aria-modal="true"]:not([data-search-overlay]):not([data-nav-overlay])',
    ) !== null
  );
}

/**
 * Focus is in a text-entry control. App chords are suppressed here so a chord
 * pressed mid-draft (Cmd+W, Cmd+T, etc.) never discards the user's typing — only
 * Esc (handled before this check) acts from a field, to close the topmost overlay.
 */
function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Esc closes the topmost soft overlay we own (nav palette first, then
      // global search). Blocking dialogs and the slash palette handle their own.
      if (e.key === "Escape") {
        const ui = useUiStore.getState();
        if (ui.navPaletteOpen) {
          e.preventDefault();
          ui.closeNavPalette();
        } else if (ui.searchOpen) {
          e.preventDefault();
          ui.closeSearch();
        }
        return;
      }

      if (!(e.metaKey || e.ctrlKey)) return; // bare keys are typing, not chords
      if (isEditableTarget(document.activeElement)) return; // typing — only Esc
      if (blockingModalOpen()) return; // the modal owns the keyboard

      const chat = useChatStore.getState();
      const ui = useUiStore.getState();

      // Cmd/Ctrl+Shift+P — slash-command palette (consumed by the active composer).
      if (e.shiftKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        ui.requestSlashPalette();
        return;
      }
      // Cmd/Ctrl+Shift+F — global full-text search overlay.
      if (e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        ui.toggleSearch();
        return;
      }
      if (e.shiftKey) return; // no other Shift chords are bound

      switch (e.key) {
        case "t":
        case "T":
        case "n":
        case "N":
          e.preventDefault();
          chat.newChat();
          return;
        case "w":
        case "W": {
          const id = chat.activeSessionId;
          if (!id) return;
          e.preventDefault();
          closeSessionWithConfirm(id);
          return;
        }
        case "k":
        case "K":
          e.preventDefault();
          ui.toggleNavPalette();
          return;
        default:
          // Cmd/Ctrl+1..9 — switch to the Nth open (live) session.
          if (e.key >= "1" && e.key <= "9") {
            const target = Object.keys(chat.openSessions)[Number(e.key) - 1];
            if (!target) return;
            e.preventDefault();
            chat.openChat(target);
          }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

// The single global keyboard-shortcut manager (G2). Wired once from App so there
// is exactly ONE window keydown listener for studio chords. Defaults live in
// lib/keybindings; user overrides are read from settings on each keydown so
// remaps apply immediately without remounting this listener.
//
// Default shortcut map:
//   Cmd/Ctrl+T or N    new chat
//   Cmd/Ctrl+W         close the active session (confirm if streaming)
//   Cmd/Ctrl+1..9      switch to the Nth open session
//   Cmd/Ctrl+B         toggle the left sidebar
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
import { resolveShortcutAction } from "@/lib/keybindings";
import { useChatStore } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";
import { useShellStore } from "@/store/shell";
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
      const action = resolveShortcutAction(
        e,
        useSettingsStore.getState().settings?.keybindings,
      );
      if (!action) return;

      // Close the topmost soft overlay we own (nav palette first, then global
      // search). Blocking dialogs and the slash palette handle their own.
      if (action === "closeOverlay") {
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

      if (isEditableTarget(document.activeElement)) return; // typing — only Esc
      if (blockingModalOpen()) return; // the modal owns the keyboard

      const chat = useChatStore.getState();
      const ui = useUiStore.getState();

      switch (action) {
        case "newChat":
          e.preventDefault();
          chat.newChat();
          return;
        case "closeSession": {
          const id = chat.activeSessionId;
          if (!id) return;
          e.preventDefault();
          closeSessionWithConfirm(id);
          return;
        }
        case "toggleSidebar":
          e.preventDefault();
          useShellStore.getState().toggleSidebar();
          return;
        case "toggleNavPalette":
          e.preventDefault();
          ui.toggleNavPalette();
          return;
        case "toggleSearch":
          e.preventDefault();
          ui.toggleSearch();
          return;
        case "toggleSlashPalette":
          e.preventDefault();
          ui.requestSlashPalette();
          return;
        default: {
          if (!action.startsWith("openSession")) return;
          const slot = Number(action.replace("openSession", ""));
          const target = Object.keys(chat.openSessions)[slot - 1];
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

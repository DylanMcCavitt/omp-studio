// Cross-cutting overlay state owned outside any one component so the single
// global shortcut manager (lib/useShortcuts) can drive overlays that used to own
// their own window keydown listeners. Keeping the open-intent here is what makes
// "one source of truth" for shortcuts possible: the manager flips this store and
// the overlay components merely render from it.

import { create } from "zustand";

interface UiState {
  /** The Cmd/Ctrl+K global-search overlay open flag. */
  searchOpen: boolean;
  openSearch(): void;
  closeSearch(): void;
  toggleSearch(): void;

  /**
   * Monotonic counter bumped by Cmd/Ctrl+Shift+P. The active chat composer (the
   * only PromptComposer wired with a slash overlay) watches this and toggles its
   * palette; outside the chat composer nothing consumes it, so the chord is a
   * harmless no-op. A counter (not a boolean) keeps it a pure toggle *intent*,
   * never fighting the composer's own `/`-to-open state.
   */
  slashPaletteToggle: number;
  requestSlashPalette(): void;
}

export const useUiStore = create<UiState>((set) => ({
  searchOpen: false,
  openSearch: () => set({ searchOpen: true }),
  closeSearch: () => set({ searchOpen: false }),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),

  slashPaletteToggle: 0,
  requestSlashPalette: () =>
    set((s) => ({ slashPaletteToggle: s.slashPaletteToggle + 1 })),
}));

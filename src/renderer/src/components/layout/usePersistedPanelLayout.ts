// Bridges a `react-resizable-panels` PanelGroup to our settings-owned layout
// persistence (feature 5). We deliberately do NOT use the library's
// `autoSaveId`/localStorage — every layout write funnels through the
// main-owned `settings:*` store via the debounced `setLayout`, the single
// source of truth.
//
// The initial sizes are captured once at mount from the *current* settings
// (`useState` lazy initializer, read off `getState()` so it never re-applies on
// later renders and fights a live drag). Because settings load asynchronously
// at boot, the consumer keys the component on "settings loaded" so this hook
// remounts once and re-captures the persisted sizes. `reset` restores defaults
// imperatively and persists them (double-click on the handle).

import type { LayoutSettings } from "@shared/ipc";
import { useCallback, useRef, useState } from "react";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { useSettingsStore } from "@/store/settings";

export interface PersistedPanelLayoutOptions {
  /** Default layout (percentages, summing ~100) when nothing is persisted. */
  defaultLayout: number[];
  /** Derive the persisted layout (percentages) from `settings.layout`. */
  read: (layout: LayoutSettings) => number[] | undefined;
  /** Map an `onLayout` array (percentages) into a `settings.layout` patch. */
  toPatch: (layout: number[]) => Partial<LayoutSettings>;
}

export interface PersistedPanelLayout {
  /** Stable initial layout captured at mount (persisted value, else default). */
  initialLayout: number[];
  /** Attach to the PanelGroup `ref` for imperative resets. */
  groupRef: React.RefObject<ImperativePanelGroupHandle>;
  /** Wire to PanelGroup `onLayout` — persists (debounced) via `setLayout`. */
  onLayout: (layout: number[]) => void;
  /** Restore the default split imperatively and persist it. */
  reset: () => void;
}

export function usePersistedPanelLayout({
  defaultLayout,
  read,
  toPatch,
}: PersistedPanelLayoutOptions): PersistedPanelLayout {
  const setLayout = useSettingsStore((s) => s.setLayout);
  const groupRef = useRef<ImperativePanelGroupHandle>(null);

  const [initialLayout] = useState<number[]>(() => {
    const layout = useSettingsStore.getState().settings?.layout;
    return (layout ? read(layout) : undefined) ?? defaultLayout;
  });

  const onLayout = useCallback(
    (layout: number[]) => setLayout(toPatch(layout)),
    [setLayout, toPatch],
  );

  const reset = useCallback(() => {
    groupRef.current?.setLayout(defaultLayout);
    setLayout(toPatch(defaultLayout));
  }, [defaultLayout, setLayout, toPatch]);

  return { initialLayout, groupRef, onLayout, reset };
}

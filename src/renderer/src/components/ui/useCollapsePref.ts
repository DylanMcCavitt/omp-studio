// Persisted collapse state for the §3 disclosure primitives (Collapsible and
// the extended Panel). The collapse map lives under `settings.ui.collapsed[key]`
// (the v2 UiPrefs bump). That field is not on StudioSettingsV1 yet, so we
// read/write it structurally and degrade gracefully: the toggle is always
// instant (optimistic local state) and the write-through to settings is
// best-effort + debounced, so a burst of toggles collapses to one persist.

import type { StudioSettingsV1 } from "@shared/ipc";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/store/settings";

const PERSIST_DEBOUNCE_MS = 250;

/** Forward-compatible view of the v2 `settings.ui` shape this hook touches. */
interface UiPrefsView {
  collapsed?: Record<string, boolean>;
}
interface SettingsWithUi {
  ui?: UiPrefsView;
}

function readUi(settings: unknown): UiPrefsView {
  return (settings as SettingsWithUi | null | undefined)?.ui ?? {};
}

function readCollapsed(settings: unknown, key: string): boolean | undefined {
  return readUi(settings).collapsed?.[key];
}

/** Tuple returned by {@link useCollapsePref}: current state + setter. */
export type CollapsePref = readonly [boolean, (next: boolean) => void];

/**
 * Collapse state for a disclosure. With a `key` it mirrors
 * `settings.ui.collapsed[key]` (optimistic read, debounced write-through); with
 * no key it is plain component-local state.
 */
export function useCollapsePref(
  key: string | undefined,
  defaultCollapsed: boolean,
): CollapsePref {
  const persisted = useSettingsStore((s) =>
    key ? readCollapsed(s.settings, key) : undefined,
  );
  const update = useSettingsStore((s) => s.update);

  const [collapsed, setLocal] = useState(persisted ?? defaultCollapsed);

  // Adopt the persisted value when it appears or changes elsewhere (settings
  // loaded after mount, or another surface toggled the same key). We never echo
  // our own writes: `set` advances `lastPersisted` before persisting.
  const lastPersisted = useRef(persisted);
  useEffect(() => {
    if (persisted !== undefined && persisted !== lastPersisted.current) {
      lastPersisted.current = persisted;
      setLocal(persisted);
    }
  }, [persisted]);

  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const set = useCallback(
    (next: boolean) => {
      setLocal(next); // optimistic — instant, works even before v2 persists
      if (!key) return;
      lastPersisted.current = next;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const ui = readUi(useSettingsStore.getState().settings);
        const patch = {
          ui: { ...ui, collapsed: { ...ui.collapsed, [key]: next } },
        };
        // `ui` is not on StudioSettingsV1 yet (lands with the v2 settings bump);
        // cast defensively so this compiles today and persists once it does.
        void update(patch as unknown as Partial<StudioSettingsV1>);
      }, PERSIST_DEBOUNCE_MS);
    },
    [key, update],
  );

  return [collapsed, set] as const;
}

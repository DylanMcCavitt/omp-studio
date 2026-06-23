// Bootstrap hook: applies the persisted theme (settings.theme) to the document
// and, when the mode is "system", tracks the OS `prefers-color-scheme` live.
// Wired once from App so a single subscription drives the whole window.

import { useEffect } from "react";
import {
  applyResolvedTheme,
  PREFERS_DARK_QUERY,
  resolveTheme,
} from "@/lib/theme";
import { useSettingsStore } from "@/store/settings";

export function useTheme(): void {
  // Settings load asynchronously; until then fall back to "system" so the
  // window matches the OS rather than flashing a forced palette.
  const mode = useSettingsStore((s) => s.settings?.theme ?? "system");

  useEffect(() => {
    const media = window.matchMedia(PREFERS_DARK_QUERY);
    const apply = () => applyResolvedTheme(resolveTheme(mode, media.matches));
    apply();
    // Only "system" depends on the OS preference; explicit modes are static.
    if (mode !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [mode]);
}

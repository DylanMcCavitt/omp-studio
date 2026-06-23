// Theme resolution + DOM application, kept free of React/store imports so the
// resolution logic is unit-testable under `bun test`. The hook that wires this
// to the settings store and `prefers-color-scheme` lives in lib/useTheme.ts.

import type { ThemeMode } from "@shared/ipc";

export type ResolvedTheme = "dark" | "light";

export const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Resolve a persisted theme mode to a concrete light/dark choice. `system`
 * follows the OS preference; explicit modes are returned as-is.
 */
export function resolveTheme(
  mode: ThemeMode,
  prefersDark: boolean,
): ResolvedTheme {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

/**
 * Apply a resolved theme to the document root. Tailwind's `darkMode: "class"`
 * keys off the `dark` class; `:root` carries the light palette by default.
 */
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

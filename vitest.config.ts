// DOM component-test harness for the renderer (AGE-605). Deliberately SEPARATE
// from `bun test`: Vitest drives a jsdom DOM with Testing Library so render- and
// focus-sensitive components (the C3 approval dialogs, F1 composer, F4 slash
// palette, D2r session rail) get exercised the way a user touches them, while
// the node-side logic suites keep running under `bun test` over `test/` only.
//
// No overlap by construction:
//   - Vitest `include` matches ONLY `src/renderer/**/*.test.tsx`.
//   - bun's `bunfig.toml` pins `[test] root = "test"`, so bun never walks
//     `src/renderer` and never sees these `.test.tsx` files.
// The two runners therefore own disjoint files and neither double-runs the
// other's suites.

import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirror the renderer aliases from electron.vite.config.ts so component
    // imports (`@/...`, `@shared/...`) resolve identically under test.
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@": resolve(__dirname, "src/renderer/src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // ONLY renderer component tests. Keeps Vitest off the bun `test/` node
    // suites (*.test.ts) and the Playwright `e2e/` specs (*.spec.ts).
    include: ["src/renderer/**/*.test.tsx"],
    css: false,
    restoreMocks: true,
  },
});

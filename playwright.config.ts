import { defineConfig } from "@playwright/test";

// Playwright config for the Electron end-to-end smoke suite. Each test launches
// the BUILT app via the `_electron` API (see e2e/smoke.spec.ts), so there are
// no browser projects and the suite must run serially against a single build.
//
// Run with: `npm run build && npm run test:e2e`.
// On headless Linux CI, wrap the command with xvfb (`xvfb-run -a npm run
// test:e2e`) — Electron needs a display server even for a smoke launch.
export default defineConfig({
  testDir: "./e2e",
  // The app is launched per-suite, not per-test in parallel; one Electron
  // instance at a time keeps stdout/exit handling deterministic.
  fullyParallel: false,
  workers: 1,
  // Fail the CI run if a `test.only` is left behind.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The `list` reporter never spawns the HTML report server, which would
  // otherwise hang an automated/headless run.
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
});

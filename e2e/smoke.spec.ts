import { fileURLToPath } from "node:url";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";

// Non-live Electron smoke test.
//
// It launches the BUILT app (out/main/index.js) and verifies that the cockpit
// boots and every browse view renders without crashing. It never starts a chat,
// so no `omp` child is spawned and no paid model turn ever runs — the app's data
// services degrade gracefully when `omp`/`gh` are absent, so this is safe in CI.
//
// Prerequisite: `npm run build` (so out/main/index.js exists). Run the whole
// flow with `npm run build && npm run test:e2e`. On headless Linux CI, wrap with
// xvfb: `xvfb-run -a npm run test:e2e`.

const mainEntry = fileURLToPath(
  new URL("../out/main/index.js", import.meta.url),
);

// Sidebar destinations to smoke. Each carries a stable, data-independent marker
// proving the view actually mounted: a browse view renders its <h1> outside its
// loading/error/empty branches, so the heading is present regardless of whether
// `omp`/`gh` returned data. GitHub renders the repository name in place of the
// <h1> when a repo is detected, so its marker is the always-present "Repos" tab.
const HEADING_VIEWS = [
  { nav: "Sessions", heading: "Sessions" },
  { nav: "Skills", heading: "Skills" },
  { nav: "MCP", heading: "MCP Servers" },
  { nav: "Agents", heading: "Agents" },
  { nav: "Settings", heading: "Settings" },
] as const;

let app: ElectronApplication;
let page: Page;
const pageErrors: Error[] = [];

test.beforeAll(async () => {
  // Inherit the host environment (PATH lets the app discover omp/gh) but blank
  // out ELECTRON_RENDERER_URL so the built renderer file is loaded rather than a
  // dev server, even if the variable leaked into the environment.
  const env = { ...process.env, ELECTRON_RENDERER_URL: "" };

  app = await electron.launch({ args: [mainEntry], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app?.close();
});

test("window reports the OMP Studio title", async () => {
  expect(await page.title()).toBe("OMP Studio");
});

test("sidebar exposes every navigation destination", async () => {
  const nav = page.getByRole("navigation");
  await expect(nav).toBeVisible();
  for (const label of [
    "Dashboard",
    "Chat",
    "Sessions",
    "Skills",
    "MCP",
    "Agents",
    "GitHub",
    "Settings",
  ]) {
    await expect(
      nav.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
  }
});

test("dashboard renders on launch", async () => {
  await expect(
    page.getByRole("heading", { name: "Dashboard", level: 1 }),
  ).toBeVisible();
});

test("every browse view navigates without an error boundary or crash", async () => {
  const nav = page.getByRole("navigation");

  for (const { nav: label, heading } of HEADING_VIEWS) {
    const button = nav.getByRole("button", { name: label, exact: true });
    await button.click();
    // The store-driven route actually switched.
    await expect(button).toHaveAttribute("aria-current", "page");
    // The view mounted its content instead of blanking on an unhandled error.
    await expect(
      page.getByRole("heading", { name: heading, level: 1, exact: true }),
    ).toBeVisible();
    // The shell survived the navigation (a renderer crash would unmount it).
    await expect(nav).toBeVisible();
  }

  // GitHub renders the repo name (not an <h1>) when a repo is detected, so
  // assert on its always-present tab bar instead.
  const github = nav.getByRole("button", { name: "GitHub", exact: true });
  await github.click();
  await expect(github).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("button", { name: "Repos", exact: true }),
  ).toBeVisible();
  await expect(nav).toBeVisible();
});

test("no uncaught renderer errors occurred during the smoke run", () => {
  expect(pageErrors).toEqual([]);
});

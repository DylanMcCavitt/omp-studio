import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";

// Non-live, hermetic Electron smoke test.
//
// It launches the BUILT app (out/main/index.js) and verifies that the cockpit
// boots and every browse view renders without crashing. It never starts a chat
// and forces omp/gh to be unresolvable (see beforeAll), so NO omp/gh child is
// spawned, no paid model turn runs, and the result is identical whether or not
// omp/gh are installed — every view renders its graceful-degrade path.
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
  { nav: "Skills", heading: "Skills & Commands" },
  { nav: "MCP", heading: "MCP Servers" },
  { nav: "Agents", heading: "Agents" },
  { nav: "Settings", heading: "Settings" },
] as const;

let app: ElectronApplication;
let page: Page;
let tempAgentDir: string;
let tempUserDataDir: string;
const pageErrors: Error[] = [];

test.beforeAll(async () => {
  // Hermetic, non-live posture. Three levers make the run deterministic and
  // side-effect-free regardless of the host:
  //   - omp/gh point at a nonexistent binary, so the data services hit their
  //     graceful-degrade path and spawn NO omp/gh children;
  //   - PI_CODING_AGENT_DIR points at an empty temp dir, so session/MCP/skills
  //     discovery reads an empty tree;
  //   - --user-data-dir points Electron's userData at an empty temp dir, so
  //     settings.json is absent (terminal + browser stay OFF by default) and the
  //     keychain-backed secret store is empty (Linear is unauthenticated).
  // OMP_STUDIO_SMOKE keeps the window hidden (headless/CI friendly) without
  // changing what the renderer mounts.
  tempAgentDir = mkdtempSync(join(tmpdir(), "omp-studio-e2e-"));
  tempUserDataDir = mkdtempSync(join(tmpdir(), "omp-studio-e2e-data-"));
  const unresolvable = join(tempAgentDir, "no-such-binary");
  const env = {
    ...process.env,
    // Load the built renderer file, not a leaked dev-server URL.
    ELECTRON_RENDERER_URL: "",
    OMP_STUDIO_SMOKE: "1",
    OMP_BINARY: unresolvable,
    GH_BINARY: unresolvable,
    PI_CODING_AGENT_DIR: tempAgentDir,
  };

  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${tempUserDataDir}`],
    env,
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app?.close();
  if (tempAgentDir) rmSync(tempAgentDir, { recursive: true, force: true });
  if (tempUserDataDir)
    rmSync(tempUserDataDir, { recursive: true, force: true });
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
    "Terminal",
    "Browser",
    "GitHub",
    "Linear",
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

test("v2 routes (Linear, Terminal, Browser) render their hermetic states", async () => {
  const nav = page.getByRole("navigation");

  // Linear — no key in the (empty, redirected) keychain, so the view collapses
  // to its connect card. The always-present <h1> proves the view mounted; the
  // "Linear API key" field proves the unauthenticated connect surface rendered.
  const linear = nav.getByRole("button", { name: "Linear", exact: true });
  await linear.click();
  await expect(linear).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "Linear", level: 1, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Linear API key", { exact: true }),
  ).toBeVisible();
  await expect(nav).toBeVisible();

  // Browser — off by default (no settings.json), so the inline enable gate is
  // shown instead of the chrome. The gate has no <h1>; its enable action is the
  // stable marker that the off-by-default path rendered.
  const browser = nav.getByRole("button", { name: "Browser", exact: true });
  await browser.click();
  await expect(browser).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("button", { name: "Enable embedded browser" }),
  ).toBeVisible();
  await expect(nav).toBeVisible();

  // Terminal — off by default, so the blocking acknowledgement gate (a modal
  // dialog) is shown over the view. The <h1> proves the view mounted; the
  // dialog proves the gate blocks the shell from ever spawning.
  const terminal = nav.getByRole("button", { name: "Terminal", exact: true });
  await terminal.click();
  await expect(terminal).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "Terminal", level: 1, exact: true }),
  ).toBeVisible();
  const gate = page.getByRole("dialog", { name: "Enable the terminal?" });
  await expect(gate).toBeVisible();
  await expect(nav).toBeVisible();

  // Dismiss the gate (without enabling the terminal) so the modal's full-screen
  // backdrop is torn down and the run is left in a clean, non-blocked state.
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(gate).toBeHidden();
});

test("no uncaught renderer errors occurred during the smoke run", () => {
  expect(pageErrors).toEqual([]);
});

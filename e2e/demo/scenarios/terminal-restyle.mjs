// Demo: AGE-706 Terminal panel restyle — workspace tab Live Dot + themed shell.
// Opens the Terminal rail panel with the gate already cleared, shows the
// workspace tab and the #08080a mono shell surface.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seedDemoFixtures } from "../fixtures.mjs";

const WORKSPACE_TAB = '[data-testid="terminal-workspace-tab"]';
const SHELL_SURFACE = '[data-testid="terminal-shell-surface"]';

export function seed(baseDir) {
  const fixtures = seedDemoFixtures(baseDir, {
    title: "Terminal restyle demo",
  });
  const settingsPath = join(fixtures.userDataDir, "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  settings.theme = "dark";
  settings.terminal = { enabled: true, maxConcurrent: 4 };
  settings.workspaces = [
    {
      id: "demo-workspace",
      cwd: fixtures.workspaceDir,
      label: "Demo workspace",
      color: "teal",
      pinned: true,
      lastUsedAt: "2026-07-06T12:00:00.000Z",
    },
  ];
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return fixtures;
}

export async function run({ page, pause, shot }) {
  const steps = [];
  const step = (name, ok = true) =>
    steps.push(`${ok ? "PASS" : "FAIL"} ${name}`);

  await page
    .locator('nav[aria-label="Tools"]')
    .getByRole("button", { name: "Terminal" })
    .click();
  await page.waitForSelector(WORKSPACE_TAB, { timeout: 15000 });
  step("open Terminal panel from right rail");

  const tabText = await page.locator(WORKSPACE_TAB).innerText();
  step("workspace tab shows label", tabText.includes("Demo workspace"));

  const dotStatus = await page
    .locator(`${WORKSPACE_TAB} [data-status]`)
    .getAttribute("data-status");
  step("workspace tab carries Live Dot status", dotStatus === "running");

  await page.waitForSelector('[data-testid="xterm-surface"]', {
    timeout: 15000,
  });
  await pause(1800);
  await shot("workspace-tab");
  step("themed shell surface mounts");

  const shellBg = await page
    .locator(SHELL_SURFACE)
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  step("shell surface uses terminal token", shellBg === "rgb(8, 8, 10)");

  await pause(1200);
  await shot("shell-surface");
  step("capture themed shell keyframe");

  return steps;
}

// Demo: Settings opens as a floating modal over the current center view.
// Opens a hibernated chat, launches Settings from the right rail, scrolls
// through sections, then closes via Escape and proves the chat stayed mounted.
import { seedDemoFixtures } from "../fixtures.mjs";

export function seed(baseDir) {
  return seedDemoFixtures(baseDir, {
    messageCount: 18,
    title: "Settings modal demo",
  });
}

export async function run({ page, pause, shot }) {
  const steps = [];
  const step = (name, ok = true) =>
    steps.push(`${ok ? "PASS" : "FAIL"} ${name}`);

  await page.getByText("Settings modal demo").first().click();
  await page.waitForSelector("[data-visible-message-count]", {
    timeout: 15000,
  });
  await shot("center-before");
  step("open hibernated chat center");
  await pause(900);

  const settingsButton = page
    .getByRole("navigation", { name: "Tools" })
    .getByRole("button", { name: "Settings", exact: true });
  await settingsButton.click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  await dialog.getByText("Defaults", { exact: true }).waitFor();
  await shot("modal-defaults");
  step("open Settings as modal");
  await pause(1000);

  await dialog
    .getByText("Workspaces", { exact: true })
    .scrollIntoViewIfNeeded();
  await shot("modal-workspaces");
  step("navigate to Workspaces section");
  await pause(1000);

  await dialog.getByText("Models").first().scrollIntoViewIfNeeded();
  await shot("modal-models");
  step("navigate to Models section");
  await pause(1000);

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
  await shot("center-after-close");
  const centerStillMounted =
    (await page.getByText("Settings modal demo").count()) > 0;
  step("close with Escape; center remains in place", centerStillMounted);

  return steps;
}

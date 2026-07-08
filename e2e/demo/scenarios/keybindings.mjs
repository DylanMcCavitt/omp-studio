// Demo: user-configurable keybindings (AGE-692).
// Opens Settings, records a new New chat binding, shows conflict blocking, then
// proves the remapped shortcut starts a chat.
import { seedDemoFixtures } from "../fixtures.mjs";

export function seed(baseDir) {
  return seedDemoFixtures(baseDir, {
    messageCount: 8,
    title: "Keybindings demo",
  });
}

export async function run({ page, pause, shot }) {
  const steps = [];
  const step = (name, ok = true) =>
    steps.push(`${ok ? "PASS" : "FAIL"} ${name}`);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Settings" }).waitFor();
  await page
    .locator('[data-keybinding-action="newChat"]')
    .scrollIntoViewIfNeeded();
  await shot("settings-keybindings");
  step("open Settings keybindings section");

  const newChatRow = page.locator('[data-keybinding-action="newChat"]');
  await newChatRow
    .getByRole("button", { name: "Record New chat shortcut" })
    .click();
  await page.keyboard.press("Control+J");
  await page.getByText("New chat set to Cmd/Ctrl+J.").waitFor();
  await shot("new-chat-captured");
  step("capture Cmd/Ctrl+J for New chat");

  await newChatRow
    .getByRole("button", { name: "Record New chat shortcut" })
    .click();
  await page.keyboard.press("Control+K");
  await page
    .getByText("Cmd/Ctrl+K is already assigned to Command palette.")
    .waitFor();
  await shot("conflict-warning");
  step("conflict warning blocks Cmd/Ctrl+K");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await pause(500);
  await page.keyboard.press("Control+J");
  await page.getByLabel("Message").waitFor({ timeout: 15000 });
  await shot("rebound-shortcut-fired");
  step("rebound shortcut starts a chat");

  return steps;
}

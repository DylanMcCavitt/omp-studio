// Demo: the MessageScroller chat navigation trail (AGE-774).
// Opens a hibernated 40-message chat, glides to the top (active tick tracks),
// click-jumps to a middle tick, then to the last tick.
import { seedDemoFixtures } from "../fixtures.mjs";

const TRAIL = 'nav[aria-label="Message position"]';

export function seed(baseDir) {
  return seedDemoFixtures(baseDir, {
    messageCount: 40,
    title: "MessageScroller demo",
  });
}

export async function run({ page, pause, shot }) {
  const steps = [];
  const step = (name, ok = true) =>
    steps.push(`${ok ? "PASS" : "FAIL"} ${name}`);

  await page.getByText("MessageScroller demo").first().click();
  await page.waitForSelector(TRAIL, { timeout: 15000 });
  step("open hibernated chat; trail renders");
  await pause(1500);

  const scrollTo = (top) =>
    page.evaluate((t) => {
      const scroller = document
        .querySelector("[data-visible-message-count]")
        ?.querySelector(".scrollbar");
      if (scroller) scroller.scrollTo({ top: t, behavior: "smooth" });
    }, top);
  const scrollMax = await page.evaluate(() => {
    const s = document
      .querySelector("[data-visible-message-count]")
      ?.querySelector(".scrollbar");
    return s ? s.scrollHeight - s.clientHeight : 0;
  });

  for (const f of [0.75, 0.5, 0.25, 0]) {
    await scrollTo(scrollMax * f);
    await pause(1400);
  }
  await shot("trail-top");
  step("glide to top; active tick tracks");

  const ticks = page.locator(`${TRAIL} button`);
  const tickCount = await ticks.count();
  step(`trail exposes ${tickCount} ticks`, tickCount > 0);

  await ticks.nth(Math.floor(tickCount / 2)).click();
  await pause(1800);
  await shot("trail-mid-jump");
  const midAnchor = await page.evaluate(
    () =>
      document
        .querySelector("[data-visible-message-count]")
        ?.getAttribute("data-current-anchor") ?? "",
  );
  step("mid tick click-jumps", midAnchor !== "");

  await ticks.nth(tickCount - 1).click();
  await pause(1800);
  await shot("trail-bottom");
  step("last tick jumps to end");

  await scrollTo(scrollMax * 0.4);
  await pause(1500);
  await ticks.nth(tickCount - 1).click();
  await pause(1500);
  step("re-jump after manual scroll");

  return steps;
}

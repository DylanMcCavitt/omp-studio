import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

// LIVE Electron end-to-end flows that spend REAL `omp` model turns.
//
// These mirror the existing `RPC_LIVE=1` bridge proof: they are manual/local
// only and gated behind `STUDIO_E2E_LIVE=1`, so `npm run test:e2e` SKIPS them by
// default and CI never spawns a paid turn (each describe no-ops without the
// flag — see the `test.skip(!LIVE, …)` at the top of every group). The
// coordinator runs the paid suite at closeout; this file only has to be correct
// and skip cleanly without the flag.
//
// Unlike the hermetic H3 smoke (e2e/smoke.spec.ts), these launch the BUILT app
// against the INSTALLED omp: they deliberately do NOT set the OMP_BINARY/GH_BINARY
// overrides (the app must resolve a real omp to stream). Each test isolates the
// studio's settings with its own temp `--user-data-dir`, runs the chat in a
// throwaway temp project dir, and keeps prompts tiny to minimise spend. The omp
// agent state dir (sessions/auth) is intentionally left at the host default so
// the real provider auth + model config resolve exactly as for a normal run.
//
// Prerequisite: `npm run build` (so out/main/index.js exists), then
// `STUDIO_E2E_LIVE=1 npm run test:e2e`.

const LIVE = process.env.STUDIO_E2E_LIVE === "1";
const SKIP_REASON =
  "live e2e spends real omp model turns; set STUDIO_E2E_LIVE=1 to run";

const mainEntry = fileURLToPath(
  new URL("../out/main/index.js", import.meta.url),
);

// Distinctive tokens so a text match can never collide with chrome/labels.
const CHAT_TOKEN = "STUDIO-CHAT-7Q2W";
const RESUME_TOKEN = "STUDIO-RESUME-7Q2W";
const ALPHA = "STUDIO-ALPHA-7Q2W";
const BETA = "STUDIO-BETA-7Q2W";

type ApprovalMode = "always-ask" | "write" | "yolo";

interface Studio {
  app: ElectronApplication;
  page: Page;
}

/**
 * Write a minimal valid StudioSettingsV1 into a temp userData dir BEFORE launch,
 * so the chat StartPanel auto-selects `defaultProject` (no native directory
 * picker needed) and starts with the requested approval mode. The shape mirrors
 * settings-service.defaultSettings(); the main process coerces it on load.
 */
function seedSettings(
  userDataDir: string,
  opts: { project: string; approvalMode: ApprovalMode; autoApprove?: boolean },
): void {
  mkdirSync(userDataDir, { recursive: true });
  const settings = {
    version: 1,
    theme: "system",
    defaultProject: opts.project,
    defaultModel: null,
    defaultThinkingLevel: "medium",
    defaultApprovalMode: opts.approvalMode,
    defaultAutoApprove: opts.autoApprove ?? false,
    liveSessionLimit: 4,
    recentProjects: [],
    openSessions: [],
  };
  writeFileSync(
    join(userDataDir, "settings.json"),
    `${JSON.stringify(settings, null, 2)}\n`,
  );
}

/**
 * Launch the built app against the REAL omp with the studio settings isolated to
 * `userDataDir`. Asserts the userData override actually took effect so a misfired
 * `--user-data-dir` can never silently pollute the host's real settings.
 */
async function launch(userDataDir: string): Promise<Studio> {
  const env = { ...process.env };
  // LIVE posture: never the hermetic overrides — these need a real omp/gh.
  delete env.OMP_BINARY;
  delete env.GH_BINARY;
  env.ELECTRON_RENDERER_URL = "";
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    env,
  });
  const resolved = await app.evaluate(({ app: electronApp }) =>
    electronApp.getPath("userData"),
  );
  // Guard isolation: a silently-ignored switch would write to the host userData.
  expect(realpathSync(resolved)).toBe(realpathSync(userDataDir));
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}

/** A fresh temp project dir + temp userData dir for one isolated chat. */
function makeDirs(approvalMode: ApprovalMode): {
  userDataDir: string;
  cwd: string;
  dirs: string[];
} {
  const userDataDir = mkdtempSync(join(tmpdir(), "omp-studio-live-ud-"));
  const cwd = mkdtempSync(join(tmpdir(), "omp-studio-live-cwd-"));
  seedSettings(userDataDir, { project: cwd, approvalMode });
  return { userDataDir, cwd, dirs: [userDataDir, cwd] };
}

function cleanup(dirs: string[]): void {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

/** The chat workspace's session rail (the aside that hosts "New chat"). */
function rail(page: Page) {
  return page
    .locator("aside")
    .filter({ has: page.getByRole("button", { name: "New chat" }) });
}

/**
 * An ASSISTANT (left-aligned) message bubble containing `text`. MessageBubble
 * renders user messages in a right-aligned `div.justify-end` bubble and assistant
 * messages in a left-aligned `div.justify-start` one. Scoping to the assistant
 * side is what makes a token assertion prove the model's OUTPUT rather than the
 * prompt the renderer echoes optimistically (the user message renders before any
 * assistant frame arrives, so an unscoped match could pass with zero output).
 */
function assistantBubble(page: Page, text: string) {
  return page.locator("div.justify-start").filter({ hasText: text });
}

async function gotoChat(page: Page): Promise<void> {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Chat", exact: true })
    .click();
}

/**
 * Start a brand-new chat from the StartPanel and fire the first prompt. Waits
 * for the seeded project to auto-select (which enables "Start session") and for
 * the active composer to mount once the child spawns.
 */
async function startSession(page: Page, prompt: string): Promise<void> {
  await page
    .getByPlaceholder("Describe what you want the agent to do…")
    .fill(prompt);
  const startButton = page.getByRole("button", { name: "Start session" });
  await expect(startButton).toBeEnabled({ timeout: 20_000 });
  await startButton.click();
  // The pane swaps to the live composer (idle "Message <workspace>" or mid-turn
  // "Steer").
  await expect(
    page.getByPlaceholder(/Message .+…|Steer the agent…/),
  ).toBeVisible({ timeout: 90_000 });
}

/**
 * Approve or deny every approval dialog the current turn raises, returning once
 * the turn ends (the composer returns to its idle "Message <workspace>…" state).
 * In always-ask mode a turn can raise several tool approvals; this resolves each
 * the same way so the assertion afterwards is unambiguous.
 *
 * omp surfaces a tool approval as an Approve/Deny `select` extension UI request,
 * which the studio routes to the rich ApprovalRequestDialog (AGE-608): explicit
 * "Deny" / "Approve once" buttons (Deny is the focused default), NOT a listbox
 * of options. We click the button matching the decision; the dialog maps it
 * back to the select's {value:"Approve"|"Deny"} response.
 */
async function resolveApprovals(
  page: Page,
  decision: "Approve" | "Deny",
): Promise<void> {
  const button = decision === "Approve" ? "Approve once" : "Deny";
  const idle = page.getByPlaceholder(/Message .+…/);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await idle.isVisible().catch(() => false)) return;
    const dialog = page.getByRole("dialog");
    const action = dialog.getByRole("button", { name: button, exact: true });
    if (await action.isVisible().catch(() => false)) {
      await action.click();
      continue;
    }
    await page.waitForTimeout(400);
  }
  throw new Error("turn did not end after resolving approvals");
}

// ---------------------------------------------------------------------------
// (1) Chat turn — a real prompt streams assistant text and the turn ends.
// ---------------------------------------------------------------------------
test.describe("live chat turn", () => {
  test.skip(!LIVE, SKIP_REASON);

  test("streams assistant text and ends the turn", async () => {
    test.setTimeout(240_000);
    const { userDataDir, dirs } = makeDirs("always-ask");
    const { app, page } = await launch(userDataDir);
    try {
      await gotoChat(page);
      await startSession(
        page,
        `Reply with a one-sentence greeting that includes the token ${CHAT_TOKEN} and nothing else.`,
      );
      // The streamed token lands in the ASSISTANT bubble — proving real model
      // output, not the prompt the user bubble echoes.
      await expect(assistantBubble(page, CHAT_TOKEN).first()).toBeVisible({
        timeout: 120_000,
      });
      // The turn ends: the composer returns to its idle "Send" state.
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible({
        timeout: 120_000,
      });
      await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
    } finally {
      await app.close().catch(() => undefined);
      cleanup(dirs);
    }
  });
});

// ---------------------------------------------------------------------------
// (2) D1 approval — always-ask gates tool execution behind the renderer dialog.
// ---------------------------------------------------------------------------
test.describe("live D1 approval", () => {
  test.skip(!LIVE, SKIP_REASON);

  test("approve once lets the tool proceed", async () => {
    test.setTimeout(300_000);
    const { userDataDir, cwd, dirs } = makeDirs("always-ask");
    const { app, page } = await launch(userDataDir);
    try {
      await gotoChat(page);
      await startSession(
        page,
        "Use your file-writing tool to create a file named approved-by-e2e.txt in the current working directory containing the text ok. Do not ask me any questions.",
      );
      // always-ask raises the C3 approval dialog before the write runs. omp
      // surfaces it as an Approve/Deny `select`, which the studio routes to the
      // rich ApprovalRequestDialog (AGE-608): "Deny"/"Approve once" buttons.
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 120_000 });
      await expect(
        dialog.getByRole("button", { name: "Approve once", exact: true }),
      ).toBeVisible();
      await resolveApprovals(page, "Approve");
      // The approved write actually landed on disk (cwd started empty).
      await expect
        .poll(() => readdirSync(cwd).length, { timeout: 30_000 })
        .toBeGreaterThan(0);
    } finally {
      await app.close().catch(() => undefined);
      cleanup(dirs);
    }
  });

  test("deny blocks the tool", async () => {
    test.setTimeout(300_000);
    const { userDataDir, cwd, dirs } = makeDirs("always-ask");
    const { app, page } = await launch(userDataDir);
    try {
      await gotoChat(page);
      await startSession(
        page,
        "Use your file-writing tool to create a file named denied-by-e2e.txt in the current working directory containing the text nope. Do not ask me any questions.",
      );
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 120_000 });
      await expect(
        dialog.getByRole("button", { name: "Deny", exact: true }),
      ).toBeVisible();
      await resolveApprovals(page, "Deny");
      // The denied write never happened — the temp project dir stays empty.
      expect(readdirSync(cwd)).toHaveLength(0);
    } finally {
      await app.close().catch(() => undefined);
      cleanup(dirs);
    }
  });

  test("input/select request round-trips to the child", async () => {
    test.setTimeout(300_000);
    // yolo so tool approvals never interleave with the interactive ask dialog.
    const { userDataDir, dirs } = makeDirs("yolo");
    const { app, page } = await launch(userDataDir);
    try {
      await gotoChat(page);
      await startSession(
        page,
        'Before doing anything else, use your interactive ask/prompt tool to ask me a single free-text question ("What codeword should I use?") and WAIT for my answer. Then reply with exactly the answer I give you and nothing else.',
      );
      const dialog = page.getByRole("dialog");
      // Not every omp build/model surfaces an interactive request — treat its
      // absence as "not reachable" rather than a failure (per the H4 scope).
      let appeared = true;
      try {
        await expect(dialog).toBeVisible({ timeout: 90_000 });
      } catch {
        appeared = false;
      }
      test.skip(
        !appeared,
        "this omp build/model did not surface an interactive input/select request",
      );

      // omp's `ask` surfaces the question as a SELECT whose options include an
      // injected "Other (type your own)" free-text escape; choosing it opens a
      // follow-up INPUT modal ("Enter your response:"). Some builds may surface a
      // text input directly. Handle both, always driving a NOVEL value absent
      // from the prompt so the echo below can only come from the value
      // round-tripping through the child (not the prompt the renderer echoes).
      const NOVEL = "ROUNDTRIP-OK-5K3W";
      const directInput = dialog.getByRole("textbox");
      const listbox = dialog.getByRole("listbox");
      let answer = "";
      if (await directInput.isVisible().catch(() => false)) {
        answer = NOVEL;
        await directInput.fill(answer);
        await dialog
          .getByRole("button", { name: "Submit", exact: true })
          .click();
      } else if (await listbox.isVisible().catch(() => false)) {
        const freeTextEscape = dialog
          .getByRole("option")
          .filter({ hasText: "Other" })
          .first();
        if (await freeTextEscape.isVisible().catch(() => false)) {
          // Free-text escape → follow-up input modal we can type a novel value into.
          await freeTextEscape.click();
          await dialog
            .getByRole("button", { name: "Select", exact: true })
            .click();
          const followInput = dialog.getByRole("textbox");
          await expect(followInput).toBeVisible({ timeout: 30_000 });
          answer = NOVEL;
          await followInput.fill(answer);
          await dialog
            .getByRole("button", { name: "Submit", exact: true })
            .click();
        } else {
          // No free-text escape: the chosen option string is itself the answer.
          const option = dialog.getByRole("option").first();
          answer = ((await option.textContent()) ?? "").trim();
          await option.click();
          await dialog
            .getByRole("button", { name: "Select", exact: true })
            .click();
        }
      }
      test.skip(answer === "", "no input/select control surfaced to answer");

      // The renderer dequeues the request once it posts the response…
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      // …and the CHILD actually consumed the value: the agent echoes it back in
      // its output and the turn returns to idle. (Dialog-hide alone would pass
      // before the child ever received the value, so it is not sufficient.)
      await expect(assistantBubble(page, answer).first()).toBeVisible({
        timeout: 120_000,
      });
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible({
        timeout: 120_000,
      });
    } finally {
      await app.close().catch(() => undefined);
      cleanup(dirs);
    }
  });
});

// ---------------------------------------------------------------------------
// (3) D3 resume — a relaunch restores the open session as a hibernated row and
//     reopening it hydrates the prior transcript.
// ---------------------------------------------------------------------------
test.describe("live D3 resume", () => {
  test.skip(!LIVE, SKIP_REASON);

  test("relaunch restores a hibernated session and rehydrates it", async () => {
    test.setTimeout(360_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "omp-studio-live-ud-"));
    const cwd = mkdtempSync(join(tmpdir(), "omp-studio-live-cwd-"));
    seedSettings(userDataDir, { project: cwd, approvalMode: "always-ask" });
    try {
      // First launch: create a session and finish a turn so its descriptor
      // (with a sessionFile) persists to settings.json under userDataDir, and
      // the assistant's reply lands in the JSONL transcript.
      const first = await launch(userDataDir);
      try {
        await gotoChat(first.page);
        await startSession(
          first.page,
          `Reply with exactly this token and nothing else: ${RESUME_TOKEN}`,
        );
        await expect(
          assistantBubble(first.page, RESUME_TOKEN).first(),
        ).toBeVisible({ timeout: 120_000 });
        await expect(
          first.page.getByRole("button", { name: "Send" }),
        ).toBeVisible({ timeout: 120_000 });
      } finally {
        await first.app.close().catch(() => undefined);
      }

      // Relaunch with the SAME userData: no child auto-spawns, but the persisted
      // descriptor restores as a hibernated rail row.
      const second = await launch(userDataDir);
      try {
        await gotoChat(second.page);
        const hibernated = rail(second.page)
          .getByRole("button")
          .filter({ hasText: "Hibernated" });
        await expect(hibernated).toBeVisible({ timeout: 30_000 });
        // Reopening it resumes the chat and rehydrates the prior transcript —
        // the assistant reply (not just the user prompt) comes back from JSONL.
        await hibernated.click();
        await expect(
          assistantBubble(second.page, RESUME_TOKEN).first(),
        ).toBeVisible({ timeout: 90_000 });
      } finally {
        await second.app.close().catch(() => undefined);
      }
    } finally {
      cleanup([userDataDir, cwd]);
    }
  });
});

// ---------------------------------------------------------------------------
// (4) D2 concurrency — two live sessions switch independently, and closing one
//     leaves the other's child streaming.
// ---------------------------------------------------------------------------
test.describe("live D2 concurrency", () => {
  test.skip(!LIVE, SKIP_REASON);

  test("switching preserves both and closing one keeps the other", async () => {
    test.setTimeout(360_000);
    const { userDataDir, dirs } = makeDirs("always-ask");
    const { app, page } = await launch(userDataDir);
    try {
      await gotoChat(page);

      // Session 1.
      await startSession(
        page,
        `Reply with exactly this token and nothing else: ${ALPHA}`,
      );
      await expect(assistantBubble(page, ALPHA).first()).toBeVisible({
        timeout: 120_000,
      });
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible({
        timeout: 120_000,
      });

      // Session 2 (same project; rows are distinguished by transcript content).
      // Scope to the rail: "New chat" exists in BOTH the Sidebar nav and the
      // rail's draft row, so an unscoped getByRole would be strict-mode ambiguous.
      await rail(page).getByRole("button", { name: "New chat" }).click();
      await startSession(
        page,
        `Reply with exactly this token and nothing else: ${BETA}`,
      );
      await expect(assistantBubble(page, BETA).first()).toBeVisible({
        timeout: 120_000,
      });
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible({
        timeout: 120_000,
      });

      const rows = rail(page).locator("div.group");
      await expect(rows).toHaveCount(2);

      // Switching keeps both children alive and swaps the visible transcript:
      // each session shows its OWN assistant output and not the other's.
      await rows.nth(0).getByRole("button").first().click();
      await expect(assistantBubble(page, ALPHA).first()).toBeVisible();
      await expect(assistantBubble(page, BETA)).toHaveCount(0);
      await rows.nth(1).getByRole("button").first().click();
      await expect(assistantBubble(page, BETA).first()).toBeVisible();
      await expect(assistantBubble(page, ALPHA)).toHaveCount(0);

      // With S2 active and streaming, close the OTHER (idle, background) session.
      await page
        .getByPlaceholder(/Message .+…/)
        .fill("Count from 1 to 12, one number per line.");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByRole("button", { name: "Stop" })).toBeVisible({
        timeout: 120_000,
      });
      await rows.nth(0).hover();
      await rows.nth(0).getByRole("button", { name: "Close session" }).click();
      await expect(rail(page).locator("div.group")).toHaveCount(1);

      // The survivor's child was untouched: its turn completes and its
      // transcript is intact.
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible({
        timeout: 120_000,
      });
      await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
      await expect(assistantBubble(page, BETA).first()).toBeVisible();
    } finally {
      await app.close().catch(() => undefined);
      cleanup(dirs);
    }
  });
});

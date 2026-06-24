import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

// Non-live, hermetic resize-robustness regression suite (AGE-657).
//
// Reuses the same hermetic bootstrap as smoke/ui-flows (built app, temp userData
// seeded with a v2 settings.json selecting a temp workspace, omp/gh forced to an
// unresolvable binary so no child spawns and no paid turn runs). It then drives
// the BrowserWindow through a range of content sizes — and the sidebar splitter
// to its minimum — asserting the shell never spills a horizontal scrollbar onto
// the document and never throws. This is the guard for "resizing breaks layout /
// content gets cut off / words wrap badly": once a panel is too narrow, content
// must clip/shrink WITHIN the panel, never push the whole app wider.
//
// Prerequisite: `npm run build` (so out/main/index.js exists).

test.describe.configure({ mode: "serial" });

const mainEntry = fileURLToPath(
  new URL("../out/main/index.js", import.meta.url),
);

// Content widths to exercise: very narrow, awkward mid, and wide. Height is held
// constant — horizontal overflow is the regression we are guarding.
const WIDTHS = [640, 760, 1680] as const;
const HEIGHT = 820;

// Main rail destinations that render real content in the right panel (Terminal
// and Browser open gated dialogs/enable-cards, so they're excluded here).
const VIEWS = [
  "Dashboard",
  "Skills",
  "MCP",
  "Agents",
  "GitHub",
  "Linear",
  "Settings",
] as const;

let app: ElectronApplication;
let page: Page;
let tempAgentDir: string;
let tempUserDataDir: string;
let tempWorkspaceDir: string;
const pageErrors: Error[] = [];
const rendererCrashes: string[] = [];

test.beforeAll(async () => {
  tempAgentDir = mkdtempSync(join(tmpdir(), "omp-studio-e2e-resize-"));
  tempUserDataDir = mkdtempSync(join(tmpdir(), "omp-studio-e2e-resize-data-"));
  tempWorkspaceDir = mkdtempSync(
    join(tmpdir(), "omp-studio-e2e-resize-workspace-"),
  );

  mkdirSync(join(tempWorkspaceDir, "src"), { recursive: true });
  writeFileSync(
    join(tempWorkspaceDir, "README.md"),
    "# Resize workspace\n",
    "utf8",
  );

  writeFileSync(
    join(tempUserDataDir, "settings.json"),
    `${JSON.stringify(
      {
        version: 2,
        theme: "dark",
        defaultProject: tempWorkspaceDir,
        defaultModel: null,
        defaultThinkingLevel: "medium",
        defaultApprovalMode: "always-ask",
        defaultAutoApprove: false,
        liveSessionLimit: 4,
        recentProjects: [],
        openSessions: [],
        workspaces: [
          {
            id: "resize-workspace",
            cwd: tempWorkspaceDir,
            label: "Resize workspace",
            pinned: true,
            lastUsedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        linear: { writesEnabled: false },
        terminal: { enabled: false, maxConcurrent: 4 },
        browser: { enabled: false },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const unresolvable = join(tempAgentDir, "no-such-binary");
  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${tempUserDataDir}`],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: "",
      OMP_STUDIO_SMOKE: "1",
      OMP_BINARY: unresolvable,
      GH_BINARY: unresolvable,
      PI_CODING_AGENT_DIR: tempAgentDir,
    },
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error));
  page.on("crash", () => rendererCrashes.push("renderer crashed"));
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app?.close();
  if (tempAgentDir) rmSync(tempAgentDir, { recursive: true, force: true });
  if (tempUserDataDir)
    rmSync(tempUserDataDir, { recursive: true, force: true });
  if (tempWorkspaceDir)
    rmSync(tempWorkspaceDir, { recursive: true, force: true });
});

/** Resize the real BrowserWindow's content area and let the renderer reflow. */
async function setContentSize(width: number, height: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.setContentSize(size.width, size.height);
    },
    { width, height },
  );
  await page.waitForTimeout(150);
}

/** Pixels the document is wider than its viewport (0 == no horizontal scroll). */
async function documentOverflow(): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return Math.max(0, el.scrollWidth - el.clientWidth);
  });
}

function railButton(label: string) {
  return page
    .getByRole("navigation", { name: "Tools" })
    .getByRole("button", { name: label, exact: true });
}

async function openView(label: string): Promise<void> {
  const button = railButton(label);
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("complementary", { name: `${label} panel` }),
  ).toBeVisible();
}

for (const width of WIDTHS) {
  test(`no document horizontal overflow across views at ${width}px`, async () => {
    await setContentSize(width, HEIGHT);
    for (const label of VIEWS) {
      await openView(label);
      await page.waitForTimeout(60);
      const overflow = await documentOverflow();
      expect(
        overflow,
        `${label} at ${width}px should not push the document wider`,
      ).toBeLessThanOrEqual(1);
    }
    expect(rendererCrashes).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

test("dragging the sidebar splitter to its minimum keeps content in-panel", async () => {
  await setContentSize(760, HEIGHT);
  await openView("Dashboard");

  const handle = page.getByRole("separator", { name: "Resize sidebar" });
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error("sidebar resize handle has no bounding box");

  // Drag the divider hard to the left edge → sidebar collapses to its minSize.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(0, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  // The document must not gain a horizontal scrollbar, and the sidebar's own
  // content (the Chats|Files toggle) must clip within the panel, not spill it.
  expect(await documentOverflow()).toBeLessThanOrEqual(1);

  const sidebarOverflow = await page.evaluate(() => {
    // The shell sidebar is the first resizable panel; assert its content clips
    // within the panel box rather than spilling into the neighbouring column.
    const el = document.querySelector("[data-panel]") as HTMLElement | null;
    if (!el) return 0;
    return Math.max(0, el.scrollWidth - el.clientWidth);
  });
  expect(sidebarOverflow).toBeLessThanOrEqual(1);

  expect(rendererCrashes).toEqual([]);
  expect(pageErrors).toEqual([]);
});

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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

async function installMockLinearIssueIpc(): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const channels = [
      "linear:status",
      "linear:teams",
      "linear:projects",
      "linear:issues",
    ] as const;
    for (const channel of channels) ipcMain.removeHandler(channel);

    ipcMain.handle("linear:status", async () => ({
      status: "authenticated",
      writesEnabled: false,
      viewer: { id: "u1", name: "Ada Lovelace" },
    }));
    ipcMain.handle("linear:teams", async () => [
      { id: "team-1", key: "LOO", name: "Long Operations" },
    ]);
    ipcMain.handle("linear:projects", async () => [
      { id: "project-1", name: "Factory Nucleus With A Long Name" },
    ]);
    ipcMain.handle("linear:issues", async () => [
      {
        id: "age-900",
        identifier: "AGE-900",
        title:
          "Add shared agent deterministic checkpoint title rendering without clipping adjacent state badges",
        url: "https://linear.app/dylanmccavitt/issue/AGE-900",
        priority: 1,
        state: { name: "Backlog", type: "backlog" },
        team: { key: "LOO" },
        project: { name: "Factory Nucleus With A Long Name" },
        assignee: { name: "Ada Lovelace With A Long Name" },
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-26T00:00:00.000Z",
      },
    ]);
  });
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

test("real Linear issue rows stay inside a narrow tool panel", async () => {
  await setContentSize(760, HEIGHT);
  await installMockLinearIssueIpc();
  await openView("Linear");

  const panel = page.getByRole("complementary", { name: "Linear panel" });
  const row = panel.locator("button", { hasText: "AGE-900" }).first();
  await expect(row).toBeVisible();
  await expect(
    row.getByText(
      "Add shared agent deterministic checkpoint title rendering without clipping adjacent state badges",
    ),
  ).toBeVisible();
  await expect(row.getByText("Urgent")).toBeVisible();
  await expect(row.getByText("Backlog")).toBeVisible();
  await expect(row.getByText("LOO")).toBeVisible();

  expect(await documentOverflow()).toBeLessThanOrEqual(1);
  const panelOverflow = await panel.evaluate((el) =>
    Math.max(0, el.scrollWidth - el.clientWidth),
  );
  expect(panelOverflow).toBeLessThanOrEqual(1);
  const rowOverflow = await row.evaluate((el) =>
    Math.max(0, el.scrollWidth - el.clientWidth),
  );
  expect(rowOverflow).toBeLessThanOrEqual(1);

  const panelBox = await panel.boundingBox();
  const rowBox = await row.boundingBox();
  if (!panelBox || !rowBox) throw new Error("Linear row has no bounding box");
  expect(rowBox.x).toBeGreaterThanOrEqual(panelBox.x);
  expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(
    panelBox.x + panelBox.width + 1,
  );

  expect(rendererCrashes).toEqual([]);
  expect(pageErrors).toEqual([]);
});

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

// AGE-666 — the chat transcript + composer must fill a widening chat column
// instead of staying pinned to the old centered 768px band (max-w-3xl), capped
// only by a generous 72rem readability ceiling. The composer/transcript wrappers
// mount solely with a live session, which this hermetic harness (unresolvable
// OMP_BINARY, no renderer store seam) can never reach. So the fill is proven at
// two layers: a source guard that both wrappers use the SAME max class (and the
// old band is gone), and a runtime probe that injects the exact wrapper classes
// and measures what the BUILT Tailwind stylesheet resolves them to in a wide
// panel — the old class capped at 768px; the new one must track the panel and
// cap at 72rem.
const SHARED_MAX = "max-w-[min(100%,72rem)]";
const TRANSCRIPT_WRAPPER = `mx-auto flex w-full ${SHARED_MAX} flex-col gap-4`;
const COMPOSER_WRAPPER = `mx-auto w-full ${SHARED_MAX}`;

function readComponent(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

test("the chat transcript and composer fill a wide panel up to the 72rem ceiling", async () => {
  await setContentSize(1680, HEIGHT);

  // Source guard: both wrappers share the identical max (so they stay aligned),
  // the retired 768px band (max-w-3xl) is gone, and the composer carries its
  // stable measurement hook.
  const composerSrc = readComponent(
    "../src/renderer/src/components/chat/Composer.tsx",
  );
  const messageListSrc = readComponent(
    "../src/renderer/src/components/chat/MessageList.tsx",
  );
  expect(composerSrc).toContain('data-testid="composer-width"');
  expect(composerSrc).toContain(SHARED_MAX);
  expect(composerSrc).not.toContain("max-w-3xl");
  expect(messageListSrc).toContain(SHARED_MAX);
  expect(messageListSrc).not.toContain("max-w-3xl");

  // Runtime guard: measure the compiled classes inside a wide (1500px) and a
  // narrow (900px) panel. Probes are fixed/hidden and removed in-place so they
  // never pollute the document or sibling tests.
  const probe = await page.evaluate(
    ({ transcriptCls, composerCls }) => {
      const rootPx =
        parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const measure = (parentWidth: number, className: string): number => {
        const outer = document.createElement("div");
        outer.style.cssText = `position:fixed;top:0;left:0;width:${parentWidth}px;visibility:hidden;pointer-events:none;`;
        const child = document.createElement("div");
        child.className = className;
        outer.appendChild(child);
        document.body.appendChild(outer);
        const width = child.getBoundingClientRect().width;
        outer.remove();
        return width;
      };
      return {
        rootPx,
        wideTranscript: measure(1500, transcriptCls),
        wideComposer: measure(1500, composerCls),
        narrowComposer: measure(900, composerCls),
      };
    },
    { transcriptCls: TRANSCRIPT_WRAPPER, composerCls: COMPOSER_WRAPPER },
  );

  const ceiling = 72 * probe.rootPx; // 72rem in px (1152 at the default 16px root)

  // Substantially wider than the retired 768px band → the content now fills.
  expect(probe.wideComposer).toBeGreaterThan(1000);
  expect(probe.wideTranscript).toBeGreaterThan(1000);
  // …but still capped below the 1500px panel — a readability ceiling, not 100%.
  expect(probe.wideComposer).toBeLessThan(1500);
  expect(Math.abs(probe.wideComposer - ceiling)).toBeLessThanOrEqual(2);
  expect(Math.abs(probe.wideTranscript - ceiling)).toBeLessThanOrEqual(2);
  // Transcript and composer share the identical max → they stay aligned.
  expect(probe.wideTranscript).toBe(probe.wideComposer);
  // Below the ceiling the wrapper tracks the panel width exactly (min → 100%).
  expect(Math.abs(probe.narrowComposer - 900)).toBeLessThanOrEqual(1);

  expect(rendererCrashes).toEqual([]);
  expect(pageErrors).toEqual([]);
});

// AGE-674 — the Usage/Plan/Subagents panels moved out of the middle chat rail
// into a bounded dock at the bottom of the left sidebar (`ChatPanelDock`). Like
// AGE-666's transcript fill, the dock only mounts with a live session this
// hermetic harness can't reach, so the new placement is proven at two layers: a
// source guard that the middle rail is gone and the sidebar dock is wired, and a
// runtime probe that the dock's bounding classes cap its height (≤45% of the
// sidebar) and scroll internally instead of spilling — the "no overflow/dead
// space" invariant.
const DOCK_BOUND = "max-h-[45%] overflow-y-auto";

test("the chat panels live in a bounded sidebar dock, not a middle rail", async () => {
  await setContentSize(1680, HEIGHT);

  // Source guard: the middle-rail apparatus is gone from the chat view, and the
  // three panels are mounted by the sidebar dock instead.
  const chatSrc = readComponent("../src/renderer/src/views/Chat.tsx");
  for (const gone of [
    "ChatRailSplit",
    "RightRail",
    "RailIconStrip",
    "Resize panel rail",
  ]) {
    expect(chatSrc).not.toContain(gone);
  }
  const sidebarSrc = readComponent(
    "../src/renderer/src/components/Sidebar.tsx",
  );
  expect(sidebarSrc).toContain("<ChatPanelDock");
  const dockSrc = readComponent(
    "../src/renderer/src/components/chat/ChatPanelDock.tsx",
  );
  expect(dockSrc).toContain("SessionStatsPanel");
  expect(dockSrc).toContain("TodoPanel");
  expect(dockSrc).toContain("SubagentTree");
  expect(dockSrc).toContain("max-h-[45%]");
  expect(dockSrc).toContain("overflow-y-auto");

  // Runtime guard: the dock's bounding classes cap an over-tall stack at 45% of
  // a fixed-height sidebar and scroll inside — never pushing the column taller.
  const probe = await page.evaluate(
    ({ boundCls }) => {
      const parentHeight = 1000;
      const outer = document.createElement("div");
      outer.style.cssText = `position:fixed;top:0;left:0;width:300px;height:${parentHeight}px;visibility:hidden;pointer-events:none;`;
      const dock = document.createElement("div");
      dock.className = boundCls;
      const tall = document.createElement("div");
      tall.style.height = "5000px";
      dock.appendChild(tall);
      outer.appendChild(dock);
      document.body.appendChild(outer);
      const height = dock.getBoundingClientRect().height;
      const scrolls = dock.scrollHeight > dock.clientHeight + 1;
      outer.remove();
      return { parentHeight, height, scrolls };
    },
    { boundCls: DOCK_BOUND },
  );

  // Capped at 45% of the 1000px sidebar (≈450px), not the full 5000px content.
  expect(
    Math.abs(probe.height - 0.45 * probe.parentHeight),
  ).toBeLessThanOrEqual(2);
  expect(probe.scrolls).toBe(true);

  expect(rendererCrashes).toEqual([]);
  expect(pageErrors).toEqual([]);
});

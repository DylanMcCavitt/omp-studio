import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

// Non-live, hermetic Electron UI-flow regression suite (AGE-654).
//
// Companion to e2e/smoke.spec.ts: it reuses the SAME hermetic bootstrap (built
// app, temp userData seeded with a v2 settings.json that selects a temp
// workspace, omp/gh forced to an unresolvable binary so no child is spawned and
// no paid turn runs) and then exercises the polished v3 shell as a real user
// would. Beyond "every panel opens", it pins the UI/UX invariants the polish
// sweep is responsible for:
//   - every rail panel destination owns exactly ONE canonical title heading (the
//     shell no longer renders the panel name, so a stray "eyebrow" duplicate is
//     a regression);
//   - Settings opens as a floating modal over the existing center view, then
//     dismisses on Escape;
//   - dismissing the terminal gate frees the UI (its scrim must not linger and
//     swallow the next click);
//   - the Files/Chats sidebar toggle, opening a file into CodeMirror, and the
//     Cmd/Ctrl+K navigation palette all behave.
// It NEVER starts a chat, enables the terminal/browser, or saves a file, so the
// result is identical whether or not omp/gh are installed.
//
// Prerequisite: `npm run build` (so out/main/index.js exists). Run with
// `npm run build && npm run test:e2e`; on headless Linux CI wrap with
// `xvfb-run -a npm run test:e2e`.

// Shared, serial state: one Electron instance, driven through ordered flows.
test.describe.configure({ mode: "serial" });

const mainEntry = fileURLToPath(
  new URL("../out/main/index.js", import.meta.url),
);

const README_TEXT = "# Smoke workspace\n\nOpened from the v3 file tree.\n";

// Each docked rail destination, with its canonical title (the single <h1> the view
// owns) and any extra content proof. `title: null` => the panel renders no
// heading in the hermetic state (Browser's disabled enable card), so we instead
// assert it grew NO heading of its own. `closeVia: "terminal-gate"` => the
// terminal panel is closed by the gate's "Not now" (which calls closePanel),
// not by toggling the rail button.
type Destination = {
  label: string;
  title: string | null;
  afterOpen?: (panel: Locator, page: Page) => Promise<void>;
  extra?: (panel: Locator) => Promise<void>;
  closeVia?: "terminal-gate";
};

const RAIL_DESTINATIONS: readonly Destination[] = [
  {
    label: "Dashboard",
    title: "Dashboard",
    extra: async (panel) => {
      await expect(
        panel.getByText("Overview of your Oh My Pi harness"),
      ).toBeVisible();
    },
  },
  { label: "Skills", title: "Skills & Commands" },
  { label: "MCP", title: "MCP Servers" },
  { label: "Agents", title: "Agents" },
  {
    label: "Terminal",
    title: "Terminal",
    closeVia: "terminal-gate",
    afterOpen: async (_panel, p) => {
      await expect(
        p.getByRole("dialog", { name: "Enable the terminal?" }),
      ).toBeVisible();
    },
  },
  {
    label: "Browser",
    title: null,
    extra: async (panel) => {
      await expect(
        panel.getByRole("button", { name: "Enable embedded browser" }),
      ).toBeVisible();
    },
  },
  { label: "Changes", title: "Changes" },
  { label: "GitHub", title: "GitHub" },
  {
    label: "Linear",
    title: "Linear",
    extra: async (panel) => {
      await expect(panel.getByLabel("Linear API key")).toBeVisible();
    },
  },
] as const;

let app: ElectronApplication;
let page: Page;
let tempAgentDir: string;
let tempUserDataDir: string;
let tempWorkspaceDir: string;
const pageErrors: Error[] = [];
const rendererCrashes: string[] = [];

test.beforeAll(async () => {
  // Hermetic, non-live posture — identical levers to smoke.spec.ts:
  //   - omp/gh point at a nonexistent binary, so data services degrade
  //     gracefully and spawn NO omp/gh children;
  //   - PI_CODING_AGENT_DIR points at an empty temp dir;
  //   - --user-data-dir seeds a v2 settings.json with terminal/browser OFF and
  //     the temp workspace selected;
  //   - the temp workspace holds real files for the Files surface.
  // OMP_STUDIO_SMOKE keeps the window hidden without changing what mounts.
  tempAgentDir = mkdtempSync(join(tmpdir(), "omp-studio-e2e-ui-"));
  tempUserDataDir = mkdtempSync(join(tmpdir(), "omp-studio-e2e-ui-data-"));
  tempWorkspaceDir = mkdtempSync(
    join(tmpdir(), "omp-studio-e2e-ui-workspace-"),
  );

  mkdirSync(join(tempWorkspaceDir, "src"), { recursive: true });
  writeFileSync(join(tempWorkspaceDir, "README.md"), README_TEXT, "utf8");
  writeFileSync(
    join(tempWorkspaceDir, "src", "index.ts"),
    "export const smoke = 'nested file';\n",
    "utf8",
  );
  writeFileSync(
    join(tempUserDataDir, "settings.json"),
    `${JSON.stringify(
      {
        version: 2,
        theme: "system",
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
            id: "smoke-workspace",
            cwd: tempWorkspaceDir,
            label: "Smoke workspace",
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

function railNav(): Locator {
  return page.getByRole("navigation", { name: "Tools" });
}

function railButton(label: string): Locator {
  return railNav().getByRole("button", { name: label, exact: true });
}

function railPanel(label: string): Locator {
  return page.getByRole("complementary", { name: `${label} panel` });
}

async function openDestination(
  label: string,
): Promise<{ button: Locator; panel: Locator }> {
  const button = railButton(label);
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const panel = railPanel(label);
  await expect(panel).toBeVisible();
  return { button, panel };
}

async function closeViaRail(label: string): Promise<void> {
  const button = railButton(label);
  if ((await button.getAttribute("aria-pressed")) === "true") {
    await button.click();
  }
  await expect(railPanel(label)).toBeHidden();
  await expect(button).toHaveAttribute("aria-pressed", "false");
}

// Flow 1 — boot.
test("the shell boots with the OMP Studio title, Tools rail, and sidebar", async () => {
  expect(await page.title()).toBe("OMP Studio");

  await expect(railNav()).toBeVisible();
  await expect(railNav().getByRole("button")).toHaveCount(
    RAIL_DESTINATIONS.length + 1,
  );

  // Sidebar rendered: the seeded workspace switcher + the Chats|Files toggle.
  await expect(
    page.getByRole("button", { name: "Smoke workspace", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Chats", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Files", exact: true }),
  ).toBeVisible();
});

// Flow 2 — every docked rail destination opens, renders content, exposes exactly one
// canonical title (no duplicate eyebrow), surfaces no error boundary, and
// closes cleanly.
test("each rail destination opens, renders its content, and owns exactly one canonical title", async () => {
  for (const dest of RAIL_DESTINATIONS) {
    const { button, panel } = await openDestination(dest.label);

    if (dest.title) {
      // The view owns its single <h1>; the shell chrome no longer renders the
      // title. The canonical name must appear as a visible level-1 heading...
      await expect(
        panel.getByRole("heading", {
          name: dest.title,
          level: 1,
          exact: true,
        }),
      ).toBeVisible();
      // ...and EXACTLY once across all heading levels (a duplicate eyebrow
      // heading with the same name is the regression we guard).
      await expect(
        panel.getByRole("heading", { name: dest.title, exact: true }),
      ).toHaveCount(1);
    } else {
      // Browser's disabled enable card renders no heading and must not grow an
      // eyebrow title of its own.
      await expect(
        panel.getByRole("heading", { name: dest.label, exact: true }),
      ).toHaveCount(0);
    }

    await dest.afterOpen?.(panel, page);
    await dest.extra?.(panel);

    // No error boundary / alert region rendered inside the panel.
    await expect(panel.getByRole("alert")).toHaveCount(0);
    expect(rendererCrashes).toEqual([]);

    if (dest.closeVia === "terminal-gate") {
      // "Not now" calls closePanel(), so dismissing the gate IS the close.
      await page.getByRole("button", { name: "Not now", exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "Enable the terminal?" }),
      ).toBeHidden();
      await expect(panel).toBeHidden();
      await expect(button).toHaveAttribute("aria-pressed", "false");
    } else {
      await closeViaRail(dest.label);
    }
  }
});

// Flow 3 — terminal-gate regression: a dismissed gate must not leave a scrim
// that intercepts the next pointer interaction.
test("dismissing the terminal gate frees the UI to open another panel", async () => {
  const terminalButton = railButton("Terminal");
  await terminalButton.click();
  await expect(terminalButton).toHaveAttribute("aria-pressed", "true");

  const gate = page.getByRole("dialog", { name: "Enable the terminal?" });
  await expect(gate).toBeVisible();

  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(gate).toBeHidden();

  // The dismissed gate's scrim must be gone: clicking Dashboard in the rail
  // right after must actually open the Dashboard panel.
  const { panel } = await openDestination("Dashboard");
  await expect(
    panel.getByRole("heading", { name: "Dashboard", level: 1, exact: true }),
  ).toBeVisible();

  await closeViaRail("Dashboard");
});

// Flow 4 — the left sidebar toggles between the Files tree and the Chats list.
test("the sidebar toggles between Files and Chats", async () => {
  const filesTab = page.getByRole("button", { name: "Files", exact: true });
  const chatsTab = page.getByRole("button", { name: "Chats", exact: true });

  await filesTab.click();
  await expect(filesTab).toHaveAttribute("aria-pressed", "true");

  const tree = page.getByRole("tree", { name: "Workspace files" });
  await expect(tree).toBeVisible();
  await expect(
    tree.getByRole("treeitem", { name: "README.md", exact: true }),
  ).toBeVisible();

  await chatsTab.click();
  await expect(chatsTab).toHaveAttribute("aria-pressed", "true");
  await expect(tree).toBeHidden();
  // Back on the Chats surface: the sidebar's canonical New chat action is shown.
  // (The same unified CTA also appears in the center empty state, so scope to the
  // unnamed sidebar <nav> — the rail <nav> carries aria-label="Tools".)
  await expect(
    page
      .locator("nav:not([aria-label])")
      .getByRole("button", { name: "New chat", exact: true }),
  ).toBeVisible();
});

// Flow 5 — opening a real workspace file renders it in the center CodeMirror.
test("opening README.md from the tree renders it in CodeMirror", async () => {
  await page.getByRole("button", { name: "Files", exact: true }).click();
  const tree = page.getByRole("tree", { name: "Workspace files" });
  const readme = tree.getByRole("treeitem", {
    name: "README.md",
    exact: true,
  });
  await expect(readme).toBeVisible();
  await readme.click();

  const editor = page.getByTestId("cm-editor");
  await expect(editor).toBeVisible();
  await expect(editor.locator(".cm-content")).toContainText(
    "# Smoke workspace",
  );
  await expect(editor.locator(".cm-content")).toContainText(
    "Opened from the v3 file tree.",
  );
});

// Flow 6 — Settings is a floating modal, not a docked rail panel, and the center
// editor stays mounted behind it.
test("Settings opens as a modal over the current center and dismisses on Escape", async () => {
  const editor = page.getByTestId("cm-editor");
  await expect(editor).toBeVisible();

  const settingsButton = railButton("Settings");
  await settingsButton.click();
  await expect(settingsButton).toHaveAttribute("aria-pressed", "true");

  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Settings panel" }),
  ).toHaveCount(0);
  await expect(dialog.getByText("Defaults", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Appearance", { exact: true })).toBeVisible();
  await expect(editor).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(settingsButton).toHaveAttribute("aria-pressed", "false");
  await expect(editor).toBeVisible();
});

// Flow 7 — the ⌘K navigation palette opens on Cmd/Ctrl+K, lists workspaces,
// jumps + closes on selecting a row, and closes on Escape (AGE-700).
test("the navigation palette opens with Cmd/Ctrl+K, jumps, and closes", async () => {
  // Move focus off any editable element (e.g. the CodeMirror content) so the
  // global chord is treated as a shortcut, not typing.
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });

  const palette = page.getByRole("dialog", { name: "Navigate" });
  const openKey = process.platform === "darwin" ? "Meta+K" : "Control+K";
  await expect(palette).toBeHidden();

  // Open → it lists the Workspaces group with the seeded workspace.
  await page.keyboard.press(openKey);
  await expect(palette).toBeVisible();
  await expect(palette.getByText("Workspaces")).toBeVisible();
  const workspaceRow = palette.getByRole("option", {
    name: /Smoke workspace/,
  });
  await expect(workspaceRow).toBeVisible();

  // Selecting the (already-current) workspace jumps and closes — no confirm.
  await workspaceRow.click();
  await expect(palette).toBeHidden();

  // Re-open and confirm Escape closes it too.
  await page.keyboard.press(openKey);
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

// Flow 8 — the whole run must be clean.
test("no uncaught renderer errors or crashes occurred during the UI-flow run", () => {
  expect(pageErrors).toEqual([]);
  expect(rendererCrashes).toEqual([]);
});

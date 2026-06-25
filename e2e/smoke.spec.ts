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
  type Locator,
  type Page,
  test,
} from "@playwright/test";

// Non-live, hermetic Electron smoke test.
//
// It launches the BUILT app (out/main/index.js) and verifies that the v3 shell
// boots, the right rail opens every destination panel without crashing, and the
// workspace-scoped Files surface can open a real temp file in CodeMirror. It
// never starts a chat and forces omp/gh to be unresolvable (see beforeAll), so
// NO omp/gh child is spawned, no paid model turn runs, and the result is
// identical whether or not omp/gh are installed.
//
// Prerequisite: `npm run build` (so out/main/index.js exists). Run the whole
// flow with `npm run build && npm run test:e2e`. On headless Linux CI, wrap with
// xvfb: `xvfb-run -a npm run test:e2e`.

const mainEntry = fileURLToPath(
  new URL("../out/main/index.js", import.meta.url),
);

const README_TEXT = "# Smoke workspace\n\nOpened from the v3 file tree.\n";
const LIVE_SAVED_TEXT =
  "# Smoke workspace\n\nEdited and saved by the live e2e smoke.\n";

const RAIL_DESTINATIONS: readonly {
  label: string;
  assertRendered: (panel: Locator) => Promise<void>;
  afterOpen?: (page: Page) => Promise<void>;
}[] = [
  { label: "Dashboard", assertRendered: heading("Dashboard") },
  { label: "Skills", assertRendered: heading("Skills & Commands") },
  { label: "MCP", assertRendered: heading("MCP Servers") },
  { label: "Agents", assertRendered: heading("Agents") },
  {
    label: "Terminal",
    assertRendered: heading("Terminal"),
    afterOpen: async (p) => {
      const gate = p.getByRole("dialog", { name: "Enable the terminal?" });
      await expect(gate).toBeVisible();
      await p.getByRole("button", { name: "Not now" }).click();
      await expect(gate).toBeHidden();
    },
  },
  {
    label: "Browser",
    assertRendered: async (panel) => {
      await expect(
        panel.getByRole("button", { name: "Enable embedded browser" }),
      ).toBeVisible();
    },
  },
  {
    label: "GitHub",
    assertRendered: async (panel) => {
      await heading("GitHub")(panel);
      await expect(panel.getByRole("button", { name: "Repos" })).toBeVisible();
    },
  },
  {
    label: "Linear",
    assertRendered: async (panel) => {
      await expect(panel.getByLabel("Linear API key")).toBeVisible();
    },
  },
  { label: "Settings", assertRendered: heading("Settings") },
] as const;

function heading(name: string) {
  return async (panel: Locator) => {
    await expect(
      panel.getByRole("heading", { name, level: 1, exact: true }),
    ).toBeVisible();
  };
}

let app: ElectronApplication;
let page: Page;
let tempAgentDir: string;
let tempUserDataDir: string;
let tempWorkspaceDir: string;
const pageErrors: Error[] = [];
const rendererCrashes: string[] = [];

test.beforeAll(async () => {
  // Hermetic, non-live posture. Four levers make the run deterministic and
  // side-effect-free regardless of the host:
  //   - omp/gh point at a nonexistent binary, so data services hit graceful
  //     degradation and spawn NO omp/gh children;
  //   - PI_CODING_AGENT_DIR points at an empty temp dir, so session/MCP/skills
  //     discovery reads an empty tree;
  //   - --user-data-dir points Electron's userData at a temp dir seeded with a
  //     v2 settings.json that keeps terminal/browser off and selects the temp
  //     workspace;
  //   - the temp workspace contains real files for the Files IPC smoke.
  // OMP_STUDIO_SMOKE keeps the window hidden (headless/CI friendly) without
  // changing what the renderer mounts.
  tempAgentDir = mkdtempSync(join(tmpdir(), "omp-studio-e2e-"));
  tempUserDataDir = mkdtempSync(join(tmpdir(), "omp-studio-e2e-data-"));
  tempWorkspaceDir = mkdtempSync(join(tmpdir(), "omp-studio-e2e-workspace-"));

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

test("window reports the OMP Studio title", async () => {
  expect(await page.title()).toBe("OMP Studio");
});

test("titlebar exposes the Live Dot navigation controls", async () => {
  await expect(
    page.getByRole("button", { name: "Open navigation palette" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Switch to (dark|light) theme/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open navigation palette" }).click();
  await expect(page.getByRole("dialog", { name: "Navigate" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Navigate" })).toBeHidden();
});

test("right rail exposes the v3 destinations and each panel opens", async () => {
  const rail = page.getByRole("navigation", { name: "Tools" });
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("button")).toHaveCount(RAIL_DESTINATIONS.length);
  await expect(
    rail.getByRole("button", { name: "Chat", exact: true }),
  ).toHaveCount(0);
  await expect(
    rail.getByRole("button", { name: "Sessions", exact: true }),
  ).toHaveCount(0);

  for (const destination of RAIL_DESTINATIONS) {
    const button = rail.getByRole("button", {
      name: destination.label,
      exact: true,
    });
    await expect(button).toBeVisible();
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");

    const panel = page.getByRole("complementary", {
      name: `${destination.label} panel`,
    });
    await expect(panel).toBeVisible();
    await destination.assertRendered(panel);
    await destination.afterOpen?.(page);
    await expect(panel.getByRole("alert")).toHaveCount(0);
    expect(rendererCrashes).toEqual([]);

    if ((await button.getAttribute("aria-pressed")) === "true") {
      await button.click();
    }
    await expect(panel).toBeHidden();
    await expect(button).toHaveAttribute("aria-pressed", "false");
  }
});

test("left sidebar shows the workspace switcher and Files tree", async () => {
  await expect(
    page.getByRole("button", { name: "Smoke workspace", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Chats", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Files", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  const tree = page.getByRole("tree", { name: "Workspace files" });
  await expect(tree).toBeVisible();
  await expect(page.getByTitle(tempWorkspaceDir)).toHaveText("Smoke workspace");
  await expect(
    tree.getByRole("treeitem", { name: "README.md", exact: true }),
  ).toBeVisible();
  await expect(
    tree.getByRole("treeitem", { name: "src", exact: true }),
  ).toBeVisible();
});

test("opening a file renders a center CodeMirror editor tab", async () => {
  const editor = await openReadmeFromTree();

  await expect(
    page.getByRole("tab", { name: "README.md", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(editor.locator(".cm-content")).toContainText(
    "# Smoke workspace",
  );
  await expect(editor.locator(".cm-content")).toContainText(
    "Opened from the v3 file tree.",
  );
});

test("old start-session card is absent", async () => {
  await expect(
    page.getByText("Start a new session", { exact: true }),
  ).toHaveCount(0);
});

const liveTest = process.env.STUDIO_E2E_LIVE ? test : test.skip;

liveTest("LIVE: editing a file saves it through the Files IPC", async () => {
  const editor = await openReadmeFromTree();
  const cmContent = editor.locator(".cm-content").first();

  await cmContent.click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+A" : "Control+A",
  );
  await page.keyboard.type(LIVE_SAVED_TEXT);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect
    .poll(() => readFileSync(join(tempWorkspaceDir, "README.md"), "utf8"))
    .toBe(LIVE_SAVED_TEXT);
});

test("no uncaught renderer errors occurred during the smoke run", () => {
  expect(pageErrors).toEqual([]);
  expect(rendererCrashes).toEqual([]);
});

async function openReadmeFromTree() {
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
  return editor;
}

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
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

const mainEntry = fileURLToPath(
  new URL("../out/main/index.js", import.meta.url),
);

let app: ElectronApplication;
let page: Page;
let server: Server;
let localUrl: string;
let tempAgentDir: string;
let tempUserDataDir: string;
let tempWorkspaceDir: string;
const pageErrors: Error[] = [];
const rendererCrashes: string[] = [];

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<title>OMP Browser Fixture</title><h1>Browser fixture</h1>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local port");
  localUrl = `http://127.0.0.1:${address.port}/fixture`;

  tempAgentDir = mkdtempSync(join(tmpdir(), "omp-studio-browser-e2e-"));
  tempUserDataDir = mkdtempSync(join(tmpdir(), "omp-studio-browser-data-"));
  tempWorkspaceDir = mkdtempSync(
    join(tmpdir(), "omp-studio-browser-workspace-"),
  );
  mkdirSync(tempWorkspaceDir, { recursive: true });
  writeFileSync(
    join(tempWorkspaceDir, "README.md"),
    "# Browser smoke\n",
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
            id: "browser-workspace",
            cwd: tempWorkspaceDir,
            label: "Browser workspace",
            pinned: true,
            lastUsedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        linear: { writesEnabled: false },
        terminal: { enabled: false, maxConcurrent: 4 },
        browser: { enabled: true },
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
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (tempAgentDir) rmSync(tempAgentDir, { recursive: true, force: true });
  if (tempUserDataDir)
    rmSync(tempUserDataDir, { recursive: true, force: true });
  if (tempWorkspaceDir)
    rmSync(tempWorkspaceDir, { recursive: true, force: true });
});

test("browser tabs create, switch, navigate, bookmark, revisit, clear metadata, and close from the UI", async () => {
  await page.getByRole("button", { name: "Browser", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Browser panel" });
  await expect(panel.getByText("Start with an http(s) URL.")).toBeVisible();

  const tabStrip = panel.getByLabel("Browser tabs");
  const address = panel.getByLabel("Address");
  const bookmarks = panel.getByRole("combobox", { name: "Bookmarks" });
  const recentPages = panel.getByRole("combobox", { name: "Recent pages" });
  const clearMetadata = panel.getByRole("button", {
    name: "Clear browser bookmarks and history metadata",
  });

  await expect(tabStrip).toBeVisible();
  await expect(tabStrip.getByText("New tab", { exact: true })).toHaveCount(1);
  await expect(address).toHaveValue("");
  await expect(
    panel.getByRole("button", { name: "Save current page bookmark" }),
  ).toBeDisabled();
  await expect(bookmarks).toBeDisabled();
  await expect(recentPages).toBeDisabled();
  await expect(clearMetadata).toBeDisabled();

  await panel.getByRole("button", { name: "New browser tab" }).click();
  await expect(tabStrip.getByText("New tab", { exact: true })).toHaveCount(2);

  await address.fill(localUrl);
  await panel.getByRole("button", { name: "Go" }).click();

  await expect(address).toHaveValue(localUrl);
  await expect(
    tabStrip.getByText("OMP Browser Fixture", { exact: true }),
  ).toBeVisible();
  await expect(recentPages).toBeEnabled();

  await panel
    .getByRole("button", { name: "Save current page bookmark" })
    .click();
  await expect(
    panel.getByRole("button", { name: "Remove current page bookmark" }),
  ).toBeEnabled();
  await expect(bookmarks).toBeEnabled();

  await tabStrip.getByText("New tab", { exact: true }).click();
  await expect(address).toHaveValue("");
  await expect(panel.getByText("Start with an http(s) URL.")).toBeVisible();

  await bookmarks.click();
  await page.getByRole("option", { name: /OMP Browser Fixture/ }).click();
  await expect(address).toHaveValue(localUrl);

  await panel.getByRole("button", { name: "New browser tab" }).click();
  await expect(address).toHaveValue("");
  await recentPages.click();
  await page.getByRole("option", { name: /OMP Browser Fixture/ }).click();
  await expect(address).toHaveValue(localUrl);

  await clearMetadata.click();
  await expect(
    panel.getByRole("button", { name: "Save current page bookmark" }),
  ).toBeEnabled();
  await expect(bookmarks).toBeDisabled();
  await expect(recentPages).toBeDisabled();
  await expect(clearMetadata).toBeDisabled();

  await expect(
    tabStrip.getByText("OMP Browser Fixture", { exact: true }),
  ).toHaveCount(3);

  await tabStrip
    .getByRole("button", { name: "Close tab 3: OMP Browser Fixture" })
    .click();
  await expect(
    tabStrip.getByText("OMP Browser Fixture", { exact: true }),
  ).toHaveCount(2);
  await expect(address).toHaveValue(localUrl);

  await expect(panel.getByRole("alert")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(rendererCrashes).toEqual([]);
});

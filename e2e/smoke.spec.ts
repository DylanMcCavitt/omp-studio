import {
  chmodSync,
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
// uses a fake omp binary that only answers `omp stats --json`, forces gh to be
// unresolvable (see beforeAll), starts no chat, spawns no real omp/gh child, and
// runs no paid model turn.
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
  {
    label: "Dashboard",
    assertRendered: async (panel) => {
      await heading("Dashboard")(panel);
      await expect(
        panel.getByRole("heading", { name: "Overview" }),
      ).toBeVisible();
      await expect(
        panel.getByText("Total cost", { exact: true }),
      ).toBeVisible();
      await expect(panel.getByText("Requests", { exact: true })).toBeVisible();
      await expect(panel.getByText("Token Usage by Agent")).toBeVisible();
      await expect(panel.getByText("System Throughput")).toBeVisible();
      await expect(panel.getByText("Top models")).toBeVisible();
    },
  },
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
    label: "Changes",
    assertRendered: heading("Changes"),
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
      await heading("Linear")(panel);
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
  // Hermetic, non-live posture. Five levers make the run deterministic and
  // side-effect-free regardless of the host:
  //   - omp points at a fake script that only returns a small stats JSON payload,
  //     so the Dashboard proves the native stats UI without touching real logs;
  //   - gh points at a nonexistent binary, so GitHub IPC degrades gracefully and
  //     spawns no real gh child;
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

  const fakeOmp = join(tempAgentDir, "omp");
  const fakeSessionsDir = join(tempAgentDir, "sessions", "smoke-workspace");
  mkdirSync(fakeSessionsDir, { recursive: true });
  const fakeSubagentSessionFile = join(fakeSessionsDir, "subagent-live.jsonl");
  writeFileSync(fakeSubagentSessionFile, "", "utf8");
  const fakeStats = {
    overall: {
      totalRequests: 123,
      failedRequests: 4,
      errorRate: 4 / 123,
      totalInputTokens: 1000,
      totalOutputTokens: 250,
      totalCacheReadTokens: 5000,
      totalCacheWriteTokens: 0,
      cacheRate: 5000 / 6250,
      totalCost: 12.34,
      totalPremiumRequests: 0,
      avgDuration: 9000,
      avgTtft: 3200,
      avgTokensPerSecond: 42.5,
      lastTimestamp: Date.now(),
    },
    byModel: [
      {
        provider: "openai-codex",
        model: "gpt-5.5",
        totalRequests: 123,
        totalCost: 12.34,
      },
    ],
    byFolder: [
      {
        folder: tempWorkspaceDir,
        totalRequests: 123,
        totalCost: 12.34,
      },
    ],
    byAgentType: [
      {
        agentType: "main",
        totalRequests: 80,
        totalInputTokens: 800,
        totalOutputTokens: 150,
        totalCacheReadTokens: 3000,
        totalCacheWriteTokens: 0,
      },
      {
        agentType: "subagent",
        totalRequests: 43,
        totalInputTokens: 200,
        totalOutputTokens: 100,
        totalCacheReadTokens: 2000,
        totalCacheWriteTokens: 0,
      },
    ],
    timeSeries: [
      { timestamp: Date.now() - 60_000, requests: 40, errors: 1 },
      { timestamp: Date.now(), requests: 83, errors: 3 },
    ],
    costSeries: [
      {
        provider: "openai-codex",
        model: "gpt-5.5",
        totalRequests: 123,
        totalCost: 12.34,
      },
    ],
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(
    fakeOmp,
    `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const subagentSessionFile = ${JSON.stringify(fakeSubagentSessionFile)};
if (process.argv[2] === "stats" && process.argv.includes("--json")) {
  process.stdout.write(${JSON.stringify(`${JSON.stringify(fakeStats)}\n`)});
  process.exit(0);
}
const modeIdx = process.argv.indexOf("--mode");
if (modeIdx === -1 || process.argv[modeIdx + 1] !== "rpc-ui") {
  process.exit(1);
}
const state = {
  model: null,
  thinkingLevel: "medium",
  isStreaming: false,
  isCompacting: false,
  steeringMode: "all",
  followUpMode: "all",
  interruptMode: "immediate",
  autoCompactionEnabled: false,
  messageCount: 0,
  queuedMessageCount: 0,
  todoPhases: [],
  sessionName: "Hermetic live subagent",
};
const subagent = {
  id: "sub-live",
  index: 0,
  agent: "task",
  agentSource: "bundled",
  description: "Live drill child",
  task: "Emit hermetic subagent transcript updates",
  status: "running",
  sessionFile: subagentSessionFile,
  lastUpdate: Date.now(),
};
let subagentVisible = false;
let childMessages = [];
let childJsonl = "";
let scheduled = false;
function response(id, data) {
  process.stdout.write(JSON.stringify({ type: "response", id, success: true, data }) + "\\n");
}
function emit(frame) {
  process.stdout.write(JSON.stringify(frame) + "\\n");
}
function progress(status = subagent.status) {
  return {
    index: 0,
    id: subagent.id,
    agent: subagent.agent,
    agentSource: subagent.agentSource,
    status,
    task: subagent.task,
    description: subagent.description,
    recentTools: [],
    recentOutput: [],
    toolCount: childMessages.length,
    requests: childMessages.length,
    tokens: childMessages.length * 10,
  };
}
function appendChildMessage(message) {
  childMessages = [...childMessages, message];
  const line = JSON.stringify({ type: "message", message }) + "\\n";
  childJsonl += line;
  appendFileSync(subagentSessionFile, line, "utf8");
}
function messagesFromByte(fromByte) {
  const bytes = Buffer.from(childJsonl, "utf8");
  const chunk = bytes.subarray(fromByte).toString("utf8");
  const messages = [];
  for (const rawLine of chunk.split("\\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.type === "message" && rec.message) messages.push(rec.message);
    } catch {}
  }
  return { nextByte: bytes.length, messages };
}
function scheduleSubagentRun() {
  if (scheduled) return;
  scheduled = true;
  state.isStreaming = true;
  emit({ type: "turn_start" });
  setTimeout(() => {
    subagentVisible = true;
    emit({
      type: "subagent_lifecycle",
      payload: {
        id: subagent.id,
        agent: subagent.agent,
        agentSource: subagent.agentSource,
        description: subagent.description,
        status: "started",
        sessionFile: subagent.sessionFile,
        index: subagent.index,
      },
    });
    emit({
      type: "subagent_progress",
      payload: {
        index: subagent.index,
        agent: subagent.agent,
        agentSource: subagent.agentSource,
        task: subagent.task,
        sessionFile: subagent.sessionFile,
        progress: progress("running"),
      },
    });
  }, 100);
  setTimeout(() => {
    appendChildMessage({
      role: "assistant",
      content: [{ type: "text", text: "hermetic child tick 1" }],
    });
    emit({
      type: "subagent_event",
      payload: { id: subagent.id, event: { type: "message_update" } },
    });
  }, 1800);
  setTimeout(() => {
    appendChildMessage({
      role: "assistant",
      content: [{ type: "text", text: "hermetic child tick 2" }],
    });
    emit({
      type: "subagent_event",
      payload: { id: subagent.id, event: { type: "message_update" } },
    });
  }, 2600);
  setTimeout(() => {
    subagent.status = "completed";
    state.isStreaming = false;
    emit({
      type: "subagent_lifecycle",
      payload: {
        id: subagent.id,
        agent: subagent.agent,
        agentSource: subagent.agentSource,
        description: subagent.description,
        status: "completed",
        sessionFile: subagent.sessionFile,
        index: subagent.index,
      },
    });
    emit({ type: "turn_end" });
  }, 3400);
}
process.stdout.write(JSON.stringify({ type: "ready" }) + "\\n");
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let nl;
  while ((nl = buf.indexOf("\\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (!msg || typeof msg.id !== "string") continue;
    if (msg.type === "get_state") response(msg.id, state);
    else if (msg.type === "get_messages") response(msg.id, { messages: [] });
    else if (msg.type === "get_subagents") response(msg.id, { subagents: subagentVisible ? [subagent] : [] });
    else if (msg.type === "get_available_commands") response(msg.id, { commands: [] });
    else if (msg.type === "get_session_stats") response(msg.id, {});
    else if (msg.type === "get_subagent_messages") {
      const from = typeof msg.fromByte === "number" ? msg.fromByte : 0;
      const result = messagesFromByte(from);
      response(msg.id, {
        sessionFile: subagentSessionFile,
        fromByte: from,
        nextByte: result.nextByte,
        reset: false,
        entries: [],
        messages: result.messages,
      });
    } else if (msg.type === "prompt") {
      response(msg.id, {});
      scheduleSubagentRun();
    } else if (msg.type === "set_subagent_subscription" || msg.type === "set_thinking_level" || msg.type === "abort") {
      response(msg.id, {});
    } else {
      response(msg.id, {});
    }
  }
});
`,
    "utf8",
  );
  chmodSync(fakeOmp, 0o755);

  const unresolvable = join(tempAgentDir, "no-such-binary");
  const env = {
    ...process.env,
    // Load the built renderer file, not a leaked dev-server URL.
    ELECTRON_RENDERER_URL: "",
    OMP_STUDIO_SMOKE: "1",
    OMP_BINARY: fakeOmp,
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

test("hermetic fake omp streams a running subagent drill-in transcript", async () => {
  await page.getByRole("button", { name: "Chats", exact: true }).click();
  const chatTab = page.getByRole("tab", { name: "Chat", exact: true });
  if ((await chatTab.count()) > 0) await chatTab.click();
  await page.getByText("New chat", { exact: true }).click();

  await expect(page.getByLabel("Message")).toBeEnabled();
  await page.getByLabel("Message").fill("spawn a hermetic subagent");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  const panels = page.getByRole("button", { name: "Session panels" });
  await expect(panels).toBeVisible();
  await panels.click();

  const inspect = page.getByRole("button", {
    name: /Inspect Live drill child/,
  });
  await expect(inspect).toBeVisible({ timeout: 3_000 });
  await inspect.click();

  await expect(
    page.getByText("Waiting for the subagent's first messages…"),
  ).toBeVisible();
  await expect(page.getByText("hermetic child tick 1")).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText("hermetic child tick 2")).toBeVisible({
    timeout: 5_000,
  });

  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(page.getByRole("button", { name: "Back to chat" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Message")).toBeVisible();
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

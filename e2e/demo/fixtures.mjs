// Hermetic fixture builder for demo recordings.
//
// Builds the same posture as e2e/smoke.spec.ts — temp agent/userdata/workspace
// dirs, a fake `omp`, gh unresolvable — plus a hibernated session whose JSONL
// transcript the fake omp serves back over rpc-ui, so the chat MessageList
// mounts a real conversation with no live harness, credentials, or paid turns.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TOPICS = [
  "the RPC bridge frame ordering",
  "session hibernation and JSONL provenance",
  "the pane-split layout weights",
  "terminal gating invariants",
  "the browser sandbox boundary",
  "workspace color-dot wayfinding",
  "transcript virtualization tuning",
  "settings write serialization",
  "the subagent tree drill-in",
  "release packaging on three OSes",
];

/**
 * Seed a demo fixture tree under `baseDir`.
 *
 * @param {string} baseDir
 * @param {{ messageCount?: number, title?: string }} [opts]
 * @returns launch material: dirs, the fake omp path, and the electron env.
 */
export function seedDemoFixtures(baseDir, opts = {}) {
  const messageCount = opts.messageCount ?? 40;
  const title = opts.title ?? "Demo session";
  const agentDir = join(baseDir, "agent");
  const userDataDir = join(baseDir, "userdata");
  const workspaceDir = join(baseDir, "workspace");
  const projectDirName = workspaceDir.replaceAll("/", "-").replace(/^-/, "");
  const sessionDir = join(agentDir, "sessions", projectDirName);
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(userDataDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(join(workspaceDir, "README.md"), "# Demo workspace\n", "utf8");

  const sessionId = "demo-session";
  const sessionFile = join(sessionDir, `${sessionId}.jsonl`);
  writeFakeOmp(join(agentDir, "omp"), { sessionFile, sessionId, title });
  writeTranscript(sessionFile, {
    sessionId,
    workspaceDir,
    title,
    messageCount,
  });
  writeSettings(join(userDataDir, "settings.json"), {
    workspaceDir,
    sessionFile,
    sessionId,
    title,
  });

  return {
    agentDir,
    userDataDir,
    workspaceDir,
    sessionFile,
    launchEnv: {
      ELECTRON_RENDERER_URL: "",
      OMP_BINARY: join(agentDir, "omp"),
      GH_BINARY: join(agentDir, "no-such-binary"),
      PI_CODING_AGENT_DIR: agentDir,
    },
  };
}

function writeFakeOmp(path, { sessionFile, sessionId, title }) {
  const minimalState = {
    model: { provider: "demo", id: "demo-model" },
    thinkingLevel: "medium",
    isStreaming: false,
    isCompacting: false,
    steeringMode: "all",
    followUpMode: "all",
    interruptMode: "immediate",
    autoCompactionEnabled: true,
    messageCount: 0,
    queuedMessageCount: 0,
    todoPhases: [],
    sessionFile,
    sessionId,
    sessionName: title,
  };
  const statsPayload = JSON.stringify(
    JSON.stringify({
      overall: {},
      byModel: [],
      byFolder: [],
      byAgentType: [],
      timeSeries: [],
      costSeries: [],
      generatedAt: new Date().toISOString(),
    }),
  );
  writeFileSync(
    path,
    `#!/usr/bin/env node
// Extensionless file under the repo tree: nearest package.json is type:module,
// so this runs as ESM — no top-level return, no require.
import { readFileSync } from "node:fs";
const statsPayload = ${statsPayload};
const statePayload = ${JSON.stringify(JSON.stringify(minimalState))};
if (process.argv[2] === "stats" && process.argv.includes("--json")) {
  process.stdout.write(statsPayload + "\\n");
  process.exit(0);
}
const modeIdx = process.argv.indexOf("--mode");
if (modeIdx === -1 || process.argv[modeIdx + 1] !== "rpc-ui") {
  process.exit(1);
}
// Serve the resumed transcript: parse the --resume JSONL so get_messages
// returns the hydrated conversation instead of an empty pane.
const messages = [];
const resumeIdx = process.argv.indexOf("--resume");
if (resumeIdx !== -1 && process.argv[resumeIdx + 1]) {
  try {
    const raw = readFileSync(process.argv[resumeIdx + 1], "utf8");
    for (const rawLine of raw.split("\\n")) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      try {
        const rec = JSON.parse(trimmed);
        if (rec.type === "message" && rec.message) messages.push(rec.message);
      } catch {}
    }
  } catch {}
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
    let data = {};
    if (msg.type === "get_state") data = JSON.parse(statePayload);
    else if (msg.type === "get_messages") data = { messages };
    else if (msg.type === "get_subagents") data = { subagents: [] };
    else if (msg.type === "get_available_commands") data = { commands: [] };
    else if (msg.type === "get_session_stats") data = {};
    process.stdout.write(JSON.stringify({ type: "response", id: msg.id, success: true, data }) + "\\n");
  }
});
`,
    "utf8",
  );
  chmodSync(path, 0o755);
}

function writeTranscript(
  path,
  { sessionId, workspaceDir, title, messageCount },
) {
  const lines = [
    JSON.stringify({
      type: "session",
      id: sessionId,
      cwd: workspaceDir,
      title,
      timestamp: "2026-07-06T12:00:00.000Z",
    }),
  ];
  const pairs = Math.ceil(messageCount / 2);
  for (let i = 0; i < pairs; i++) {
    const topic = TOPICS[i % TOPICS.length];
    lines.push(
      JSON.stringify({
        type: "message",
        message: {
          role: "user",
          content: `Message ${2 * i + 1}: can you walk me through ${topic}?`,
          timestamp: 1780000000 + i * 120,
        },
      }),
    );
    const body = [
      `Message ${2 * i + 2} — about ${topic}.`,
      "Here is the load-bearing detail, point by point:",
      "1. The main process owns the boundary and the renderer only sees mapped domain shapes.",
      "2. State transitions are explicit; nothing is inferred from timing.",
      "3. Failure degrades to an inert empty state, never a crash.",
      i % 3 === 0
        ? "A longer elaboration follows so rows vary in height: the design keeps every invariant observable, every teardown ordered, and every seam testable without a live child process."
        : "",
    ].join("\n\n");
    lines.push(
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: body }],
          timestamp: 1780000000 + i * 120 + 60,
        },
      }),
    );
  }
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function writeSettings(path, { workspaceDir, sessionFile, sessionId, title }) {
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        version: 2,
        theme: "dark",
        defaultProject: workspaceDir,
        defaultModel: null,
        defaultThinkingLevel: "medium",
        defaultApprovalMode: "always-ask",
        defaultAutoApprove: false,
        liveSessionLimit: 4,
        recentProjects: [],
        openSessions: [
          {
            studioSessionId: "studio-demo-1",
            cwd: workspaceDir,
            createdAt: "2026-07-06T12:00:00.000Z",
            lastActiveAt: "2026-07-06T12:40:00.000Z",
            title,
            approvalPolicy: { mode: "always-ask", autoApprove: false },
            sessionFile,
            ompSessionId: sessionId,
            status: "hibernated",
          },
        ],
        workspaces: [
          {
            id: "demo-workspace",
            cwd: workspaceDir,
            label: "Demo workspace",
            pinned: true,
            lastUsedAt: "2026-07-06T12:00:00.000Z",
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
}

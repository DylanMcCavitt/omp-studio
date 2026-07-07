// Demo recorder: launches the BUILT app against a scenario's hermetic
// fixtures, runs its choreography while frame-capturing the window, and
// stitches an mp4 with ffmpeg.
//
//   npm run build && npm run demo -- message-scroller
//   DEMO_OUT=/opt/cursor/artifacts xvfb-run -a npm run demo -- message-scroller
//
// Frame capture is page.screenshot in a loop — cross-platform (macOS window,
// Linux xvfb) with no x11grab/avfoundation divergence. Output: mp4 + any
// keyframe PNGs the scenario saves via ctx.shot().
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const here = fileURLToPath(new URL(".", import.meta.url));
const scenarioName = process.argv[2];
if (!scenarioName || !/^[a-z0-9-]+$/.test(scenarioName)) {
  const available = readdirSync(join(here, "scenarios"))
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => f.replace(/\.mjs$/, ""))
    .join(", ");
  console.error(`usage: npm run demo -- <scenario>\navailable: ${available}`);
  process.exit(2);
}

const mainEntry = join(here, "..", "..", "out", "main", "index.js");
if (!existsSync(mainEntry)) {
  console.error("out/main/index.js missing — run `npm run build` first.");
  process.exit(2);
}
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  console.error(
    "ffmpeg not found on PATH — install it (brew install ffmpeg / apt-get install ffmpeg).",
  );
  process.exit(2);
}

// The scenario is genuinely runtime-selected by CLI argument — the one case
// where a dynamic import specifier is warranted.
const scenario = await import(`./scenarios/${scenarioName}.mjs`);

const outDir =
  process.env.DEMO_OUT ?? join(here, "..", "..", "test-results", "demo");
mkdirSync(outDir, { recursive: true });
const baseDir = mkdtempSync(join(tmpdir(), `omp-studio-demo-${scenarioName}-`));
const framesDir = join(baseDir, "frames");
mkdirSync(framesDir, { recursive: true });

const fixtures = scenario.seed(baseDir);
const app = await electron.launch({
  args: [mainEntry, `--user-data-dir=${fixtures.userDataDir}`],
  env: { ...process.env, ...fixtures.launchEnv },
});
const pageErrors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.waitForTimeout(2000);

  let recording = true;
  let frame = 0;
  const t0 = Date.now();
  const recorder = (async () => {
    while (recording) {
      const path = join(framesDir, `f${String(frame).padStart(5, "0")}.png`);
      try {
        await page.screenshot({ path, timeout: 3000 });
        frame++;
      } catch {
        // window busy — skip a frame rather than abort the take
      }
    }
  })();

  const ctx = {
    page,
    fixtures,
    pause: (ms) => page.waitForTimeout(ms),
    shot: (name) =>
      page.screenshot({ path: join(outDir, `${scenarioName}-${name}.png`) }),
  };
  const steps = await scenario.run(ctx);

  recording = false;
  await recorder;
  const elapsed = (Date.now() - t0) / 1000;
  await app.close();

  const captured = readdirSync(framesDir).filter((f) =>
    f.endsWith(".png"),
  ).length;
  if (captured === 0) throw new Error("no frames captured");
  const fps = Math.max(1, Number((captured / elapsed).toFixed(2)));
  const outMp4 = join(outDir, `${scenarioName}.mp4`);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      join(framesDir, "f%05d.png"),
      "-vf",
      "format=yuv420p,scale=1280:-2",
      "-movflags",
      "+faststart",
      outMp4,
    ],
    { stdio: "ignore" },
  );
  console.log(
    JSON.stringify(
      {
        scenario: scenarioName,
        outMp4,
        captured,
        elapsed: `${elapsed.toFixed(1)}s`,
        fps,
        steps: steps ?? [],
        pageErrors,
      },
      null,
      2,
    ),
  );
  process.exit(pageErrors.length === 0 ? 0 : 1);
} finally {
  rmSync(baseDir, { recursive: true, force: true });
}

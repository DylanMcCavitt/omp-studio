import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultSettings,
  loadSettings,
  migrate,
  saveSettings,
  setSettingsDir,
  updateSettings,
} from "../src/main/services/settings-service";
import type { StudioSettingsV1 } from "../src/shared/ipc";

// Each test gets an isolated temp dir injected as the settings store, so the
// real Electron userData directory is never touched.
let dir: string;

beforeEach(() => {
  // Defend against a stray env override leaking from the runner.
  delete process.env.OMP_STUDIO_SETTINGS_DIR;
  dir = mkdtempSync(join(tmpdir(), "omp-studio-settings-"));
  setSettingsDir(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const settingsFile = () => join(dir, "settings.json");

test("returns defaults when the settings file is missing", async () => {
  const settings = await loadSettings();
  expect(settings).toEqual(defaultSettings());
  // Spot-check the safety-critical defaults from the issue.
  expect(settings.defaultApprovalMode).toBe("always-ask");
  expect(settings.defaultAutoApprove).toBe(false);
  expect(settings.theme).toBe("system");
  expect(settings.defaultThinkingLevel).toBe("medium");
  expect(settings.liveSessionLimit).toBe(4);
  expect(settings.recentProjects).toEqual([]);
  expect(settings.openSessions).toEqual([]);
});

test("returns defaults (no throw) when the file is corrupt JSON", async () => {
  writeFileSync(settingsFile(), "{ not valid json ", "utf8");
  const settings = await loadSettings();
  expect(settings).toEqual(defaultSettings());
});

test("round-trips save then load", async () => {
  const custom: StudioSettingsV1 = {
    ...defaultSettings(),
    theme: "light",
    defaultModel: "anthropic/claude",
    liveSessionLimit: 9,
    recentProjects: [
      { cwd: "/work/app", label: "app", lastUsedAt: "2026-01-01T00:00:00Z" },
    ],
    openSessions: [
      {
        studioSessionId: "s1",
        cwd: "/work/app",
        createdAt: "2026-01-01T00:00:00Z",
        lastActiveAt: "2026-01-02T00:00:00Z",
        title: null,
        approvalPolicy: { mode: "write", autoApprove: false },
        status: "hibernated",
      },
    ],
  };
  await saveSettings(custom);
  const loaded = await loadSettings();
  expect(loaded).toEqual(custom);
});

test("writes atomically, leaving no temp files behind", async () => {
  await saveSettings(defaultSettings());
  const entries = readdirSync(dir);
  expect(entries).toContain("settings.json");
  expect(entries.some((e) => e.endsWith(".tmp"))).toBe(false);
});

test("updateSettings merges known keys and drops unknown ones", async () => {
  const patch = {
    theme: "dark",
    defaultApprovalMode: "yolo",
    defaultAutoApprove: true,
    liveSessionLimit: 7,
    secretToken: "should-never-persist",
  } as unknown as Partial<StudioSettingsV1>;

  const updated = await updateSettings(patch);

  // Known keys applied.
  expect(updated.theme).toBe("dark");
  expect(updated.defaultApprovalMode).toBe("yolo");
  expect(updated.defaultAutoApprove).toBe(true);
  expect(updated.liveSessionLimit).toBe(7);
  // Untouched known keys keep their prior value.
  expect(updated.defaultThinkingLevel).toBe("medium");
  // Unknown key dropped from the returned object and from disk.
  expect((updated as Record<string, unknown>).secretToken).toBeUndefined();
  const onDisk = JSON.parse(readFileSync(settingsFile(), "utf8"));
  expect(onDisk.secretToken).toBeUndefined();
  expect(onDisk.theme).toBe("dark");
});

test("updateSettings coerces invalid values back to the current value", async () => {
  const updated = await updateSettings({
    theme: "neon" as unknown as StudioSettingsV1["theme"],
    liveSessionLimit: -5,
    defaultApprovalMode:
      "bogus" as unknown as StudioSettingsV1["defaultApprovalMode"],
  });
  // Invalid values rejected → defaults preserved.
  expect(updated.theme).toBe("system");
  expect(updated.liveSessionLimit).toBe(4);
  expect(updated.defaultApprovalMode).toBe("always-ask");
});

test("migrate falls back to defaults for an unknown version", () => {
  const migrated = migrate({
    version: 99,
    theme: "dark",
    defaultApprovalMode: "yolo",
  });
  expect(migrated).toEqual(defaultSettings());
});

test("migrate falls back to defaults for non-object input", () => {
  expect(migrate(null)).toEqual(defaultSettings());
  expect(migrate("nope")).toEqual(defaultSettings());
  expect(migrate(42)).toEqual(defaultSettings());
});

test("migrate accepts a v1 object, coercing invalid fields and dropping unknown keys", () => {
  const migrated = migrate({
    version: 1,
    theme: "dark",
    defaultApprovalMode: "bogus",
    liveSessionLimit: -3,
    extra: "secret",
    recentProjects: [{ cwd: "/p", label: "P", lastUsedAt: "t" }, { bad: true }],
  });
  expect(migrated.theme).toBe("dark");
  expect(migrated.defaultApprovalMode).toBe("always-ask");
  expect(migrated.liveSessionLimit).toBe(4);
  expect((migrated as Record<string, unknown>).extra).toBeUndefined();
  expect(migrated.recentProjects).toEqual([
    { cwd: "/p", label: "P", lastUsedAt: "t" },
  ]);
});

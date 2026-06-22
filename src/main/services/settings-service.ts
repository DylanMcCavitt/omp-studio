// Main-owned, versioned, atomically-written user settings persisted to
// `<userData>/settings.json`. Plain node (no electron) so it stays unit
// testable; the userData directory is injected at app startup via
// `setSettingsDir` (and overridable through `OMP_STUDIO_SETTINGS_DIR` for
// non-electron contexts such as `bun test`).
//
// Hard rule: settings NEVER hold secrets. Persistence only ever writes the
// known `StudioSettingsV1` keys — unknown keys (including any token-shaped
// data a future caller might pass) are dropped on read and on update.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  OpenSessionDescriptor,
  RecentProject,
  StudioSettingsV1,
  ThemeMode,
} from "@shared/ipc";
import type { ApprovalMode, ApprovalPolicy, ThinkingLevel } from "@shared/rpc";

const SETTINGS_FILE = "settings.json";

// Allowed values for the small string-enum fields, used to coerce/validate
// untrusted (on-disk or renderer-supplied) data back into the contract.
const THEME_MODES = ["system", "dark", "light"] as const;
const APPROVAL_MODES = ["always-ask", "write", "yolo"] as const;
const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
const SESSION_STATUSES = ["open", "hibernated", "closed"] as const;

// ---------------------------------------------------------------------------
// Settings directory (injected at startup; env override for plain-node use)
// ---------------------------------------------------------------------------

let injectedDir: string | null = null;

/**
 * Point the settings store at a directory. The electron main process injects
 * `app.getPath("userData")` at boot; tests inject a temp dir. The injected
 * value wins over the env fallback so production never reads a stray override.
 */
export function setSettingsDir(dir: string): void {
  injectedDir = dir;
}

function resolveSettingsDir(): string {
  const dir = injectedDir ?? process.env.OMP_STUDIO_SETTINGS_DIR;
  if (!dir) {
    throw new Error(
      "settings store directory not configured; call setSettingsDir() at startup",
    );
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** A fresh copy of the v1 defaults. Each call returns a new object. */
export function defaultSettings(): StudioSettingsV1 {
  return {
    version: 1,
    theme: "system",
    defaultProject: null,
    defaultModel: null,
    defaultThinkingLevel: "medium",
    defaultApprovalMode: "always-ask",
    defaultAutoApprove: false,
    liveSessionLimit: 4,
    recentProjects: [],
    openSessions: [],
  };
}

// ---------------------------------------------------------------------------
// Coercion / validation helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return (
    typeof value === "string" && (allowed as readonly string[]).includes(value)
  );
}

function coerceRecentProjects(value: unknown): RecentProject[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: RecentProject[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const { cwd, label, lastUsedAt } = item;
    if (
      typeof cwd === "string" &&
      typeof label === "string" &&
      typeof lastUsedAt === "string"
    ) {
      out.push({ cwd, label, lastUsedAt });
    }
  }
  return out;
}

function coerceApprovalPolicy(value: unknown): ApprovalPolicy | undefined {
  if (!isRecord(value)) return undefined;
  const { mode, autoApprove } = value;
  if (
    isOneOf<ApprovalMode>(mode, APPROVAL_MODES) &&
    typeof autoApprove === "boolean"
  ) {
    return { mode, autoApprove };
  }
  return undefined;
}

function coerceOpenSessions(
  value: unknown,
): OpenSessionDescriptor[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: OpenSessionDescriptor[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const { studioSessionId, cwd, createdAt, lastActiveAt, title, status } =
      item;
    if (
      typeof studioSessionId !== "string" ||
      typeof cwd !== "string" ||
      typeof createdAt !== "string" ||
      typeof lastActiveAt !== "string" ||
      !(title === null || typeof title === "string") ||
      !isOneOf(status, SESSION_STATUSES)
    ) {
      continue;
    }
    const approvalPolicy = coerceApprovalPolicy(item.approvalPolicy);
    if (!approvalPolicy) continue;

    const descriptor: OpenSessionDescriptor = {
      studioSessionId,
      cwd,
      createdAt,
      lastActiveAt,
      title,
      approvalPolicy,
      status,
    };
    if (typeof item.model === "string") descriptor.model = item.model;
    if (isOneOf<ThinkingLevel>(item.thinkingLevel, THINKING_LEVELS)) {
      descriptor.thinkingLevel = item.thinkingLevel;
    }
    if (typeof item.sessionFile === "string")
      descriptor.sessionFile = item.sessionFile;
    if (typeof item.ompSessionId === "string") {
      descriptor.ompSessionId = item.ompSessionId;
    }
    out.push(descriptor);
  }
  return out;
}

/**
 * Merge only the KNOWN settings keys from `patch` onto `base`, coercing each
 * value and dropping anything unknown or invalid. Used both to normalize an
 * on-disk v1 object (base = defaults) and to apply a renderer update patch
 * (base = current settings). The result is always a clean `StudioSettingsV1`.
 */
function mergeKnown(
  base: StudioSettingsV1,
  patch: Record<string, unknown>,
): StudioSettingsV1 {
  const next: StudioSettingsV1 = { ...base, version: 1 };

  if (isOneOf<ThemeMode>(patch.theme, THEME_MODES)) next.theme = patch.theme;

  if ("defaultProject" in patch) {
    const v = patch.defaultProject;
    if (v === null || typeof v === "string") next.defaultProject = v;
  }
  if ("defaultModel" in patch) {
    const v = patch.defaultModel;
    if (v === null || typeof v === "string") next.defaultModel = v;
  }
  if (isOneOf<ThinkingLevel>(patch.defaultThinkingLevel, THINKING_LEVELS)) {
    next.defaultThinkingLevel = patch.defaultThinkingLevel;
  }
  if (isOneOf<ApprovalMode>(patch.defaultApprovalMode, APPROVAL_MODES)) {
    next.defaultApprovalMode = patch.defaultApprovalMode;
  }
  if (typeof patch.defaultAutoApprove === "boolean") {
    next.defaultAutoApprove = patch.defaultAutoApprove;
  }
  if (
    typeof patch.liveSessionLimit === "number" &&
    Number.isFinite(patch.liveSessionLimit) &&
    patch.liveSessionLimit >= 1
  ) {
    next.liveSessionLimit = Math.floor(patch.liveSessionLimit);
  }

  const recentProjects = coerceRecentProjects(patch.recentProjects);
  if (recentProjects) next.recentProjects = recentProjects;
  const openSessions = coerceOpenSessions(patch.openSessions);
  if (openSessions) next.openSessions = openSessions;

  return next;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Normalize an arbitrary parsed-JSON value into a valid `StudioSettingsV1`.
 * Switches on the stored `version`; the current (v1) shape is coerced field by
 * field, and any other/missing version falls back to defaults with a logged
 * warning. Never throws.
 */
export function migrate(raw: unknown): StudioSettingsV1 {
  if (!isRecord(raw)) return defaultSettings();
  switch (raw.version) {
    case 1:
      return mergeKnown(defaultSettings(), raw);
    default:
      console.warn(
        `[settings] unknown settings version ${String(raw.version)}; using defaults`,
      );
      return defaultSettings();
  }
}

// ---------------------------------------------------------------------------
// Load / save / update
// ---------------------------------------------------------------------------

/**
 * Read `<userData>/settings.json`. Returns defaults when the file is missing,
 * unreadable, or corrupt — and never throws.
 */
export async function loadSettings(): Promise<StudioSettingsV1> {
  try {
    const raw = await readFile(
      join(resolveSettingsDir(), SETTINGS_FILE),
      "utf8",
    );
    return migrate(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

/**
 * Persist settings atomically: write a sibling temp file, then rename over the
 * target (atomic on a single filesystem). Only the known v1 keys are written,
 * so secrets can never be persisted even if present on the input object.
 */
export async function saveSettings(settings: StudioSettingsV1): Promise<void> {
  const clean = mergeKnown(
    defaultSettings(),
    settings as unknown as Record<string, unknown>,
  );
  const dir = resolveSettingsDir();
  await mkdir(dir, { recursive: true });
  const target = join(dir, SETTINGS_FILE);
  const tmp = join(dir, `${SETTINGS_FILE}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Apply a partial patch over the current settings (known keys only, coerced;
 * unknown/invalid dropped), persist atomically, and return the new settings.
 */
export async function updateSettings(
  patch: Partial<StudioSettingsV1>,
): Promise<StudioSettingsV1> {
  const current = await loadSettings();
  const next = mergeKnown(current, patch as Record<string, unknown>);
  await saveSettings(next);
  return next;
}

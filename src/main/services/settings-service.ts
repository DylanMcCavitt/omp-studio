// Main-owned, versioned, atomically-written user settings persisted to
// `<userData>/settings.json`. Plain node (no electron) so it stays unit
// testable; the userData directory is injected at app startup via
// `setSettingsDir` (and overridable through `OMP_STUDIO_SETTINGS_DIR` for
// non-electron contexts such as `bun test`).
//
// Hard rule: settings NEVER hold secrets. Persistence only ever writes the
// known `StudioSettings` (V2) keys — unknown keys (including any token-shaped
// data a future caller might pass) are dropped on read and on update.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  LayoutSettings,
  OpenSessionDescriptor,
  RecentProject,
  StudioSettings,
  ThemeMode,
  UiPrefs,
  Workspace,
} from "@shared/ipc";
import type { ApprovalMode, ApprovalPolicy, ThinkingLevel } from "@shared/rpc";
import { scoped } from "../logger";

const log = scoped("settings");

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

// Default concurrency cap for the (off-by-default) terminal capability. Only
// materialised on a fresh install; an upgraded V1 file leaves `terminal`
// undefined until the user opts in.
const DEFAULT_TERMINAL_MAX_CONCURRENT = 4;

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

/**
 * A fresh copy of the V2 defaults. Each call returns a new object. The
 * capability flags are minted here with secure-by-default values (terminal +
 * browser disabled, Linear writes disabled); a fresh install is therefore
 * self-documenting, while an upgraded V1 file leaves these namespaces
 * undefined (still disabled) — see {@link migrate}.
 */
export function defaultSettings(): StudioSettings {
  return {
    version: 2,
    theme: "system",
    defaultProject: null,
    defaultModel: null,
    defaultThinkingLevel: "medium",
    defaultApprovalMode: "always-ask",
    defaultAutoApprove: false,
    liveSessionLimit: 4,
    recentProjects: [],
    openSessions: [],
    linear: { writesEnabled: false },
    terminal: {
      enabled: false,
      maxConcurrent: DEFAULT_TERMINAL_MAX_CONCURRENT,
    },
    browser: { enabled: false },
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

// ---- V2 namespace coercers ------------------------------------------------
// Each returns `undefined` when the input is missing or the wrong shape, so a
// caller only overrides its base value when the patch carries a valid one.
// Every coercer rebuilds a fresh object from known fields only, so any extra
// (e.g. token-shaped) keys are structurally dropped — secrets can never ride
// along inside a known namespace.

// Renderer-supplied *identifier* strings (collapse persistKeys, command/route
// ids, panel ids) flow into persisted settings as JSON keys / array elements.
// They are short, code-defined identifiers — never free text and never secrets.
// The value-level token-drop can't see map keys, so guard the persistence
// boundary: a hostile `settings.update` patch must not smuggle a credential
// through as a key. An id is accepted only if it matches a tame shape AND does
// not look credential-shaped. (User project data — workspace cwd/label — is
// genuinely arbitrary and is NOT subject to this guard.)
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
const TOKEN_MARKER =
  /(secret|token|password|passwd|api[-_]?key|apikey|credential|private[-_]?key|bearer)/i;
const TOKEN_PREFIX =
  /^(sk-|sk_|pk_|rk_|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|glpat-|xox[abprs]-|lin_|akia|asia|aiza|ya29\.|eyj)/i;

function isSafeId(value: string): boolean {
  return (
    SAFE_ID.test(value) &&
    !TOKEN_MARKER.test(value) &&
    !TOKEN_PREFIX.test(value)
  );
}

function coerceWorkspaces(value: unknown): Workspace[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Workspace[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const { id, cwd, label, pinned, lastUsedAt } = item;
    if (
      typeof id === "string" &&
      typeof cwd === "string" &&
      typeof label === "string" &&
      typeof pinned === "boolean" &&
      typeof lastUsedAt === "string"
    ) {
      out.push({ id, cwd, label, pinned, lastUsedAt });
    }
  }
  // A non-empty input that yields nothing valid is malformed → preserve prior;
  // an explicit empty array is an honoured "clear".
  if (value.length > 0 && out.length === 0) return undefined;
  return out;
}

/**
 * Coerce an array of identifier strings, keeping only safe ids. Returns
 * `undefined` when the input is not an array, or when a non-empty input yields
 * no safe id (malformed → preserve prior); an empty input array is honoured.
 */
function coerceIdArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter(
    (v): v is string => typeof v === "string" && isSafeId(v),
  );
  if (value.length > 0 && out.length === 0) return undefined;
  return out;
}

/**
 * Coerce the collapse map, keeping only safe-id keys with boolean values.
 * Returns `undefined` when the input is not a record, or when a non-empty input
 * yields no safe entry (malformed/secret-only → preserve prior); an empty input
 * record is honoured as a clear.
 */
function coerceCollapsedMap(
  value: unknown,
): Record<string, boolean> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "boolean" && isSafeId(k)) out[k] = v;
  }
  if (Object.keys(value).length > 0 && Object.keys(out).length === 0) {
    return undefined;
  }
  return out;
}

function coerceLayout(value: unknown): LayoutSettings | undefined {
  if (!isRecord(value)) return undefined;
  const out: LayoutSettings = {};
  if (
    typeof value.sidebarWidthPct === "number" &&
    Number.isFinite(value.sidebarWidthPct)
  ) {
    out.sidebarWidthPct = value.sidebarWidthPct;
  }
  if (
    typeof value.chatRailWidthPct === "number" &&
    Number.isFinite(value.chatRailWidthPct)
  ) {
    out.chatRailWidthPct = value.chatRailWidthPct;
  }
  if (typeof value.chatRailCollapsed === "boolean") {
    out.chatRailCollapsed = value.chatRailCollapsed;
  }
  const navOrder = coerceIdArray(value.navOrder);
  if (navOrder) out.navOrder = navOrder;
  const navHidden = coerceIdArray(value.navHidden);
  if (navHidden) out.navHidden = navHidden;
  if (Array.isArray(value.chatRailPanels)) {
    const panels: { id: string; visible: boolean }[] = [];
    for (const item of value.chatRailPanels) {
      if (
        isRecord(item) &&
        typeof item.id === "string" &&
        isSafeId(item.id) &&
        typeof item.visible === "boolean"
      ) {
        panels.push({ id: item.id, visible: item.visible });
      }
    }
    if (value.chatRailPanels.length === 0 || panels.length > 0) {
      out.chatRailPanels = panels;
    }
  }
  // `null` is an explicit cleared value (the rail collapsed): persist it so the
  // closed state survives a restart. Under mergeKnown's whole-object replace,
  // omitting it on null would let a stale prior id (Case B: the only layout
  // field) reopen the panel — so set null rather than drop the key.
  if (typeof value.rightPanelId === "string" && isSafeId(value.rightPanelId)) {
    out.rightPanelId = value.rightPanelId;
  } else if (value.rightPanelId === null) {
    out.rightPanelId = null;
  }
  if (
    typeof value.rightPanelWidthPct === "number" &&
    Number.isFinite(value.rightPanelWidthPct)
  ) {
    out.rightPanelWidthPct = value.rightPanelWidthPct;
  }
  // An object-shaped patch with no accepted field is malformed → preserve prior
  // (returning `{}` here would clobber the existing layout via mergeKnown).
  return Object.keys(out).length === 0 ? undefined : out;
}

function coerceUiPrefs(value: unknown): UiPrefs | undefined {
  if (!isRecord(value)) return undefined;
  const out: UiPrefs = {};
  const collapsed = coerceCollapsedMap(value.collapsed);
  if (collapsed) out.collapsed = collapsed;
  const pinnedCommands = coerceIdArray(value.pinnedCommands);
  if (pinnedCommands) out.pinnedCommands = pinnedCommands;
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * NON-SECRET Linear metadata only. The API key lives in the OS keychain and
 * MUST never be persisted here, so we copy `writesEnabled`/`defaultTeamId`
 * explicitly and drop everything else (including any `apiKey`/`token` field a
 * caller might smuggle in).
 */
function coerceLinearMeta(
  value: unknown,
): StudioSettings["linear"] | undefined {
  if (!isRecord(value) || typeof value.writesEnabled !== "boolean") {
    return undefined;
  }
  const out: NonNullable<StudioSettings["linear"]> = {
    writesEnabled: value.writesEnabled,
  };
  const teamId = value.defaultTeamId;
  if (teamId === null || typeof teamId === "string") {
    out.defaultTeamId = teamId;
  }
  return out;
}

function coerceTerminal(
  value: unknown,
): StudioSettings["terminal"] | undefined {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return undefined;
  const mc = value.maxConcurrent;
  const maxConcurrent =
    typeof mc === "number" && Number.isFinite(mc) && mc >= 1
      ? Math.floor(mc)
      : DEFAULT_TERMINAL_MAX_CONCURRENT;
  return { enabled: value.enabled, maxConcurrent };
}

function coerceBrowser(value: unknown): StudioSettings["browser"] | undefined {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return undefined;
  return { enabled: value.enabled };
}

/** One pinned-false workspace per recent project (1:1, used by the V1→V2 migration). */
function workspaceFromRecent(project: RecentProject): Workspace {
  return {
    id: randomUUID(),
    cwd: project.cwd,
    label: project.label,
    pinned: false,
    lastUsedAt: project.lastUsedAt,
  };
}

/**
 * Coerce the legacy V1 fields from `patch` onto `target` in place, dropping
 * anything unknown or invalid. Shared by {@link mergeKnown} and the V1→V2
 * migration (which applies ONLY these fields).
 */
function applyV1Keys(
  target: StudioSettings,
  patch: Record<string, unknown>,
): void {
  if (isOneOf<ThemeMode>(patch.theme, THEME_MODES)) target.theme = patch.theme;

  if ("defaultProject" in patch) {
    const v = patch.defaultProject;
    if (v === null || typeof v === "string") target.defaultProject = v;
  }
  if ("defaultModel" in patch) {
    const v = patch.defaultModel;
    if (v === null || typeof v === "string") target.defaultModel = v;
  }
  if (isOneOf<ThinkingLevel>(patch.defaultThinkingLevel, THINKING_LEVELS)) {
    target.defaultThinkingLevel = patch.defaultThinkingLevel;
  }
  if (isOneOf<ApprovalMode>(patch.defaultApprovalMode, APPROVAL_MODES)) {
    target.defaultApprovalMode = patch.defaultApprovalMode;
  }
  if (typeof patch.defaultAutoApprove === "boolean") {
    target.defaultAutoApprove = patch.defaultAutoApprove;
  }
  if (
    typeof patch.liveSessionLimit === "number" &&
    Number.isFinite(patch.liveSessionLimit) &&
    patch.liveSessionLimit >= 1
  ) {
    target.liveSessionLimit = Math.floor(patch.liveSessionLimit);
  }

  const recentProjects = coerceRecentProjects(patch.recentProjects);
  if (recentProjects) target.recentProjects = recentProjects;
  const openSessions = coerceOpenSessions(patch.openSessions);
  if (openSessions) target.openSessions = openSessions;
}

/**
 * Merge only the KNOWN settings keys (V1 + the V2 namespaces) from `patch` onto
 * `base`, coercing each value and dropping anything unknown, invalid, or
 * token-shaped. Used both to normalize an on-disk V2 object (base = defaults)
 * and to apply a renderer update patch (base = current settings). The result is
 * always a clean `StudioSettings` (V2).
 */
function mergeKnown(
  base: StudioSettings,
  patch: Record<string, unknown>,
): StudioSettings {
  const next: StudioSettings = { ...base, version: 2 };

  applyV1Keys(next, patch);

  const workspaces = coerceWorkspaces(patch.workspaces);
  if (workspaces) next.workspaces = workspaces;
  const layout = coerceLayout(patch.layout);
  if (layout) next.layout = layout;
  const ui = coerceUiPrefs(patch.ui);
  if (ui) next.ui = ui;
  const linear = coerceLinearMeta(patch.linear);
  if (linear) next.linear = linear;
  const terminal = coerceTerminal(patch.terminal);
  if (terminal) next.terminal = terminal;
  const browser = coerceBrowser(patch.browser);
  if (browser) next.browser = browser;

  return next;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Normalize an arbitrary parsed-JSON value into a valid `StudioSettings` (V2).
 * Switches on the stored `version`: a V2 file is coerced field by field; a
 * legacy V1 file is upgraded ({@link migrateV1}); any other/missing version
 * falls back to defaults with a logged warning. Never throws.
 */
export function migrate(raw: unknown): StudioSettings {
  if (!isRecord(raw)) return defaultSettings();
  switch (raw.version) {
    case 1:
      return migrateV1(raw);
    case 2: {
      const next = mergeKnown(defaultSettings(), raw);
      // A v2 file written before workspaces existed carries recentProjects but
      // no `workspaces` key — synthesize them 1:1 (as the v1 path does) so the
      // picker isn't empty. An explicit `workspaces: []` is an honoured clear.
      if (raw.workspaces === undefined && next.recentProjects.length > 0) {
        next.workspaces = next.recentProjects.map(workspaceFromRecent);
      }
      return next;
    }
    default:
      log.warn("unknown settings version; using defaults", {
        version: String(raw.version),
      });
      return defaultSettings();
  }
}

/**
 * Upgrade a legacy V1 file to V2. Only the V1 fields are coerced; the new V2
 * namespaces are intentionally left undefined (an upgrading user opts into
 * capabilities explicitly, so any V2-shaped keys smuggled into a V1 file are
 * ignored — still secure). `workspaces` is synthesised 1:1 from the migrated
 * recent projects (pinned: false), the one new field we materialise.
 */
function migrateV1(raw: Record<string, unknown>): StudioSettings {
  const next: StudioSettings = {
    ...defaultSettings(),
    version: 2,
    linear: undefined,
    terminal: undefined,
    browser: undefined,
  };
  applyV1Keys(next, raw);
  next.workspaces = next.recentProjects.map(workspaceFromRecent);
  return next;
}

// ---------------------------------------------------------------------------
// Load / save / update
// ---------------------------------------------------------------------------

/**
 * Read `<userData>/settings.json`. Returns defaults when the file is missing,
 * unreadable, or corrupt — and never throws.
 */
export async function loadSettings(): Promise<StudioSettings> {
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
 * target (atomic on a single filesystem). Only the known V2 keys are written,
 * so secrets can never be persisted even if present on the input object.
 */
export async function saveSettings(settings: StudioSettings): Promise<void> {
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
  patch: Partial<StudioSettings>,
): Promise<StudioSettings> {
  const current = await loadSettings();
  const next = mergeKnown(current, patch as Record<string, unknown>);
  await saveSettings(next);
  return next;
}

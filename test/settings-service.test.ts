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
import type { StudioSettings } from "../src/shared/ipc";

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
  const custom: StudioSettings = {
    ...defaultSettings(),
    theme: "light",
    defaultModel: "anthropic/claude",
    liveSessionLimit: 9,
    recentProjects: [
      { cwd: "/work/app", label: "app", lastUsedAt: "2026-01-01T00:00:00Z" },
    ],
    workspaces: [
      {
        id: "ws-1",
        cwd: "/work/app",
        label: "app",
        pinned: true,
        lastUsedAt: "2026-01-01T00:00:00Z",
      },
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
  } as unknown as Partial<StudioSettings>;

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
    theme: "neon" as unknown as StudioSettings["theme"],
    liveSessionLimit: -5,
    defaultApprovalMode:
      "bogus" as unknown as StudioSettings["defaultApprovalMode"],
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

// ---------------------------------------------------------------------------
// V2 — secure defaults, V1→V2 migration, new-namespace round-trips, no secrets
// ---------------------------------------------------------------------------

test("defaultSettings returns V2 with secure capability defaults", () => {
  const d = defaultSettings();
  expect(d.version).toBe(2);
  // Off-by-default is the security-critical invariant (the concurrency value is
  // a tunable default, so we don't pin it here).
  expect(d.terminal?.enabled).toBe(false);
  expect(d.browser?.enabled).toBe(false);
  expect(d.linear?.writesEnabled).toBe(false);
  expect(typeof d.terminal?.maxConcurrent).toBe("number");
  expect(d.terminal?.defaultTarget).toBe("built-in");
  expect(d.terminal?.externalProfile).toBe("system");
});

test("a fresh install (missing file) loads the secure V2 defaults", async () => {
  const loaded = await loadSettings();
  expect(loaded.version).toBe(2);
  expect(loaded.terminal?.enabled).toBe(false);
  expect(loaded.browser?.enabled).toBe(false);
  expect(loaded.linear?.writesEnabled).toBe(false);
});

test("migrate upgrades a V1 object to V2: version bump, workspaces synthesised 1:1, other new fields undefined", () => {
  const migrated = migrate({
    version: 1,
    theme: "light",
    recentProjects: [
      { cwd: "/a", label: "A", lastUsedAt: "t1" },
      { cwd: "/b", label: "B", lastUsedAt: "t2" },
    ],
    // A V2-shaped capability key smuggled into a V1 file must be ignored: an
    // upgrading user opts into capabilities explicitly (security).
    terminal: { enabled: true, maxConcurrent: 99 },
  });
  expect(migrated.version).toBe(2);
  expect(migrated.theme).toBe("light");
  // One pinned:false workspace per recent project, preserving order.
  expect(migrated.workspaces).toEqual([
    {
      id: expect.any(String),
      cwd: "/a",
      label: "A",
      pinned: false,
      lastUsedAt: "t1",
    },
    {
      id: expect.any(String),
      cwd: "/b",
      label: "B",
      pinned: false,
      lastUsedAt: "t2",
    },
  ]);
  // Every other new namespace stays undefined; the smuggled terminal is dropped.
  expect(migrated.layout).toBeUndefined();
  expect(migrated.ui).toBeUndefined();
  expect(migrated.linear).toBeUndefined();
  expect(migrated.terminal).toBeUndefined();
  expect(migrated.browser).toBeUndefined();
});

test("migrate synthesises workspaces for a v2 file written before the workspaces key existed", () => {
  const migrated = migrate({
    version: 2,
    theme: "dark",
    recentProjects: [
      { cwd: "/a", label: "A", lastUsedAt: "t1" },
      { cwd: "/b", label: "B", lastUsedAt: "t2" },
    ],
    // No `workspaces` key — the picker would otherwise load empty.
  });
  expect(migrated.version).toBe(2);
  expect(migrated.workspaces).toEqual([
    {
      id: expect.any(String),
      cwd: "/a",
      label: "A",
      pinned: false,
      lastUsedAt: "t1",
    },
    {
      id: expect.any(String),
      cwd: "/b",
      label: "B",
      pinned: false,
      lastUsedAt: "t2",
    },
  ]);
});

test("migrate honours an explicit empty workspaces array on a v2 file (no resynthesis)", () => {
  const migrated = migrate({
    version: 2,
    recentProjects: [{ cwd: "/a", label: "A", lastUsedAt: "t1" }],
    workspaces: [],
  });
  expect(migrated.workspaces).toEqual([]);
});

test("loadSettings reads a legacy V1 file from disk as V2", async () => {
  const v1 = {
    version: 1,
    theme: "dark",
    defaultProject: null,
    defaultModel: null,
    defaultThinkingLevel: "medium",
    defaultApprovalMode: "always-ask",
    defaultAutoApprove: false,
    liveSessionLimit: 4,
    recentProjects: [{ cwd: "/proj", label: "proj", lastUsedAt: "t" }],
    openSessions: [],
  };
  writeFileSync(settingsFile(), JSON.stringify(v1), "utf8");
  const loaded = await loadSettings();
  expect(loaded.version).toBe(2);
  expect(loaded.theme).toBe("dark");
  expect(loaded.workspaces).toEqual([
    {
      id: expect.any(String),
      cwd: "/proj",
      label: "proj",
      pinned: false,
      lastUsedAt: "t",
    },
  ]);
});

test("migrate drops unknown and token-shaped keys, including nested in a known namespace", () => {
  const migrated = migrate({
    version: 2,
    theme: "dark",
    apiKey: "tok_secret",
    nonsense: 123,
    // `linear` is non-secret metadata only; a smuggled token must be dropped.
    linear: { writesEnabled: true, token: "tok_secret", apiKey: "tok_secret" },
  });
  expect(migrated.theme).toBe("dark");
  expect((migrated as Record<string, unknown>).apiKey).toBeUndefined();
  expect((migrated as Record<string, unknown>).nonsense).toBeUndefined();
  expect(migrated.linear).toEqual({ writesEnabled: true });
  expect(JSON.stringify(migrated)).not.toContain("tok_secret");
});

test("round-trips a patch of each new V2 namespace (they coexist, not clobber)", async () => {
  await updateSettings({
    workspaces: [
      { id: "w1", cwd: "/a", label: "A", pinned: true, lastUsedAt: "t" },
    ],
  });
  await updateSettings({
    layout: {
      sidebarWidthPct: 28,
      chatRailCollapsed: true,
      navOrder: ["dash", "chat"],
      chatRailPanels: [{ id: "subagents", visible: false }],
    },
  });
  await updateSettings({
    ui: { collapsed: { panelA: true }, pinnedCommands: ["tan", "tree"] },
  });
  await updateSettings({
    linear: { writesEnabled: true, defaultTeamId: "TEAM-1" },
  });
  await updateSettings({
    terminal: {
      enabled: true,
      maxConcurrent: 8,
      defaultTarget: "external",
      externalProfile: "ghostty",
    },
  });
  await updateSettings({
    browser: {
      enabled: true,
      bookmarks: [
        {
          url: "https://user:pass@example.com/docs?topic=browser",
          title: "Docs",
          createdAt: "2026-06-30T00:00:00Z",
        },
      ],
      history: [
        {
          url: "http://example.com/recent",
          title: "Recent",
          lastVisitedAt: "2026-06-30T00:01:00Z",
        },
      ],
    },
  });

  const loaded = await loadSettings();
  expect(loaded.workspaces).toEqual([
    { id: "w1", cwd: "/a", label: "A", pinned: true, lastUsedAt: "t" },
  ]);
  expect(loaded.layout).toEqual({
    sidebarWidthPct: 28,
    chatRailCollapsed: true,
    navOrder: ["dash", "chat"],
    chatRailPanels: [{ id: "subagents", visible: false }],
  });
  expect(loaded.ui).toEqual({
    collapsed: { panelA: true },
    pinnedCommands: ["tan", "tree"],
  });
  expect(loaded.linear).toEqual({
    writesEnabled: true,
    defaultTeamId: "TEAM-1",
  });
  expect(loaded.terminal).toEqual({
    enabled: true,
    maxConcurrent: 8,
    defaultTarget: "external",
    externalProfile: "ghostty",
  });
  expect(loaded.browser).toEqual({
    enabled: true,
    bookmarks: [
      {
        url: "https://example.com/docs?topic=browser",
        title: "Docs",
        createdAt: "2026-06-30T00:00:00Z",
      },
    ],
    history: [
      {
        url: "http://example.com/recent",
        title: "Recent",
        lastVisitedAt: "2026-06-30T00:01:00Z",
      },
    ],
  });
});

test("rejects a malformed V2 namespace patch, preserving the prior value", async () => {
  await updateSettings({
    terminal: {
      enabled: true,
      maxConcurrent: 3,
      defaultTarget: "external",
      externalProfile: "ghostty",
    },
  });
  // `enabled` missing → coercion returns undefined → the prior value is kept.
  await updateSettings({
    terminal: { maxConcurrent: 50 } as unknown as StudioSettings["terminal"],
  });
  const loaded = await loadSettings();
  expect(loaded.terminal).toEqual({
    enabled: true,
    maxConcurrent: 3,
    defaultTarget: "external",
    externalProfile: "ghostty",
  });
});

test("drops invalid terminal target/profile strings", async () => {
  await updateSettings({
    terminal: {
      enabled: true,
      maxConcurrent: 2,
      defaultTarget: "dock" as never,
      externalProfile: "Terminal.app" as never,
    },
  });

  const loaded = await loadSettings();
  expect(loaded.terminal).toEqual({ enabled: true, maxConcurrent: 2 });
});

test("browser metadata clears without changing enabled", async () => {
  await updateSettings({
    browser: {
      enabled: true,
      bookmarks: [
        {
          url: "https://example.com/docs",
          title: "Docs",
          createdAt: "2026-06-30T00:00:00Z",
        },
      ],
      history: [
        {
          url: "https://example.com/recent",
          title: "Recent",
          lastVisitedAt: "2026-06-30T00:01:00Z",
        },
      ],
    },
  });

  await updateSettings({
    browser: { enabled: true, bookmarks: [], history: [] },
  });

  const loaded = await loadSettings();
  expect(loaded.browser).toEqual({
    enabled: true,
    bookmarks: [],
    history: [],
  });
});

test("browser metadata drops invalid entries and unknown fields", async () => {
  await updateSettings({
    browser: {
      enabled: false,
      bookmarks: [
        {
          url: "ftp://example.com/file",
          title: "Bad scheme",
          createdAt: "2026-06-30T00:00:00Z",
        },
        {
          url: "https://example.com/good",
          title: "ghp_title_is_blank",
          createdAt: "2026-06-30T00:02:00Z",
          favicon: "ignored",
        },
      ],
      history: [
        {
          url: "https://example.com/recent",
          title: "Recent",
          lastVisitedAt: "2026-06-30T00:03:00Z",
          formData: "ignored",
        },
        {
          url: "not a url",
          title: "Bad",
          lastVisitedAt: "2026-06-30T00:04:00Z",
        },
      ],
    } as unknown as StudioSettings["browser"],
  });

  const loaded = await loadSettings();
  expect(loaded.browser).toEqual({
    enabled: false,
    bookmarks: [
      {
        url: "https://example.com/good",
        title: "",
        createdAt: "2026-06-30T00:02:00Z",
      },
    ],
    history: [
      {
        url: "https://example.com/recent",
        title: "Recent",
        lastVisitedAt: "2026-06-30T00:03:00Z",
      },
    ],
  });
});

test("malformed browser metadata preserves the prior browser value", async () => {
  await updateSettings({
    browser: {
      enabled: true,
      bookmarks: [
        {
          url: "https://example.com/saved",
          title: "Saved",
          createdAt: "2026-06-30T00:00:00Z",
        },
      ],
      history: [
        {
          url: "https://example.com/recent",
          title: "Recent",
          lastVisitedAt: "2026-06-30T00:01:00Z",
        },
      ],
    },
  });

  await updateSettings({
    browser: {
      enabled: false,
      bookmarks: [{ url: "javascript:alert(1)", title: "Bad", createdAt: "t" }],
    } as unknown as StudioSettings["browser"],
  });

  const loaded = await loadSettings();
  expect(loaded.browser).toEqual({
    enabled: true,
    bookmarks: [
      {
        url: "https://example.com/saved",
        title: "Saved",
        createdAt: "2026-06-30T00:00:00Z",
      },
    ],
    history: [
      {
        url: "https://example.com/recent",
        title: "Recent",
        lastVisitedAt: "2026-06-30T00:01:00Z",
      },
    ],
  });
});

test("never writes a secret to disk, even nested inside a known namespace", async () => {
  const SECRET = "lin_api_supersecret_DO_NOT_PERSIST";
  await updateSettings({
    apiKey: SECRET,
    token: SECRET,
    accessToken: SECRET,
    linear: { writesEnabled: true, defaultTeamId: "T", apiKey: SECRET },
    terminal: { enabled: false, maxConcurrent: 2, token: SECRET },
    browser: {
      enabled: true,
      bookmarks: [
        {
          url: "https://example.com/safe",
          title: SECRET,
          createdAt: "2026-06-30T00:00:00Z",
        },
        {
          url: `https://example.com/leak?next=${SECRET}`,
          title: "Leak",
          createdAt: "2026-06-30T00:01:00Z",
        },
        {
          url: `https://example.com/reset/${SECRET}`,
          title: "Path leak",
          createdAt: "2026-06-30T00:03:00Z",
        },
        {
          url: `https://example.com/fragment#access_token=${SECRET}`,
          title: "Fragment leak",
          createdAt: "2026-06-30T00:02:00Z",
        },
        {
          url: "https://example.com/bad-created-at",
          title: "Timestamp leak",
          createdAt: SECRET,
        },
      ],
      history: [
        {
          url: "https://example.com/recent?api_key=abc",
          title: "Leak",
          lastVisitedAt: "2026-06-30T00:04:00Z",
        },
        {
          url: "https://example.com/bad-visited-at",
          title: "Timestamp leak",
          lastVisitedAt: SECRET,
        },
        {
          url: "https://example.com/recent#section",
          title: "Recent",
          lastVisitedAt: "2026-06-30T00:05:00Z",
        },
      ],
    },
  } as unknown as Partial<StudioSettings>);

  const raw = readFileSync(settingsFile(), "utf8");
  // The strongest guarantee: the secret never appears anywhere in the file.
  expect(raw).not.toContain(SECRET);

  const onDisk = JSON.parse(raw);
  expect(onDisk.apiKey).toBeUndefined();
  expect(onDisk.token).toBeUndefined();
  expect(onDisk.accessToken).toBeUndefined();
  // Non-secret metadata persists; the smuggled key was stripped.
  expect(onDisk.linear).toEqual({ writesEnabled: true, defaultTeamId: "T" });
  expect(onDisk.terminal).toEqual({ enabled: false, maxConcurrent: 2 });
  expect(onDisk.browser).toEqual({
    enabled: true,
    bookmarks: [
      {
        url: "https://example.com/safe",
        title: "",
        createdAt: "2026-06-30T00:00:00Z",
      },
      {
        url: "https://example.com/fragment",
        title: "Fragment leak",
        createdAt: "2026-06-30T00:02:00Z",
      },
    ],
    history: [
      {
        url: "https://example.com/recent",
        title: "Recent",
        lastVisitedAt: "2026-06-30T00:05:00Z",
      },
    ],
  });
});

// ---------------------------------------------------------------------------
// Rev620 fixes — secret-shaped keys/ids dropped; malformed object/array patches
// preserve the prior value instead of clobbering with an empty container.
// ---------------------------------------------------------------------------

test("drops a secret-shaped key from the ui.collapsed map (never persisted as a JSON key)", async () => {
  const SECRET = "lin_api_supersecret_DO_NOT_PERSIST";
  await updateSettings({
    ui: { collapsed: { "panel.details": true, [SECRET]: true } },
  } as Partial<StudioSettings>);

  const raw = readFileSync(settingsFile(), "utf8");
  expect(raw).not.toContain(SECRET);

  const loaded = await loadSettings();
  expect(loaded.ui?.collapsed).toEqual({ "panel.details": true });
});

test("drops secret-shaped entries from id lists (pinnedCommands, navOrder, panel ids)", async () => {
  const SECRET = "ghp_secretsecretsecretsecret";
  await updateSettings({
    ui: { pinnedCommands: ["tan", SECRET] },
    layout: {
      navOrder: ["dashboard", SECRET],
      chatRailPanels: [
        { id: SECRET, visible: true },
        { id: "subagents", visible: false },
      ],
    },
  } as Partial<StudioSettings>);

  const raw = readFileSync(settingsFile(), "utf8");
  expect(raw).not.toContain(SECRET);

  const loaded = await loadSettings();
  expect(loaded.ui?.pinnedCommands).toEqual(["tan"]);
  expect(loaded.layout?.navOrder).toEqual(["dashboard"]);
  expect(loaded.layout?.chatRailPanels).toEqual([
    { id: "subagents", visible: false },
  ]);
});

test("persists right-rail layout fields and drops invalid/secret-shaped ones (AGE-630)", async () => {
  // Valid id + finite width round-trip.
  await updateSettings({
    layout: { rightPanelId: "skills", rightPanelWidthPct: 32 },
  });
  let loaded = await loadSettings();
  expect(loaded.layout?.rightPanelId).toBe("skills");
  expect(loaded.layout?.rightPanelWidthPct).toBe(32);

  // A secret-shaped rightPanelId is rejected (id-guard parity); a non-finite
  // width is rejected. Neither valid field present → no clobber of the prior.
  const SECRET = "ghp_secretsecretsecretsecret";
  await updateSettings({
    layout: {
      rightPanelId: SECRET,
      rightPanelWidthPct: Number.POSITIVE_INFINITY,
    },
  } as unknown as Partial<StudioSettings>);
  const raw = readFileSync(settingsFile(), "utf8");
  expect(raw).not.toContain(SECRET);
  loaded = await loadSettings();
  expect(loaded.layout).toEqual({
    rightPanelId: "skills",
    rightPanelWidthPct: 32,
  });
});

test("a {rightPanelId: null} patch clears a previously-set rightPanelId (AGE-630)", async () => {
  // Open then resize: layout carries an id alongside other fields.
  await updateSettings({
    layout: { rightPanelId: "skills", rightPanelWidthPct: 30 },
  });
  expect((await loadSettings()).layout?.rightPanelId).toBe("skills");

  // Collapse: the renderer sends the full merged layout with a null id. The
  // closed state must persist (null cleared), keeping the other fields intact.
  await updateSettings({
    layout: { rightPanelId: null, rightPanelWidthPct: 30 },
  });
  let loaded = await loadSettings();
  expect(loaded.layout?.rightPanelId ?? null).toBeNull();
  expect(loaded.layout?.rightPanelWidthPct).toBe(30);

  // Case B: id as the ONLY layout field still clears (would otherwise reopen).
  await updateSettings({ layout: { rightPanelId: "mcp" } });
  expect((await loadSettings()).layout?.rightPanelId).toBe("mcp");
  await updateSettings({ layout: { rightPanelId: null } });
  loaded = await loadSettings();
  expect(loaded.layout?.rightPanelId ?? null).toBeNull();
});

test("a malformed object-shaped namespace patch preserves the prior value (no empty-clobber)", async () => {
  await updateSettings({
    layout: { sidebarWidthPct: 30 },
    ui: { collapsed: { "panel.x": true } },
  });
  // Object-shaped but no valid field survives (invalid value + unknown key, and
  // a collapse map whose only entry is non-boolean) → must NOT clobber.
  await updateSettings({
    layout: { sidebarWidthPct: "wide", bogus: 1 },
    ui: { collapsed: { "panel.y": "nope" } },
  } as unknown as Partial<StudioSettings>);

  const loaded = await loadSettings();
  expect(loaded.layout).toEqual({ sidebarWidthPct: 30 });
  expect(loaded.ui).toEqual({ collapsed: { "panel.x": true } });
});

test("a workspaces patch that is all-invalid preserves prior; an empty array clears", async () => {
  const w = { id: "w1", cwd: "/a", label: "A", pinned: false, lastUsedAt: "t" };
  await updateSettings({ workspaces: [w] });

  // Non-empty but all-invalid → malformed → preserve prior.
  await updateSettings({
    workspaces: [{ bogus: true }],
  } as unknown as Partial<StudioSettings>);
  expect((await loadSettings()).workspaces).toEqual([w]);

  // Explicit empty array → honoured clear.
  await updateSettings({ workspaces: [] });
  expect((await loadSettings()).workspaces).toEqual([]);
});

test("honours an explicit empty collapse map as a clear", async () => {
  await updateSettings({ ui: { collapsed: { "panel.x": true } } });
  await updateSettings({ ui: { collapsed: {} } });
  expect((await loadSettings()).ui?.collapsed).toEqual({});
});

test("coerceWorkspaces keeps a valid palette color and drops an off-palette one", async () => {
  // A valid curated key survives the persist → load → coerce round-trip.
  await updateSettings({
    workspaces: [
      {
        id: "w1",
        cwd: "/a",
        label: "A",
        pinned: false,
        lastUsedAt: "t",
        color: "blue",
      },
    ],
  });
  expect((await loadSettings()).workspaces).toEqual([
    {
      id: "w1",
      cwd: "/a",
      label: "A",
      pinned: false,
      lastUsedAt: "t",
      color: "blue",
    },
  ]);

  // An off-palette / injected color is dropped like any unknown field; the
  // workspace itself is preserved.
  await updateSettings({
    workspaces: [
      {
        id: "w2",
        cwd: "/b",
        label: "B",
        pinned: false,
        lastUsedAt: "t",
        color: "tok_secret",
      },
    ],
  } as unknown as Partial<StudioSettings>);
  const loaded = await loadSettings();
  expect(loaded.workspaces).toEqual([
    { id: "w2", cwd: "/b", label: "B", pinned: false, lastUsedAt: "t" },
  ]);
  expect(loaded.workspaces[0]).not.toHaveProperty("color");
});

import type { Dirent } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type {
  AgentInfo,
  McpServerInfo,
  ModelInfo,
  ProviderAuthStatus,
  ProviderInfo,
  SkillInfo,
} from "@shared/domain";
import { agentDir, mcpConfigPath, ompBinary } from "../paths";
import { probeCredential, runCli, runJson } from "./cli";

// ---------------------------------------------------------------------------
// Frontmatter parsing (shared by skills + agents)
// ---------------------------------------------------------------------------

type Frontmatter = Record<string, string | undefined>;

/**
 * Parse the `---`-delimited YAML frontmatter of a markdown file. Only top-level
 * (column-0) scalar keys are captured; nested mapping keys (e.g. inside an
 * `output:` block) are ignored. A key whose inline value is empty adopts the
 * first item of a following block list (`key:\n  - value`).
 */
function parseFrontmatter(text: string): Frontmatter {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) return {};

  const result: Frontmatter = {};
  for (let i = 1; i < end; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    if (key === undefined) continue;
    let value = (match[2] ?? "").trim();
    if (!value) {
      for (let j = i + 1; j < end; j += 1) {
        const next = lines[j];
        if (next === undefined) break;
        if (/^\S/.test(next)) break;
        const item = /^\s*-\s*(.*)$/.exec(next);
        if (item) {
          value = (item[1] ?? "").trim();
          break;
        }
        if (next.trim() === "") continue;
        break;
      }
    }
    result[key] = value.replace(/^(["'])(.*)\1$/, "$2");
  }
  return result;
}

/** Recursively collect files named `target` under `root`, capped at `maxDepth`. */
async function findFiles(
  root: string,
  target: string,
  maxDepth: number,
): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) await walk(full, depth + 1);
      } else if (entry.name === target) {
        found.push(full);
      }
    }
  };
  await walk(root, 0);
  return found;
}

// ---------------------------------------------------------------------------
// Models / providers
// ---------------------------------------------------------------------------

export async function listModels(): Promise<ModelInfo[]> {
  const result = await runJson<{ models: ModelInfo[] }>(ompBinary(), [
    "models",
    "--json",
  ]);
  return result?.models ?? [];
}

/** Signature of the shared CLI runner; injectable so tests can stub spawning. */
type CliRunner = typeof runCli;

/** Signature of the count-only credential probe; injectable for tests. */
type CredentialProbe = typeof probeCredential;

/** Re-probe provider auth at most this often; spawning `omp` is not free. */
const PROVIDER_CACHE_TTL_MS = 60_000;

/** Hard ceiling on a single count-only `omp token` probe. */
const TOKEN_PROBE_TIMEOUT_MS = 3_000;

let providerCache: { at: number; providers: ProviderInfo[] } | null = null;

/** A provider whose every model is free needs no credential (e.g. llama.cpp). */
function isCostFreeProvider(model: ModelInfo): boolean {
  const cost = model.cost;
  if (!cost) return true;
  return (
    (cost.input ?? 0) === 0 &&
    (cost.output ?? 0) === 0 &&
    (cost.cacheRead ?? 0) === 0 &&
    (cost.cacheWrite ?? 0) === 0
  );
}

/**
 * Providers that `omp usage --json --redact` reports against — these are
 * authenticated accounts. Returns an empty set on any failure so detection
 * degrades to per-provider probing rather than guessing.
 */
async function fetchUsageProviders(run: CliRunner): Promise<Set<string>> {
  const found = new Set<string>();
  const result = await run(ompBinary(), ["usage", "--json", "--redact"]);
  if (result.code !== 0) return found;
  const start = result.stdout.search(/[{[]/);
  if (start < 0) return found;
  let parsed: { reports?: Array<{ provider?: unknown }> };
  try {
    parsed = JSON.parse(result.stdout.slice(start));
  } catch {
    return found;
  }
  for (const report of parsed.reports ?? []) {
    if (typeof report.provider === "string") found.add(report.provider);
  }
  return found;
}

/**
 * Count-only credential probe for a single provider. Reads ONLY whether a
 * credential exists — a clean exit with at least one stdout byte. The probe
 * never accumulates, inspects, stores, returns, or logs the token bytes (see
 * {@link probeCredential}). A timeout / spawn failure (exit code < 0) is too
 * ambiguous to call a negative, so it degrades to "unknown".
 */
async function probeToken(
  probe: CredentialProbe,
  provider: string,
): Promise<ProviderAuthStatus> {
  const { exitCode, hasStdout } = await probe(
    ompBinary(),
    ["token", provider],
    {
      timeoutMs: TOKEN_PROBE_TIMEOUT_MS,
    },
  );
  if (exitCode < 0) return "unknown";
  return exitCode === 0 && hasStdout ? "authenticated" : "unauthenticated";
}

/**
 * Resolve real auth status for every provider that has models, using a single
 * `omp usage` snapshot plus count-only token probes. Exported (with injectable
 * `run`/`probe` deps) so the no-leak / timeout / not-required paths are
 * unit-testable without spawning a real `omp`.
 */
export async function detectProviderAuth(
  models: ModelInfo[],
  run: CliRunner = runCli,
  probe: CredentialProbe = probeCredential,
): Promise<ProviderInfo[]> {
  const groups = new Map<string, { count: number; allFree: boolean }>();
  for (const model of models) {
    const free = isCostFreeProvider(model);
    const group = groups.get(model.provider);
    if (group) {
      group.count += 1;
      group.allFree &&= free;
    } else {
      groups.set(model.provider, { count: 1, allFree: free });
    }
  }

  const usageProviders = await fetchUsageProviders(run);

  const providers: ProviderInfo[] = [];
  for (const [id, { count, allFree }] of groups) {
    let authStatus: ProviderAuthStatus;
    let authSource: ProviderInfo["authSource"];
    if (usageProviders.has(id)) {
      authStatus = "authenticated";
      authSource = "usage";
    } else if (allFree) {
      authStatus = "not_required";
      authSource = "local";
    } else {
      authStatus = await probeToken(probe, id);
      authSource =
        authStatus === "authenticated"
          ? "token"
          : authStatus === "unknown"
            ? "error"
            : "none";
    }
    providers.push({
      id,
      name: id,
      authenticated: authStatus === "authenticated",
      authStatus,
      authSource,
      modelCount: count,
    });
  }
  return providers;
}

export async function listProviders(): Promise<ProviderInfo[]> {
  const now = Date.now();
  if (providerCache && now - providerCache.at < PROVIDER_CACHE_TTL_MS) {
    return providerCache.providers;
  }
  const providers = await detectProviderAuth(await listModels(), runCli);
  providerCache = { at: now, providers };
  return providers;
}

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

interface RawMcpEntry {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  auth?: { type?: string };
  enabled?: boolean;
}

async function collectMcp(
  path: string,
  source: "user" | "project",
  out: McpServerInfo[],
): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return;
  }
  let parsed: { mcpServers?: Record<string, RawMcpEntry> };
  try {
    parsed = JSON.parse(raw) as { mcpServers?: Record<string, RawMcpEntry> };
  } catch {
    return;
  }
  const entries = parsed.mcpServers;
  if (!entries || typeof entries !== "object") return;
  for (const [name, entry] of Object.entries(entries)) {
    if (!entry || typeof entry !== "object") continue;
    out.push({
      name,
      type: entry.type ?? "stdio",
      url: entry.url,
      command: entry.command,
      args: entry.args,
      authType: entry.auth?.type,
      enabled: entry.enabled !== false,
      source,
    });
  }
}

export async function listMcpServers(cwd?: string): Promise<McpServerInfo[]> {
  const servers: McpServerInfo[] = [];
  await collectMcp(mcpConfigPath(), "user", servers);
  await collectMcp(join(cwd ?? process.cwd(), ".mcp.json"), "project", servers);
  return servers;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

async function collectSkills(
  root: string,
  source: SkillInfo["source"],
  maxDepth: number,
  out: Map<string, SkillInfo>,
): Promise<void> {
  for (const path of await findFiles(root, "SKILL.md", maxDepth)) {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(text);
    const name = fm.name ?? basename(dirname(path));
    out.set(name, { name, description: fm.description ?? "", path, source });
  }
}

/**
 * A skill root to scan: its filesystem path, the `source` tag applied to every
 * skill found under it, and the recursion cap for {@link findFiles}.
 */
interface SkillRoot {
  root: string;
  source: SkillInfo["source"];
  maxDepth: number;
}

/** How many ancestor levels above `cwd` we probe for project skill roots. */
const SKILL_WALKUP_DEPTH = 5;

/** Per-root recursion cap for non-builtin roots (some skills nest one level). */
const SKILL_MAX_DEPTH = 2;

/** `cwd` plus up to `depth` ancestor directories, stopping at the fs root. */
function ancestorDirs(start: string, depth: number): string[] {
  const dirs: string[] = [];
  let dir = start;
  for (let i = 0; i <= depth; i++) {
    dirs.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

/**
 * The ordered skill roots, lowest precedence first (later sources overwrite on
 * name collision): builtin < managed < user < project. Mirrors omp's own
 * discovery — project walk-up for `.agents`/`.agent`, the home `.claude` dir,
 * and the managed/auto-learn dir at the EXACT `managed-skills` subpath (never a
 * broad `agentDir()` scan, which also holds sessions/blobs/SQLite DBs).
 */
function skillRoots(cwd: string, home: string): SkillRoot[] {
  const agent = agentDir();
  const roots: SkillRoot[] = [
    // builtin — bundled workflow-kit, nested several levels deep.
    { root: join(agent, "workflow-kit"), source: "builtin", maxDepth: 6 },
    // managed/auto-learn skills at the exact subdir.
    {
      root: join(agent, "managed-skills"),
      source: "managed",
      maxDepth: SKILL_MAX_DEPTH,
    },
    // user home roots.
    {
      root: join(home, ".agents", "skills"),
      source: "user",
      maxDepth: SKILL_MAX_DEPTH,
    },
    {
      root: join(home, ".agent", "skills"),
      source: "user",
      maxDepth: SKILL_MAX_DEPTH,
    },
    {
      root: join(home, ".claude", "skills"),
      source: "claude",
      maxDepth: SKILL_MAX_DEPTH,
    },
  ];
  // Project roots: walk up from cwd collecting `.agents/skills` + `.agent/skills`
  // at each ancestor (farthest first so the nearest dir wins), then the project
  // `.claude/skills`. Skip any path already classified above — when cwd is nested
  // under home, the walk-up reaches home and would otherwise re-add the user
  // `~/.agents`/`~/.agent` dirs as `source:"project"`, clobbering the correct
  // "user" entries via name-keyed dedup and breaking project>user precedence.
  const seen = new Set(roots.map((r) => r.root));
  const addProject = (root: string, source: SkillInfo["source"]): void => {
    if (seen.has(root)) return;
    seen.add(root);
    roots.push({ root, source, maxDepth: SKILL_MAX_DEPTH });
  };
  for (const dir of ancestorDirs(cwd, SKILL_WALKUP_DEPTH).reverse()) {
    addProject(join(dir, ".agents", "skills"), "project");
    addProject(join(dir, ".agent", "skills"), "project");
  }
  addProject(join(cwd, ".claude", "skills"), "claude");
  return roots;
}

// `home` is an injectable test seam (real `homedir()` by default); `os.homedir()`
// ignores `$HOME` on macOS, so user-home roots cannot be redirected via env.
export async function listSkills(
  cwd?: string,
  home: string = homedir(),
): Promise<SkillInfo[]> {
  const byName = new Map<string, SkillInfo>();
  for (const { root, source, maxDepth } of skillRoots(
    cwd ?? process.cwd(),
    home,
  )) {
    await collectSkills(root, source, maxDepth, byName);
  }
  return [...byName.values()];
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

async function collectAgents(
  dir: string,
  source: AgentInfo["source"],
  out: Map<string, AgentInfo>,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const file of entries) {
    if (!file.endsWith(".md")) continue;
    const path = join(dir, file);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(text);
    const name = fm.name ?? file.slice(0, -3);
    const description = fm.description ?? "";
    out.set(name, {
      name,
      description,
      model: fm.model,
      spawns: fm.spawns,
      source,
      readOnly: /READ-ONLY/i.test(description) || name === "explore",
      path,
    });
  }
}

export async function listAgents(cwd?: string): Promise<AgentInfo[]> {
  const byName = new Map<string, AgentInfo>();

  // Builtin agents are materialized to a temp dir via `omp agents unpack`.
  try {
    const tmp = await mkdtemp(join(tmpdir(), "omp-agents-"));
    try {
      await runCli(ompBinary(), ["agents", "unpack", "--dir", tmp, "--json"]);
      await collectAgents(tmp, "builtin", byName);
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch {
    // unpack unavailable; continue with user/project agents.
  }

  await collectAgents(join(agentDir(), "agents"), "user", byName);
  await collectAgents(
    join(cwd ?? process.cwd(), ".omp", "agents"),
    "project",
    byName,
  );
  return [...byName.values()];
}

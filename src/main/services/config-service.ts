import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Dirent } from "node:fs";
import { runCli, runJson } from "./cli";
import { agentDir, mcpConfigPath, ompBinary } from "../paths";
import type {
  AgentInfo,
  McpServerInfo,
  ModelInfo,
  ProviderInfo,
  SkillInfo,
} from "@shared/domain";

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
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) return {};

  const result: Frontmatter = {};
  for (let i = 1; i < end; i += 1) {
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    let value = match[2].trim();
    if (!value) {
      for (let j = i + 1; j < end; j += 1) {
        const next = lines[j];
        if (/^\S/.test(next)) break;
        const item = /^\s*-\s*(.*)$/.exec(next);
        if (item) {
          value = item[1].trim();
          break;
        }
        if (next.trim() === "") continue;
        break;
      }
    }
    result[match[1]] = value.replace(/^(["'])(.*)\1$/, "$2");
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

export async function listProviders(): Promise<ProviderInfo[]> {
  const counts = new Map<string, number>();
  for (const model of await listModels()) {
    counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
  }
  const providers: ProviderInfo[] = [];
  for (const [id, modelCount] of counts) {
    // B2 replaces this with real usage/token detection; stopgap keeps the
    // contract satisfied without leaking or probing tokens.
    const authenticated = true;
    providers.push({
      id,
      name: id,
      authenticated,
      authStatus: authenticated ? "authenticated" : "unknown",
      modelCount,
    });
  }
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

export async function listMcpServers(): Promise<McpServerInfo[]> {
  const servers: McpServerInfo[] = [];
  await collectMcp(mcpConfigPath(), "user", servers);
  await collectMcp(join(process.cwd(), ".mcp.json"), "project", servers);
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

export async function listSkills(): Promise<SkillInfo[]> {
  const byName = new Map<string, SkillInfo>();
  // Lowest precedence first; later sources overwrite (project > user > builtin).
  await collectSkills(join(agentDir(), "workflow-kit"), "builtin", 6, byName);
  await collectSkills(join(homedir(), ".agents", "skills"), "user", 1, byName);
  await collectSkills(join(process.cwd(), ".agents", "skills"), "project", 1, byName);
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

export async function listAgents(): Promise<AgentInfo[]> {
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
  await collectAgents(join(process.cwd(), ".omp", "agents"), "project", byName);
  return [...byName.values()];
}

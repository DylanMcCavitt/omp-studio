import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listAgents,
  listMcpServers,
  listSkills,
} from "../src/main/services/config-service";

// Hermetic unit tests for the v2 skill/mcp/agent discovery roots (feat 6a/§4.4).
// `agentDir()` is redirected via PI_CODING_AGENT_DIR (builtin/managed roots, the
// user mcp.json, and user agents all live under it). `os.homedir()` ignores
// $HOME on macOS, so the user-home skill roots are redirected through
// listSkills' injectable `home` arg instead. The project roots are driven purely
// by the threaded `cwd`. OMP_BINARY is pointed at a nonexistent path so
// listAgents' builtin `omp agents unpack` degrades to nothing (runCli never
// throws) — keeping the suite fast and free of host omp state.

const ORIGINAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;
const ORIGINAL_OMP_BINARY = process.env.OMP_BINARY;

beforeEach(() => {
  process.env.OMP_BINARY = join(tmpdir(), "omp-age619-nonexistent-binary");
});

afterAll(() => {
  if (ORIGINAL_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = ORIGINAL_AGENT_DIR;
  if (ORIGINAL_OMP_BINARY === undefined) delete process.env.OMP_BINARY;
  else process.env.OMP_BINARY = ORIGINAL_OMP_BINARY;
});

function mk(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `omp-studio-cfg-${prefix}-`));
}

/** Write `<parent>/<folder>/SKILL.md` with the given frontmatter name. */
async function writeSkill(
  parent: string,
  folder: string,
  name: string,
): Promise<void> {
  const dir = join(parent, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} description\n---\n# ${name}\n`,
  );
}

test("listSkills discovers a skill under each new root with the right source tag", async () => {
  const home = mk("home");
  const agent = mk("agent");
  const project = mk("project");
  const cwd = join(project, "nested", "deep");
  await mkdir(cwd, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agent;

  await writeSkill(join(agent, "managed-skills"), "m", "managed-skill");
  await writeSkill(join(home, ".agents", "skills"), "ua", "user-agents-skill");
  await writeSkill(join(home, ".agent", "skills"), "us", "user-agent-skill");
  await writeSkill(join(home, ".claude", "skills"), "uc", "user-claude-skill");
  // Project walk-up: `.agents/skills` two levels above cwd.
  await writeSkill(join(project, ".agents", "skills"), "pw", "project-walkup");
  await writeSkill(join(cwd, ".agent", "skills"), "pa", "project-agent-skill");
  await writeSkill(
    join(cwd, ".claude", "skills"),
    "pc",
    "project-claude-skill",
  );

  const skills = await listSkills(cwd, home);
  const bySource = new Map(skills.map((s) => [s.name, s.source]));

  expect(bySource.get("managed-skill")).toBe("managed");
  expect(bySource.get("user-agents-skill")).toBe("user");
  expect(bySource.get("user-agent-skill")).toBe("user");
  expect(bySource.get("user-claude-skill")).toBe("claude");
  expect(bySource.get("project-walkup")).toBe("project");
  expect(bySource.get("project-agent-skill")).toBe("project");
  expect(bySource.get("project-claude-skill")).toBe("claude");
});

test("listSkills scans only managed-skills under agentDir, never sessions/blobs noise", async () => {
  const home = mk("emptyhome");
  const agent = mk("agent");
  const project = mk("emptyproj");
  process.env.PI_CODING_AGENT_DIR = agent;

  await writeSkill(join(agent, "managed-skills"), "learned", "learned-skill");
  // Noise that a broad agentDir() scan would wrongly surface.
  await writeSkill(join(agent, "sessions"), "s", "ghost-session");
  await writeSkill(join(agent, "blobs"), "b", "ghost-blob");
  await mkdir(agent, { recursive: true });
  await writeFile(
    join(agent, "SKILL.md"),
    "---\nname: ghost-root\ndescription: x\n---\n",
  );

  const skills = await listSkills(project, home);
  const names = skills.map((s) => s.name);

  expect(names).toContain("learned-skill");
  expect(names).not.toContain("ghost-session");
  expect(names).not.toContain("ghost-blob");
  expect(names).not.toContain("ghost-root");
});

test("listSkills gives project roots precedence over user roots on name collision", async () => {
  const home = mk("home");
  const agent = mk("agent");
  const project = mk("project");
  process.env.PI_CODING_AGENT_DIR = agent;

  await writeSkill(join(home, ".agents", "skills"), "dup", "dup");
  await writeSkill(join(project, ".agents", "skills"), "dup", "dup");

  const skills = await listSkills(project, home);
  const dup = skills.filter((s) => s.name === "dup");

  expect(dup).toHaveLength(1);
  expect(dup[0]?.source).toBe("project");
});

test("listSkills keeps user-home skills tagged 'user' when cwd is nested under home", async () => {
  // The project walk-up reaches `home` as an ancestor of cwd; it must NOT
  // re-add `~/.agents`/`~/.agent` as source:"project" and clobber the user entry.
  const home = mk("home");
  const agent = mk("agent");
  process.env.PI_CODING_AGENT_DIR = agent;
  const cwd = join(home, "projects", "app");
  await mkdir(cwd, { recursive: true });
  await writeSkill(join(home, ".agents", "skills"), "homed", "home-skill");

  const skills = await listSkills(cwd, home);
  const homed = skills.filter((s) => s.name === "home-skill");

  expect(homed).toHaveLength(1);
  expect(homed[0]?.source).toBe("user");
});

test("listSkills degrades to [] when every root is missing", async () => {
  process.env.PI_CODING_AGENT_DIR = join(tmpdir(), "omp-age619-no-agent");
  const skills = await listSkills(
    join(tmpdir(), "omp-age619-no-cwd"),
    join(tmpdir(), "omp-age619-no-home"),
  );
  expect(skills).toEqual([]);
});

test("listMcpServers threads cwd to the project .mcp.json", async () => {
  const agent = mk("agent");
  const project = mk("project");
  process.env.PI_CODING_AGENT_DIR = agent;
  await mkdir(project, { recursive: true });
  await writeFile(
    join(project, ".mcp.json"),
    JSON.stringify({
      mcpServers: { projsrv: { type: "stdio", command: "x" } },
    }),
  );

  const found = await listMcpServers(project);
  const projsrv = found.find((s) => s.name === "projsrv");
  expect(projsrv?.source).toBe("project");

  // A different cwd must not surface the project server.
  const elsewhere = await listMcpServers(mk("other"));
  expect(elsewhere.find((s) => s.name === "projsrv")).toBeUndefined();
});

test("listMcpServers degrades to [] when no config exists", async () => {
  process.env.PI_CODING_AGENT_DIR = join(tmpdir(), "omp-age619-no-agent-mcp");
  const found = await listMcpServers(join(tmpdir(), "omp-age619-no-cwd-mcp"));
  expect(found).toEqual([]);
});

test("listAgents threads cwd to the project .omp/agents directory", async () => {
  const agent = mk("agent");
  const project = mk("project");
  process.env.PI_CODING_AGENT_DIR = agent;
  const agentsDir = join(project, ".omp", "agents");
  await mkdir(agentsDir, { recursive: true });
  await writeFile(
    join(agentsDir, "age619proj.md"),
    "---\nname: age619proj\ndescription: project agent\n---\n",
  );

  const agents = await listAgents(project);
  const proj = agents.find((a) => a.name === "age619proj");
  expect(proj?.source).toBe("project");

  // A different cwd must not surface the project agent.
  const elsewhere = await listAgents(mk("other"));
  expect(elsewhere.find((a) => a.name === "age619proj")).toBeUndefined();
});

test("listAgents surfaces no user/project agents when those roots are missing", async () => {
  // The builtin set comes from `omp agents unpack` (host-dependent, separately
  // covered in data-services.test.ts); the disk-backed user/project roots must
  // contribute nothing when absent, and the call must never throw.
  process.env.PI_CODING_AGENT_DIR = join(
    tmpdir(),
    "omp-age619-no-agent-agents",
  );
  const agents = await listAgents(join(tmpdir(), "omp-age619-no-cwd-agents"));
  expect(Array.isArray(agents)).toBe(true);
  expect(
    agents.some((a) => a.source === "user" || a.source === "project"),
  ).toBe(false);
});

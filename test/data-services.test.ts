import { expect, test } from "bun:test";
import {
  listAgents,
  listMcpServers,
  listModels,
  listProviders,
  listSkills,
} from "../src/main/services/config-service";
import { currentRepo } from "../src/main/services/github";
import { listSessions } from "../src/main/services/session-store";

// Real integration tests against the live omp install + on-disk agent state.

test("listModels returns selectable models from `omp models --json`", async () => {
  const models = await listModels();
  expect(Array.isArray(models)).toBe(true);
  expect(models.length).toBeGreaterThan(0);
  const first = models[0]!;
  expect(typeof first.provider).toBe("string");
  expect(typeof first.selector).toBe("string");
  expect(first.selector).toContain("/");
});

test("listProviders groups models by provider", async () => {
  const providers = await listProviders();
  expect(providers.length).toBeGreaterThan(0);
  expect(providers.every((p) => p.modelCount > 0)).toBe(true);
});

test("listAgents includes the bundled task agents", async () => {
  const agents = await listAgents();
  const names = agents.map((a) => a.name);
  expect(names).toContain("task");
  expect(names).toContain("explore");
  const explore = agents.find((a) => a.name === "explore");
  expect(explore?.readOnly).toBe(true);
});

test("listSkills returns markdown skills with descriptions", async () => {
  const skills = await listSkills();
  expect(Array.isArray(skills)).toBe(true);
  if (skills.length > 0) {
    expect(typeof skills[0]!.name).toBe("string");
    expect(typeof skills[0]!.description).toBe("string");
  }
});

test("listMcpServers reads the user mcp.json", async () => {
  const servers = await listMcpServers();
  expect(Array.isArray(servers)).toBe(true);
  // The user config defines robinhood-trading; assert shape if present.
  for (const s of servers) {
    expect(typeof s.name).toBe("string");
    expect(typeof s.type).toBe("string");
  }
});

test("listSessions returns parsed session summaries", async () => {
  const sessions = await listSessions();
  expect(Array.isArray(sessions)).toBe(true);
  if (sessions.length > 0) {
    const s = sessions[0]!;
    expect(typeof s.id).toBe("string");
    expect(s.path.endsWith(".jsonl")).toBe(true);
    expect(s.messageCount).toBeGreaterThanOrEqual(0);
  }
});

test("github.currentRepo resolves without throwing", async () => {
  const repo = await currentRepo();
  expect(repo === null || typeof repo.nameWithOwner === "string").toBe(true);
});

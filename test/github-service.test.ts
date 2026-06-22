import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import * as cli from "../src/main/services/cli";
import { currentRepo, listIssues, listPrs } from "../src/main/services/github";

// Stub the CLI runner so we can assert which cwd `gh` is invoked in without
// shelling out. `runJson` is the only seam github.ts uses; capture every call.
//
// The mock is installed in `beforeAll` and torn down in `afterAll` (rather than
// at module top level) because bun shares one module registry across the whole
// test run: a leaked `mock.module` would also replace the runner used by
// config-service in data-services.test.ts.
interface RunnerCall {
  bin: string;
  args: string[];
  opts?: { cwd?: string };
}

const calls: RunnerCall[] = [];
const realRunCli = cli.runCli;
const realRunJson = cli.runJson;

beforeAll(() => {
  mock.module("../src/main/services/cli", () => ({
    runCli: realRunCli,
    runJson: async (bin: string, args: string[], opts?: { cwd?: string }) => {
      calls.push({ bin, args, opts });
      return null;
    },
  }));
});

afterAll(() => {
  mock.module("../src/main/services/cli", () => ({
    runCli: realRunCli,
    runJson: realRunJson,
  }));
});

afterEach(() => {
  calls.length = 0;
});

test("currentRepo invokes gh in the provided cwd", async () => {
  await currentRepo("/tmp/project-x");
  const call = calls.at(-1);
  expect(call?.args.slice(0, 2)).toEqual(["repo", "view"]);
  expect(call?.opts?.cwd).toBe("/tmp/project-x");
});

test("currentRepo falls back to process.cwd() when no cwd is given", async () => {
  await currentRepo();
  expect(calls.at(-1)?.opts?.cwd).toBe(process.cwd());
});

test("listIssues invokes gh in the provided cwd", async () => {
  await listIssues(undefined, "/tmp/project-y");
  const call = calls.at(-1);
  expect(call?.args.slice(0, 2)).toEqual(["issue", "list"]);
  expect(call?.opts?.cwd).toBe("/tmp/project-y");
});

test("listIssues falls back to process.cwd() when no cwd is given", async () => {
  await listIssues();
  expect(calls.at(-1)?.opts?.cwd).toBe(process.cwd());
});

test("listIssues still forwards an explicit repo alongside cwd", async () => {
  await listIssues("owner/repo", "/tmp/project-z");
  const call = calls.at(-1);
  expect(call?.args).toContain("--repo");
  expect(call?.args).toContain("owner/repo");
  expect(call?.opts?.cwd).toBe("/tmp/project-z");
});

test("listPrs invokes gh in the provided cwd", async () => {
  await listPrs(undefined, "/tmp/project-y");
  const call = calls.at(-1);
  expect(call?.args.slice(0, 2)).toEqual(["pr", "list"]);
  expect(call?.opts?.cwd).toBe("/tmp/project-y");
});

test("listPrs falls back to process.cwd() when no cwd is given", async () => {
  await listPrs();
  expect(calls.at(-1)?.opts?.cwd).toBe(process.cwd());
});

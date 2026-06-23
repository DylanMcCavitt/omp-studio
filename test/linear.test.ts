import { afterEach, beforeEach, expect, test } from "bun:test";
import { createLinearService } from "../src/main/services/linear";

// The Linear service is plain-node and electron-free: it speaks GraphQL over the
// process-global `fetch` using a key from an injected getter. These tests stub
// BOTH — `globalThis.fetch` and the key getter — to assert (a) raw→domain
// mapping, (b) the raw (non-Bearer) Authorization header + endpoint, (c) filter
// construction, and (d) graceful degrade to null/[] on every failure mode. The
// real network is never touched.

const realFetch = globalThis.fetch;

// Injected key getter — flipped per test.
let apiKey: string | null;
const getApiKey = async (): Promise<string | null> => apiKey;

// Captures the most recent fetch invocation for request-shape assertions.
let lastCall: { url: string; init: RequestInit } | null;

function stubFetch(impl: (url: string, init: RequestInit) => unknown): void {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    lastCall = { url, init };
    return impl(url, init);
  }) as unknown as typeof globalThis.fetch;
}

// A 200 response whose JSON body is the GraphQL success envelope `{ data }`.
function okData(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data }),
  } as unknown as Response;
}

function headersOf(): Record<string, string> {
  return (lastCall?.init.headers ?? {}) as Record<string, string>;
}

function bodyOf(): { query: string; variables?: Record<string, unknown> } {
  return JSON.parse((lastCall?.init.body as string) ?? "{}");
}

const RAW_ISSUE = {
  id: "abc",
  identifier: "ENG-1",
  title: "Fix the thing",
  url: "https://linear.app/x/issue/ENG-1",
  state: { name: "In Progress", type: "started" },
  priority: 2,
  assignee: { name: "Ada" },
  team: { key: "ENG" },
  project: { name: "Platform" },
  updatedAt: "2026-06-20T00:00:00.000Z",
  createdAt: "2026-06-01T00:00:00.000Z",
};

beforeEach(() => {
  apiKey = "lin_api_secret";
  lastCall = null;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// Mapping + request shape
// ---------------------------------------------------------------------------

test("viewer() maps the payload and sends the API key RAW (not Bearer)", async () => {
  stubFetch(() =>
    okData({
      viewer: { id: "u1", name: "Ada", email: "ada@x.dev" },
      organization: { name: "Acme" },
    }),
  );
  const viewer = await createLinearService(getApiKey).viewer();

  expect(viewer).toEqual({
    id: "u1",
    name: "Ada",
    email: "ada@x.dev",
    organization: "Acme",
  });
  expect(lastCall?.url).toBe("https://api.linear.app/graphql");
  const headers = headersOf();
  // Linear personal API keys are sent verbatim — the Bearer prefix is rejected.
  expect(headers.Authorization).toBe("lin_api_secret");
  expect(headers.Authorization.startsWith("Bearer")).toBe(false);
  expect(headers["Content-Type"]).toBe("application/json");
});

test("viewer() returns null when the viewer node is absent", async () => {
  stubFetch(() => okData({ viewer: null, organization: null }));
  expect(await createLinearService(getApiKey).viewer()).toBeNull();
});

test("teams() maps connection nodes, defaulting missing fields", async () => {
  stubFetch(() =>
    okData({ teams: { nodes: [{ id: "t1", key: "ENG", name: "Eng" }, {}] } }),
  );
  expect(await createLinearService(getApiKey).teams()).toEqual([
    { id: "t1", key: "ENG", name: "Eng" },
    { id: "", key: "", name: "" },
  ]);
});

test("projects() with no team reads the root connection without a teamId var", async () => {
  stubFetch(() =>
    okData({
      projects: { nodes: [{ id: "p1", name: "Plat", progress: 0.5 }] },
    }),
  );
  const projects = await createLinearService(getApiKey).projects();

  expect(projects).toEqual([
    { id: "p1", name: "Plat", state: undefined, url: undefined, progress: 0.5 },
  ]);
  expect(bodyOf().variables?.teamId).toBeUndefined();
});

test("projects(teamId) reads the nested team connection and sends teamId", async () => {
  stubFetch(() =>
    okData({ team: { projects: { nodes: [{ id: "p2", name: "Infra" }] } } }),
  );
  const projects = await createLinearService(getApiKey).projects("t9");

  expect(projects).toEqual([
    {
      id: "p2",
      name: "Infra",
      state: undefined,
      url: undefined,
      progress: undefined,
    },
  ]);
  expect(bodyOf().variables?.teamId).toBe("t9");
});

test("issues() builds the team+assignee filter and maps nodes", async () => {
  stubFetch(() => okData({ issues: { nodes: [RAW_ISSUE] } }));
  const issues = await createLinearService(getApiKey).issues({
    teamId: "t1",
    assignedToMe: true,
    limit: 5,
  });

  expect(issues).toHaveLength(1);
  expect(issues[0]).toEqual({
    id: "abc",
    identifier: "ENG-1",
    title: "Fix the thing",
    url: "https://linear.app/x/issue/ENG-1",
    state: { name: "In Progress", type: "started" },
    priority: 2,
    assignee: { name: "Ada" },
    team: { key: "ENG" },
    project: { name: "Platform" },
    updatedAt: "2026-06-20T00:00:00.000Z",
    createdAt: "2026-06-01T00:00:00.000Z",
  });
  const vars = bodyOf().variables;
  expect(vars?.first).toBe(5);
  expect(vars?.filter).toEqual({
    team: { id: { eq: "t1" } },
    assignee: { isMe: { eq: true } },
  });
});

test("issues() with no opts sends an undefined filter (no over-constraint)", async () => {
  stubFetch(() => okData({ issues: { nodes: [] } }));
  await createLinearService(getApiKey).issues();
  expect(bodyOf().variables?.filter).toBeUndefined();
});

test("issue(id) maps a present node and returns null for an absent one", async () => {
  stubFetch(() => okData({ issue: RAW_ISSUE }));
  expect((await createLinearService(getApiKey).issue("abc"))?.identifier).toBe(
    "ENG-1",
  );

  stubFetch(() => okData({ issue: null }));
  expect(await createLinearService(getApiKey).issue("missing")).toBeNull();
});

test("issue mapping nulls assignee/team/project when those nodes are absent", async () => {
  stubFetch(() =>
    okData({
      issue: { id: "x", identifier: "ENG-2", title: "t", url: "u" },
    }),
  );
  const issue = await createLinearService(getApiKey).issue("x");
  expect(issue?.assignee).toBeNull();
  expect(issue?.team).toBeNull();
  expect(issue?.project).toBeNull();
  expect(issue?.state).toEqual({ name: "", type: "" });
});

// ---------------------------------------------------------------------------
// Write surface (the gate lives in ipc/linear.ts; here the raw calls work)
// ---------------------------------------------------------------------------

test("createIssue() maps the created issue and forwards the input variable", async () => {
  stubFetch(() => okData({ issueCreate: { success: true, issue: RAW_ISSUE } }));
  const created = await createLinearService(getApiKey).createIssue({
    teamId: "t1",
    title: "New",
  });

  expect(created?.identifier).toBe("ENG-1");
  expect(bodyOf().variables?.input).toEqual({ teamId: "t1", title: "New" });
});

test("createIssue() returns null when the mutation reports failure", async () => {
  stubFetch(() => okData({ issueCreate: { success: false, issue: null } }));
  expect(
    await createLinearService(getApiKey).createIssue({
      teamId: "t",
      title: "x",
    }),
  ).toBeNull();
});

test("updateIssue() maps on success", async () => {
  stubFetch(() => okData({ issueUpdate: { success: true, issue: RAW_ISSUE } }));
  const updated = await createLinearService(getApiKey).updateIssue("abc", {
    title: "renamed",
  });
  expect(updated?.identifier).toBe("ENG-1");
});

test("createComment() returns the mutation success boolean", async () => {
  stubFetch(() => okData({ commentCreate: { success: true } }));
  expect(await createLinearService(getApiKey).createComment("i1", "hi")).toBe(
    true,
  );

  stubFetch(() => okData({ commentCreate: { success: false } }));
  expect(await createLinearService(getApiKey).createComment("i1", "hi")).toBe(
    false,
  );
});

// ---------------------------------------------------------------------------
// Graceful degrade — every failure mode resolves to null/[]/false, never throws
// ---------------------------------------------------------------------------

test("no API key → null/[] and the network is never touched", async () => {
  apiKey = null;
  let hit = false;
  stubFetch(() => {
    hit = true;
    return okData({});
  });
  const svc = createLinearService(getApiKey);

  expect(await svc.viewer()).toBeNull();
  expect(await svc.teams()).toEqual([]);
  expect(await svc.projects()).toEqual([]);
  expect(await svc.issues()).toEqual([]);
  expect(await svc.issue("x")).toBeNull();
  expect(await svc.createComment("i", "b")).toBe(false);
  expect(hit).toBe(false);
});

test("a getApiKey that throws degrades to null/[]", async () => {
  globalThis.fetch = (async () => okData({})) as unknown as typeof fetch;
  const svc = createLinearService(async () => {
    throw new Error("keychain locked");
  });
  expect(await svc.viewer()).toBeNull();
  expect(await svc.teams()).toEqual([]);
});

test("a network/abort error degrades to null/[]", async () => {
  globalThis.fetch = (async () => {
    throw new Error("ECONNRESET");
  }) as unknown as typeof fetch;
  const svc = createLinearService(getApiKey);

  expect(await svc.viewer()).toBeNull();
  expect(await svc.teams()).toEqual([]);
  expect(await svc.issue("x")).toBeNull();
});

test("a non-2xx HTTP response degrades to null/[]", async () => {
  stubFetch(
    () =>
      ({
        ok: false,
        status: 429,
        json: async () => ({}),
      }) as unknown as Response,
  );
  const svc = createLinearService(getApiKey);

  expect(await svc.issue("x")).toBeNull();
  expect(await svc.issues()).toEqual([]);
});

test("a GraphQL `errors` payload degrades to null/[]", async () => {
  stubFetch(
    () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          data: null,
          errors: [{ message: "Unauthorized" }],
        }),
      }) as unknown as Response,
  );
  const svc = createLinearService(getApiKey);

  expect(await svc.viewer()).toBeNull();
  expect(await svc.teams()).toEqual([]);
});

test("an invalid JSON body degrades to null", async () => {
  stubFetch(
    () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      }) as unknown as Response,
  );
  expect(await createLinearService(getApiKey).viewer()).toBeNull();
});

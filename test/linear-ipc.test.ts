import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcMain } from "electron";
import { registerLinearIpc } from "../src/main/ipc/linear";
import { setSecretBackend } from "../src/main/services/secret-store";
import type { LinearStatusInfo } from "../src/shared/domain";
import { CH } from "../src/shared/ipc";

// secret-store reaches electron only through setSecretBackend(); inject a fake
// backend (isEncryptionAvailable:false -> in-memory fallback, no disk writes)
// for a deterministic, hermetic key store. No module mocking / electron runtime.
let userDataDir = "";
setSecretBackend({
  app: { getPath: () => userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
});

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

function makeIpcMain(): {
  ipcMain: IpcMain;
  invoke: (channel: string, ...args: unknown[]) => unknown;
} {
  const handlers = new Map<string, IpcHandler>();
  const ipcMain = {
    handle(channel: string, listener: IpcHandler) {
      handlers.set(channel, listener);
    },
  };
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`no handler registered for ${channel}`);
    return handler({}, ...args);
  };
  return { ipcMain: ipcMain as unknown as IpcMain, invoke };
}

const realFetch = globalThis.fetch;
const ORIGINAL_SETTINGS_DIR = process.env.OMP_STUDIO_SETTINGS_DIR;

let invoke: (channel: string, ...args: unknown[]) => unknown;
let fetchHits: number;

function stubFetch(impl: () => unknown): void {
  fetchHits = 0;
  globalThis.fetch = (async () => {
    fetchHits += 1;
    return impl();
  }) as unknown as typeof globalThis.fetch;
}

function okData(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data }),
  } as unknown as Response;
}

function viewerResponse(): Response {
  return okData({
    viewer: { id: "u1", name: "Ada", email: "ada@x.dev" },
    organization: { name: "Acme" },
  });
}

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), "omp-studio-linear-ipc-"));
  // No settings file in this dir → defaults (writes disabled = secure default).
  process.env.OMP_STUDIO_SETTINGS_DIR = userDataDir;
  const harness = makeIpcMain();
  registerLinearIpc(harness.ipcMain);
  invoke = harness.invoke;
  // Reset module-level state (in-memory secret + status probe cache).
  invoke(CH.linearClearApiKey);
  globalThis.fetch = realFetch;
  fetchHits = 0;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  if (ORIGINAL_SETTINGS_DIR === undefined) {
    delete process.env.OMP_STUDIO_SETTINGS_DIR;
  } else {
    process.env.OMP_STUDIO_SETTINGS_DIR = ORIGINAL_SETTINGS_DIR;
  }
});

test("status() is unauthenticated with no key and never probes the network", async () => {
  stubFetch(() => viewerResponse());
  const info = (await invoke(CH.linearStatus)) as LinearStatusInfo;
  expect(info.status).toBe("unauthenticated");
  expect(info.writesEnabled).toBe(false);
  expect(info.viewer).toBeUndefined();
  expect(fetchHits).toBe(0);
});

test("setApiKey validates via viewer{} then persists; status reflects it", async () => {
  stubFetch(() => viewerResponse());
  const set = (await invoke(
    CH.linearSetApiKey,
    "lin_good",
  )) as LinearStatusInfo;
  expect(set.status).toBe("authenticated");
  expect(set.viewer).toEqual({
    id: "u1",
    name: "Ada",
    email: "ada@x.dev",
    organization: "Acme",
  });
  expect(fetchHits).toBe(1); // validated before persisting

  // Status now reports authenticated (served from the TTL cache, no re-probe).
  const status = (await invoke(CH.linearStatus)) as LinearStatusInfo;
  expect(status.status).toBe("authenticated");
  expect(status.viewer?.name).toBe("Ada");
});

test("setApiKey does NOT persist a key that fails validation", async () => {
  stubFetch(
    () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ data: null, errors: [{ message: "auth" }] }),
      }) as unknown as Response,
  );
  const set = (await invoke(CH.linearSetApiKey, "lin_bad")) as LinearStatusInfo;
  expect(set.status).toBe("error");

  // The bad key was never stored — status stays unauthenticated, no fetch needed.
  stubFetch(() => viewerResponse());
  const status = (await invoke(CH.linearStatus)) as LinearStatusInfo;
  expect(status.status).toBe("unauthenticated");
  expect(fetchHits).toBe(0);
});

test("setApiKey with a blank key is a no-op (unauthenticated, no network)", async () => {
  stubFetch(() => viewerResponse());
  const set = (await invoke(CH.linearSetApiKey, "   ")) as LinearStatusInfo;
  expect(set.status).toBe("unauthenticated");
  expect(fetchHits).toBe(0);
});

test("clearApiKey returns status to unauthenticated", async () => {
  stubFetch(() => viewerResponse());
  await invoke(CH.linearSetApiKey, "lin_good");
  await invoke(CH.linearClearApiKey);

  stubFetch(() => viewerResponse());
  const status = (await invoke(CH.linearStatus)) as LinearStatusInfo;
  expect(status.status).toBe("unauthenticated");
  expect(fetchHits).toBe(0);
});

test("write handlers hard-return a no-op while writesEnabled is false", async () => {
  // A key IS present, so only the gate (not auth) can block the write.
  stubFetch(() => viewerResponse());
  await invoke(CH.linearSetApiKey, "lin_good");

  stubFetch(() => okData({ issueCreate: { success: true, issue: {} } }));
  expect(
    await invoke(CH.linearCreateIssue, { teamId: "t", title: "x" }),
  ).toBeNull();
  expect(await invoke(CH.linearUpdateIssue, "id", { title: "x" })).toBeNull();
  expect(await invoke(CH.linearCreateComment, "id", "body")).toBe(false);
  // Gated off → Linear is never called.
  expect(fetchHits).toBe(0);
});

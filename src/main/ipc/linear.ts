// Bridges the renderer's `window.omp.linear` surface to the main-process Linear
// service. ALL Linear HTTP happens in main (see services/linear.ts) — the
// renderer only invokes these `linear:*` channels, so the renderer CSP
// `connect-src 'self'` is satisfied and api.linear.app must NOT be added to it.
//
// This layer owns the electron-bound secret store (safeStorage): it wires the
// real decrypted-key getter into the otherwise electron-free service, validates
// a new key before persisting it, and gates the write surface behind
// `settings.linear.writesEnabled` (off by default — reads are always allowed).

import type {
  LinearIssue,
  LinearStatusInfo,
  LinearViewer,
} from "@shared/domain";
import { CH } from "@shared/ipc";
import type { IpcMain } from "electron";
import { createLinearService } from "../services/linear";
import { clearSecret, getSecret, setSecret } from "../services/secret-store";
import { loadSettings } from "../services/settings-service";

/** Keychain entry name → `<userData>/secrets/linear.bin`. */
const LINEAR_SECRET = "linear";

/** Re-probe `viewer{}` for status at most this often; the HTTP call isn't free. */
const STATUS_CACHE_TTL_MS = 30_000;

// The session-wide service reads the persisted key on every request (so a key
// set/cleared via the handlers below is picked up immediately).
const linear = createLinearService(async () => getSecret(LINEAR_SECRET));

// Cached result of the last `viewer{}` probe (auth-status only; writesEnabled is
// read fresh from settings on every status call since it can toggle anytime).
let probeCache: {
  at: number;
  status: LinearStatusInfo["status"];
  viewer?: LinearViewer;
} | null = null;

async function writesEnabled(): Promise<boolean> {
  // settings.linear is V2 metadata; loadSettings is still typed V1 in this
  // worktree, so read defensively. Absent/false → writes off (secure default).
  const settings = (await loadSettings()) as {
    linear?: { writesEnabled?: boolean };
  };
  return settings.linear?.writesEnabled === true;
}

async function status(): Promise<LinearStatusInfo> {
  const writes = await writesEnabled();
  const now = Date.now();
  if (probeCache && now - probeCache.at < STATUS_CACHE_TTL_MS) {
    return {
      status: probeCache.status,
      viewer: probeCache.viewer,
      writesEnabled: writes,
    };
  }
  if (!getSecret(LINEAR_SECRET)) {
    probeCache = { at: now, status: "unauthenticated" };
    return { status: "unauthenticated", writesEnabled: writes };
  }
  const viewer = await linear.viewer();
  // Key present but probe failed → "error" (transient network OR a now-invalid
  // key); a successful probe → "authenticated".
  probeCache = viewer
    ? { at: now, status: "authenticated", viewer }
    : { at: now, status: "error" };
  return {
    status: probeCache.status,
    viewer: probeCache.viewer,
    writesEnabled: writes,
  };
}

async function setApiKey(key: string): Promise<LinearStatusInfo> {
  const writes = await writesEnabled();
  const candidate = (key ?? "").trim();
  if (!candidate) return { status: "unauthenticated", writesEnabled: writes };
  // Validate BEFORE persisting: probe viewer{} with a service bound to the
  // candidate key. Never store an unvalidated (or network-unreachable) key.
  const viewer = await createLinearService(async () => candidate).viewer();
  if (!viewer) return { status: "error", writesEnabled: writes };
  setSecret(LINEAR_SECRET, candidate);
  probeCache = { at: Date.now(), status: "authenticated", viewer };
  return { status: "authenticated", viewer, writesEnabled: writes };
}

export function registerLinearIpc(ipcMain: IpcMain): void {
  ipcMain.handle(CH.linearStatus, () => status());
  ipcMain.handle(CH.linearSetApiKey, (_event, key: string) => setApiKey(key));
  ipcMain.handle(CH.linearClearApiKey, () => {
    clearSecret(LINEAR_SECRET);
    probeCache = null;
  });

  // Reads — always allowed; each degrades to []/null on any failure.
  ipcMain.handle(CH.linearListTeams, () => linear.teams());
  ipcMain.handle(CH.linearListProjects, (_event, teamId?: string) =>
    linear.projects(teamId),
  );
  ipcMain.handle(
    CH.linearListIssues,
    (
      _event,
      opts?: { teamId?: string; assignedToMe?: boolean; limit?: number },
    ) => linear.issues(opts),
  );
  ipcMain.handle(CH.linearGetIssue, (_event, id: string) => linear.issue(id));

  // Writes — gated behind settings.linear.writesEnabled (off by default). When
  // disabled they hard-return a no-op (null / false) WITHOUT touching Linear.
  ipcMain.handle(
    CH.linearCreateIssue,
    async (
      _event,
      input: { teamId: string; title: string; description?: string },
    ): Promise<LinearIssue | null> =>
      (await writesEnabled()) ? linear.createIssue(input) : null,
  );
  ipcMain.handle(
    CH.linearUpdateIssue,
    async (
      _event,
      id: string,
      patch: { stateId?: string; title?: string; description?: string },
    ): Promise<LinearIssue | null> =>
      (await writesEnabled()) ? linear.updateIssue(id, patch) : null,
  );
  ipcMain.handle(
    CH.linearCreateComment,
    async (_event, issueId: string, body: string): Promise<boolean> =>
      (await writesEnabled()) ? linear.createComment(issueId, body) : false,
  );
}

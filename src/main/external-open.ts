// Electron-side wrapper around the shared external-open URL policy. The only
// module that may call `shell.openExternal` for renderer- or web-influenced
// URLs; everything else routes here (or injects an equivalent through a test
// seam) so the http(s)-only, no-credentials policy is enforced in one place.

import { shell } from "electron";
import { scoped } from "./logger";
import { validateExternalUrl } from "./services/external-url";

const log = scoped("external-open");

/**
 * Open `raw` in the OS browser iff it passes {@link validateExternalUrl}.
 * A blocked or malformed URL is logged and dropped — never thrown, so callers
 * (window-open deniers, IPC handlers) stay rejection-free.
 */
export async function safeOpenExternal(raw: unknown): Promise<void> {
  const verdict = validateExternalUrl(raw);
  if (!verdict.ok) {
    log.warn("blocked external open", { reason: verdict.reason });
    return;
  }
  try {
    await shell.openExternal(verdict.url);
  } catch {
    // Opening a valid-but-unhandled URL must not reject across IPC.
  }
}

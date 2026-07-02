// The single external-open URL policy: what OMP Studio is willing to hand to
// the OS browser (`shell.openExternal`). Everything that opens a URL outside
// the app — the openExternal IPC, the main window's popup/navigation deniers,
// and the embedded browser's popup/external-open paths — funnels through this
// check so `file:`, `smb:`, custom schemes, and credential-bearing URLs can
// never reach the OS handler.
//
// Plain node, no electron — unit-testable under `bun test`.

export type ExternalUrlVerdict =
  | { ok: true; url: string }
  | { ok: false; reason: string };

/**
 * Validate a candidate external-open URL. Allows only well-formed `http:` /
 * `https:` URLs without embedded credentials. Returns the normalized href on
 * success so callers hand the parsed form (not the raw string) to the OS.
 */
export function validateExternalUrl(raw: unknown): ExternalUrlVerdict {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, reason: "url must be a non-empty string" };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "malformed url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: `blocked scheme ${url.protocol}` };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "credentialed urls are not allowed" };
  }
  return { ok: true, url: url.href };
}

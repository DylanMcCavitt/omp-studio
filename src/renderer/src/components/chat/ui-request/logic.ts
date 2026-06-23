// Pure, framework-free logic for the extension UI-request pipeline (C3).
//
// This module holds every decision the UiRequestLayer makes that does NOT need
// React or the DOM: classifying a request by method, deriving the stable
// session-scoped allow key for an approval, and partitioning a session's
// `uiRequests` queue into the surfaces that render it. Keeping it here means it
// is unit-testable under `bun test` (test/ui-request.test.ts) without a DOM and
// reused by the components below without duplicating protocol knowledge.
//
// Imports are type-only (erased at runtime) so the module stays DOM-free and
// bun can run the tests that import it directly. Response shapes themselves
// ({confirmed}/{value}/{cancelled}) are built inline at each call site.

import type { ChatUiRequestEvent } from "@shared/ipc";
import type { ExtensionUiMethod, ExtensionUiRequest } from "@shared/rpc";

/** The four methods that block the agent and render a focused modal dialog. */
const MODAL_METHODS: Partial<Record<ExtensionUiMethod, true>> = {
  confirm: true,
  select: true,
  input: true,
  editor: true,
};

/** Where the layer routes a given request. */
export type UiRequestKind = "modal" | "cancel" | "open_url" | "hint";

export function classifyUiRequest(req: ExtensionUiRequest): UiRequestKind {
  if (MODAL_METHODS[req.method]) return "modal";
  if (req.method === "cancel") return "cancel";
  if (req.method === "open_url") return "open_url";
  return "hint";
}

// ---------------------------------------------------------------------------
// Safe accessor for the deliberately-loose ExtensionUiRequest bag. omp's
// canonical per-method fields (rpc-types) are typed, but our shared type keeps
// `[key: string]: unknown`, so we coerce defensively rather than trust shape.
// Used across the key derivation and every dialog reading title/message/etc.
// ---------------------------------------------------------------------------

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

// ---------------------------------------------------------------------------
// Session-scoped allow key (Always-allow-for-this-session).
//
// We never parse the prose `message` to classify a request (explicitly deferred
// in the PRD). The key is built ONLY from structured fields: a tool identity +
// argument signature when omp provides them, otherwise the stable dialog
// `title`. When neither exists there is no stable key, so "Always allow" is not
// offered for that request.
// ---------------------------------------------------------------------------

/** Deterministic signature of an arguments value (object key order independent). */
function stableSignature(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableSignature(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableSignature(v)}`);
  return `{${entries.join(",")}}`;
}

export function approvalKey(req: ExtensionUiRequest): string | null {
  // ONLY a structured tool identity (+ argument signature) is a stable key. We
  // never key on the prose `title`/`message`: two unrelated actions can share a
  // generic title (e.g. "Confirm"), so a title-keyed allow rule would leak an
  // approval from one action to another. No structured identity → no key → the
  // "Always allow" affordance is disabled for that request.
  const tool = asString(req.toolName) ?? asString(req.tool);
  if (!tool) return null;
  const sig = stableSignature(req.arguments ?? req.args);
  return sig ? `tool:${tool}:${sig}` : `tool:${tool}`;
}

/** A confirm whose key is already on the session allowlist auto-approves. */
export function isAllowed(
  allowKeys: ReadonlySet<string>,
  req: ExtensionUiRequest,
): boolean {
  if (req.method !== "confirm") return false;
  const key = approvalKey(req);
  return key !== null && allowKeys.has(key);
}

// ---------------------------------------------------------------------------
// Queue partitioning. The store keeps EVERY ui-request (modal + hint) in one
// per-session `uiRequests` array; the layer splits it into the surfaces that
// render each kind. `modal` is the single oldest response-required dialog so
// requests are answered one at a time (FIFO).
// ---------------------------------------------------------------------------

export interface UiPartition {
  modal: ChatUiRequestEvent | null;
  hints: ChatUiRequestEvent[];
  openUrls: ChatUiRequestEvent[];
  cancels: ChatUiRequestEvent[];
}

export function partitionUiRequests(
  queue: readonly ChatUiRequestEvent[],
): UiPartition {
  let modal: ChatUiRequestEvent | null = null;
  const hints: ChatUiRequestEvent[] = [];
  const openUrls: ChatUiRequestEvent[] = [];
  const cancels: ChatUiRequestEvent[] = [];
  for (const event of queue) {
    switch (classifyUiRequest(event.request)) {
      case "modal":
        if (event.responseRequired && modal === null) modal = event;
        break;
      case "cancel":
        cancels.push(event);
        break;
      case "open_url":
        openUrls.push(event);
        break;
      case "hint":
        hints.push(event);
        break;
    }
  }
  return { modal, hints, openUrls, cancels };
}

// ---------------------------------------------------------------------------
// Cross-session timeout collection. Every response-required request fail-closes
// on the bridge after its timeout, but the bridge writes only to the child — it
// never tells the renderer. So the layer must independently expire stale
// requests across ALL open sessions (not just the visible one), or a background
// session's answered-on-the-bridge request would leave a dangling modal when
// the user switches to it.
// ---------------------------------------------------------------------------

export interface PendingTimeout {
  sessionId: string;
  requestId: string;
  timeoutMs: number;
}

export function collectResponseRequiredTimeouts(
  openSessions: Record<string, { uiRequests: readonly ChatUiRequestEvent[] }>,
  defaultMs: number,
): PendingTimeout[] {
  const out: PendingTimeout[] = [];
  for (const [sessionId, slice] of Object.entries(openSessions)) {
    for (const event of slice.uiRequests) {
      if (!event.responseRequired) continue;
      const requested = event.request.timeout;
      const timeoutMs =
        typeof requested === "number" && requested > 0 ? requested : defaultMs;
      out.push({ sessionId, requestId: event.request.id, timeoutMs });
    }
  }
  return out;
}

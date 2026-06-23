// Pure, DOM-free text-search helpers shared by the Sessions transcript-hit view
// and the Cmd+K global overlay. The snippet/range math mirrors the main-process
// scanner (src/main/services/session-store.ts) so live in-memory results read
// identically to the historical `searchSessions` hits. Type-only imports keep
// this module runnable under `bun test` without a bundler.

import type { OmpMessage, TextBlock } from "@shared/rpc";

export interface TextRange {
  start: number;
  end: number;
}

/** Characters of context kept on each side of the first match in a snippet. */
const SNIPPET_RADIUS = 60;
/** Max highlighted ranges recorded per hit. */
const MAX_RANGES = 12;

/**
 * Concatenate the human-readable text of a message (text blocks only), matching
 * the main-process search scan: tool-call arguments and image payloads are
 * intentionally excluded.
 */
export function messageText(message: OmpMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (
      block.type === "text" &&
      typeof (block as TextBlock).text === "string"
    ) {
      parts.push((block as TextBlock).text);
    }
  }
  return parts.join("\n");
}

/** All occurrence ranges of `needle` (already lowercased) in `text`, capped. */
export function findRanges(text: string, needle: string): TextRange[] {
  if (!needle) return [];
  const hay = text.toLowerCase();
  const ranges: TextRange[] = [];
  let from = 0;
  while (ranges.length < MAX_RANGES) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) break;
    ranges.push({ start: idx, end: idx + needle.length });
    from = idx + needle.length;
  }
  return ranges;
}

/**
 * Build a bounded snippet windowed around the first match. Snippet offsets in
 * `ranges` are re-based to the snippet string so the renderer can highlight
 * directly; control whitespace is flattened 1:1 (length preserving) so those
 * offsets stay exact.
 */
export function buildSnippet(
  text: string,
  textRanges: TextRange[],
): { snippet: string; ranges: TextRange[] } {
  const first = textRanges[0];
  if (!first) return { snippet: "", ranges: [] };
  const winStart = Math.max(0, first.start - SNIPPET_RADIUS);
  const winEnd = Math.min(text.length, first.end + SNIPPET_RADIUS);
  const core = text.slice(winStart, winEnd).replace(/[\r\n\t]/g, " ");
  const prefix = winStart > 0 ? "… " : "";
  const suffix = winEnd < text.length ? " …" : "";
  const snippet = prefix + core + suffix;
  const offset = prefix.length - winStart;
  const ranges = textRanges
    .filter((r) => r.start >= winStart && r.end <= winEnd)
    .map((r) => ({ start: r.start + offset, end: r.end + offset }));
  return { snippet, ranges };
}

/** One live-session match: a transcript message or a title-only fallback. */
export interface LiveSessionHit {
  sessionId: string;
  title: string;
  /** Index into the session's message array, or -1 for a title-only match. */
  messageIndex: number;
  snippet: string;
  ranges: TextRange[];
}

/** Minimal projection of an open session needed to search it in memory. */
export interface LiveSessionInput {
  sessionId: string;
  title: string;
  messages: OmpMessage[];
}

/**
 * Search open live sessions' in-memory transcripts for `query`, returning at
 * most one hit per session (the first matching message). Sessions whose only
 * match is the derived title fall back to a title hit (`messageIndex: -1`). An
 * empty/whitespace query returns []. Pure and order-preserving.
 */
export function searchLiveSessions(
  sessions: LiveSessionInput[],
  query: string,
): LiveSessionHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: LiveSessionHit[] = [];
  for (const s of sessions) {
    let matched = false;
    for (let i = 0; i < s.messages.length; i++) {
      const msg = s.messages[i];
      if (!msg) continue;
      const text = messageText(msg);
      if (!text) continue;
      const ranges = findRanges(text, needle);
      if (ranges.length === 0) continue;
      hits.push({
        sessionId: s.sessionId,
        title: s.title,
        messageIndex: i,
        ...buildSnippet(text, ranges),
      });
      matched = true;
      break;
    }
    if (!matched && s.title.toLowerCase().includes(needle)) {
      hits.push({
        sessionId: s.sessionId,
        title: s.title,
        messageIndex: -1,
        snippet: s.title,
        ranges: findRanges(s.title, needle),
      });
    }
  }
  return hits;
}

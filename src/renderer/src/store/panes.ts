// Renderer pane model (AGE-801) — the load-bearing prerequisite for AGE-777
// split panes and the drop-target routing in AGE-779.
//
// A pane is an independent center surface: today a chat transcript (optionally
// pinned to one session) or a file editor. Panes are keyed by an opaque
// `paneId` and laid out by a split TREE (`PaneLayout`), so up-to-8 panes can
// nest horizontal/vertical splits without re-modeling later. The default state
// is exactly today's shell: ONE chat pane that follows the global active
// session (`sessionId` unset), so single-pane behavior is unchanged until a
// second pane is opened.
//
// The pane model deliberately holds ONLY ids — never session state. Pane hosts
// subscribe to this store (cold, tiny) while each transcript pane subscribes to
// its own session slice via `useSession(sessionId)` (hot). That keeps the model
// compatible with the hot/cold session-state split (AGE-799): adding a pane
// never widens what any other pane re-renders on.
//
// Ownership decision (encoded here, asserted by tests): the right icon rail and
// its expandable panels are EXPLICITLY GLOBAL app chrome — one `openPanelId`
// for the whole window (see store/shell.ts). Rail destinations (Dashboard,
// Skills, MCP, Terminal, Browser, …) are app-level tools, several backed by
// main-process singletons, so multiplying them per pane would alias one
// backend across panes. Per-pane state stays INSIDE the pane subtree.

import { create } from "zustand";

/** Hard ceiling on simultaneously open panes (AGE-777 ships up to 8). */
export const MAX_PANES = 8;

/** The id of the default, always-present chat pane. */
export const MAIN_PANE_ID = "pane-main";

export type PaneKind = "chat" | "file";

export interface PaneEntry {
  id: string;
  kind: PaneKind;
  /**
   * Chat panes: the session this pane renders. Unset = follow the global
   * active session (the default pane's single-pane behavior). Set = pinned;
   * the pane keeps its session across global active-session switches.
   */
  sessionId?: string;
  /** File panes: the workspace-relative path this pane edits. */
  path?: string;
}

/** A split-tree node: either one pane (leaf) or an ordered split of children. */
export type PaneLayout =
  | { kind: "leaf"; paneId: string }
  | { kind: "split"; direction: "row" | "column"; children: PaneLayout[] };

interface PaneState {
  /** Pane entries keyed by paneId. */
  panes: Record<string, PaneEntry>;
  /** The split tree; leaves reference `panes` keys. */
  layout: PaneLayout;
  /** The pane that owns keyboard focus / receives pane-scoped commands. */
  focusedPaneId: string;

  /**
   * Open a new pane beside `besideId` (or the focused pane), splitting in
   * `direction`. Returns the new paneId, or null when the pane cap is hit.
   */
  openPane(
    entry:
      | { kind: "chat"; sessionId?: string }
      | { kind: "file"; path: string },
    opts?: { besideId?: string; direction?: "row" | "column" },
  ): string | null;
  /** Point a CHAT pane at a session (pin), or unset to follow the active one. */
  setPaneSession(paneId: string, sessionId: string | undefined): void;
  /** Focus a pane (no-op for unknown ids). */
  focusPane(paneId: string): void;
  /**
   * Close a pane and collapse its split. The last remaining pane can never be
   * closed — the shell always shows at least the default chat surface.
   */
  closePane(paneId: string): void;
  /** Reset to the default single-chat-pane layout. */
  reset(): void;
}

function defaultPanes(): Record<string, PaneEntry> {
  return { [MAIN_PANE_ID]: { id: MAIN_PANE_ID, kind: "chat" } };
}

function defaultLayout(): PaneLayout {
  return { kind: "leaf", paneId: MAIN_PANE_ID };
}

let paneSeq = 0;

// Replace the leaf for `besideId` with a split of [beside, newLeaf] in
// `direction`. When the parent split already runs in `direction` the new leaf
// is inserted as a sibling instead of nesting a redundant split.
function insertBeside(
  node: PaneLayout,
  besideId: string,
  newPaneId: string,
  direction: "row" | "column",
): PaneLayout {
  if (node.kind === "leaf") {
    if (node.paneId !== besideId) return node;
    return {
      kind: "split",
      direction,
      children: [node, { kind: "leaf", paneId: newPaneId }],
    };
  }
  const at = node.children.findIndex(
    (c) => c.kind === "leaf" && c.paneId === besideId,
  );
  if (at !== -1 && node.direction === direction) {
    const children = [...node.children];
    children.splice(at + 1, 0, { kind: "leaf", paneId: newPaneId });
    return { ...node, children };
  }
  return {
    ...node,
    children: node.children.map((c) =>
      insertBeside(c, besideId, newPaneId, direction),
    ),
  };
}

// Remove the leaf for `paneId`, collapsing any split left with one child.
function removeLeaf(node: PaneLayout, paneId: string): PaneLayout | null {
  if (node.kind === "leaf") return node.paneId === paneId ? null : node;
  const children = node.children
    .map((c) => removeLeaf(c, paneId))
    .filter((c): c is PaneLayout => c !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0] ?? null;
  return { ...node, children };
}

/** Depth-first pane ids in layout order (stable render order for hosts). */
export function layoutPaneIds(node: PaneLayout): string[] {
  if (node.kind === "leaf") return [node.paneId];
  return node.children.flatMap(layoutPaneIds);
}

export const usePaneStore = create<PaneState>((set, get) => ({
  panes: defaultPanes(),
  layout: defaultLayout(),
  focusedPaneId: MAIN_PANE_ID,

  openPane(entry, opts) {
    const { panes, layout, focusedPaneId } = get();
    // ONE editor surface per path: a second file pane for an already-open
    // path would double-mount CodeMirror over one FileTab buffer (divergent
    // edits, clobbered saves). Focus the existing pane instead. AGE-777's
    // file-opening UX must also close the main pane's strip tab for a path
    // it opens as a pane — the strip and the pane model share FileTab state.
    if (entry.kind === "file") {
      const existing = Object.values(panes).find(
        (p) => p.kind === "file" && p.path === entry.path,
      );
      if (existing) {
        set({ focusedPaneId: existing.id });
        return existing.id;
      }
    }
    if (Object.keys(panes).length >= MAX_PANES) return null;
    const besideId = opts?.besideId ?? focusedPaneId;
    if (!panes[besideId]) return null;
    paneSeq += 1;
    const id = `pane-${paneSeq}`;
    const pane: PaneEntry =
      entry.kind === "chat"
        ? {
            id,
            kind: "chat",
            ...(entry.sessionId && { sessionId: entry.sessionId }),
          }
        : { id, kind: "file", path: entry.path };
    set({
      panes: { ...panes, [id]: pane },
      layout: insertBeside(layout, besideId, id, opts?.direction ?? "row"),
      focusedPaneId: id,
    });
    return id;
  },

  setPaneSession(paneId, sessionId) {
    const pane = get().panes[paneId];
    if (pane?.kind !== "chat") return;
    const next: PaneEntry = { ...pane };
    if (sessionId === undefined) delete next.sessionId;
    else next.sessionId = sessionId;
    set({ panes: { ...get().panes, [paneId]: next } });
  },

  focusPane(paneId) {
    if (get().panes[paneId]) set({ focusedPaneId: paneId });
  },

  closePane(paneId) {
    const { panes, layout, focusedPaneId } = get();
    if (!panes[paneId] || Object.keys(panes).length <= 1) return;
    const nextLayout = removeLeaf(layout, paneId) ?? defaultLayout();
    const nextPanes = { ...panes };
    delete nextPanes[paneId];
    const remaining = layoutPaneIds(nextLayout);
    set({
      panes: nextPanes,
      layout: nextLayout,
      focusedPaneId:
        focusedPaneId === paneId
          ? (remaining[0] ?? MAIN_PANE_ID)
          : focusedPaneId,
    });
  },

  reset() {
    set({
      panes: defaultPanes(),
      layout: defaultLayout(),
      focusedPaneId: MAIN_PANE_ID,
    });
  },
}));

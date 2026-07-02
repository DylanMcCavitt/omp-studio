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

export type PaneKind = "chat" | "file" | "subagent";

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
  /**
   * Subagent panes: the inspected subagent's id. `sessionId` names the parent
   * session that spawned it (always set for subagent panes).
   */
  subagentId?: string;
}

/** A split-tree node: either one pane (leaf) or an ordered split of children. */
export type PaneLayout =
  | { kind: "leaf"; paneId: string }
  | {
      kind: "split";
      splitId: string;
      direction: "row" | "column";
      children: PaneLayout[];
      /** Child panel percentages in the same order as `children`. */
      weights: number[];
    };

/** Where a docked pane lands relative to its target. */
export type PaneEdge = "left" | "right" | "top" | "bottom";

interface PaneState {
  /** Pane entries keyed by paneId. */
  panes: Record<string, PaneEntry>;
  /** The split tree; leaves reference `panes` keys. */
  layout: PaneLayout;
  /** The pane that owns keyboard focus / receives pane-scoped commands. */
  focusedPaneId: string;

  /**
   * Open a new pane beside `besideId` (or the focused pane), splitting in
   * `direction`; `position` places it before or after the target (default
   * after). Returns the new paneId, or null when the pane cap is hit.
   */
  openPane(
    entry:
      | { kind: "chat"; sessionId?: string }
      | { kind: "file"; path: string }
      | { kind: "subagent"; sessionId: string; subagentId: string },
    opts?: {
      besideId?: string;
      direction?: "row" | "column";
      position?: "before" | "after";
    },
  ): string | null;
  /**
   * Swap an existing pane's content in place (same paneId, same layout slot) —
   * e.g. a subagent pane's "Back" showing the parent session's transcript.
   */
  replacePane(
    paneId: string,
    entry:
      | { kind: "chat"; sessionId?: string }
      | { kind: "file"; path: string }
      | { kind: "subagent"; sessionId: string; subagentId: string },
  ): void;
  /** Point a CHAT pane at a session (pin), or unset to follow the active one. */
  setPaneSession(paneId: string, sessionId: string | undefined): void;
  /** Focus a pane (no-op for unknown ids). */
  focusPane(paneId: string): void;
  /**
   * Re-dock an existing pane against `targetId`'s edge (AGE-806): left/right
   * dock beside it in a row split, top/bottom in a column split; left/top land
   * before the target, right/bottom after. The source leaf is removed first
   * (collapsing its old split) and the moved pane takes focus. No-ops on
   * self-drops and unknown ids; content is never lost.
   */
  movePane(paneId: string, targetId: string, edge: PaneEdge): void;
  /**
   * Close a pane and collapse its split. The last remaining pane can never be
   * closed — the shell always shows at least the default chat surface.
   */
  closePane(paneId: string): void;
  /** Persist live child percentages for a split PanelGroup. */
  setSplitWeights(splitId: string, weights: number[]): void;
  /** Restore one split to equal-sized children. */
  resetSplitWeights(splitId: string): void;
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
let splitSeq = 0;

const MIN_EFFECTIVE_PANE_PCT = 10;
const EPSILON = 0.0001;

function nextSplitId(): string {
  splitSeq += 1;
  return `split-${splitSeq}`;
}

function equalWeights(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count);
}

function normalizeWeights(weights: readonly number[], count: number): number[] {
  const cleaned = Array.from({ length: count }, (_, i) => {
    const value = weights[i] ?? 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  });
  const total = cleaned.reduce((sum, value) => sum + value, 0);
  if (total <= EPSILON) return equalWeights(count);
  return cleaned.map((value) => (value / total) * 100);
}

function childWeights(node: Extract<PaneLayout, { kind: "split" }>): number[] {
  return normalizeWeights(node.weights, node.children.length);
}

function splitTargetWeight(
  targetWeight: number,
  preferredNewWeight?: number,
): [number, number] {
  if (
    preferredNewWeight != null &&
    Number.isFinite(preferredNewWeight) &&
    preferredNewWeight > EPSILON &&
    preferredNewWeight < targetWeight - EPSILON
  ) {
    return [targetWeight - preferredNewWeight, preferredNewWeight];
  }
  return [targetWeight / 2, targetWeight / 2];
}

function leafEffectiveShares(node: PaneLayout, parentShare = 100): number[] {
  if (node.kind === "leaf") return [parentShare];
  const weights = childWeights(node);
  return node.children.flatMap((child, i) =>
    leafEffectiveShares(child, (parentShare * (weights[i] ?? 0)) / 100),
  );
}

function meetsEffectiveMinimum(node: PaneLayout): boolean {
  return leafEffectiveShares(node).every(
    (share) => share + EPSILON >= MIN_EFFECTIVE_PANE_PCT,
  );
}

// Replace the leaf for `besideId` with a split of [beside, newLeaf] in
// `direction`. When the parent split already runs in `direction` the new leaf
// is inserted as a sibling instead of nesting a redundant split. `position`
// places the new leaf before or after the target. Only the target leaf's
// allocation is divided; unrelated siblings keep their current weights.
function insertBeside(
  node: PaneLayout,
  besideId: string,
  newPaneId: string,
  direction: "row" | "column",
  position: "before" | "after",
  preferredNewWeight?: number,
): PaneLayout {
  const newLeaf: PaneLayout = { kind: "leaf", paneId: newPaneId };
  if (node.kind === "leaf") {
    if (node.paneId !== besideId) return node;
    const [targetWeight, newWeight] = splitTargetWeight(
      100,
      preferredNewWeight,
    );
    return {
      kind: "split",
      splitId: nextSplitId(),
      direction,
      children: position === "before" ? [newLeaf, node] : [node, newLeaf],
      weights:
        position === "before"
          ? [newWeight, targetWeight]
          : [targetWeight, newWeight],
    };
  }
  const at = node.children.findIndex(
    (c) => c.kind === "leaf" && c.paneId === besideId,
  );
  if (at !== -1 && node.direction === direction) {
    const children = [...node.children];
    const weights = childWeights(node);
    const [targetWeight, newWeight] = splitTargetWeight(
      weights[at] ?? 0,
      preferredNewWeight,
    );
    children.splice(position === "before" ? at : at + 1, 0, newLeaf);
    weights[at] = targetWeight;
    weights.splice(position === "before" ? at : at + 1, 0, newWeight);
    return {
      ...node,
      children,
      weights: normalizeWeights(weights, children.length),
    };
  }
  return {
    ...node,
    weights: childWeights(node),
    children: node.children.map((c) =>
      insertBeside(
        c,
        besideId,
        newPaneId,
        direction,
        position,
        preferredNewWeight,
      ),
    ),
  };
}

interface RemoveResult {
  node: PaneLayout | null;
  removed: boolean;
  removedWeight: number;
}

// Remove the leaf for `paneId`, collapsing any split left with one child.
// When a direct child is removed, its weight is redistributed proportionally to
// the remaining siblings; when a one-child split collapses, the surviving child
// keeps that split's parent allocation.
function removeLeaf(node: PaneLayout, paneId: string): RemoveResult {
  if (node.kind === "leaf") {
    return node.paneId === paneId
      ? { node: null, removed: true, removedWeight: 100 }
      : { node, removed: false, removedWeight: 0 };
  }

  const oldWeights = childWeights(node);
  const children: PaneLayout[] = [];
  const weights: number[] = [];
  let removed = false;
  let removedWeight = 0;
  let directChildRemoved = false;

  node.children.forEach((child, i) => {
    const result = removeLeaf(child, paneId);
    if (!result.removed) {
      children.push(result.node ?? child);
      weights.push(oldWeights[i] ?? 0);
      return;
    }

    removed = true;
    if (result.node) {
      removedWeight = ((oldWeights[i] ?? 0) * result.removedWeight) / 100;
      children.push(result.node);
      weights.push(oldWeights[i] ?? 0);
    } else {
      directChildRemoved = true;
      removedWeight = oldWeights[i] ?? 0;
    }
  });

  if (!removed) return { node, removed: false, removedWeight: 0 };
  if (children.length === 0) {
    return { node: null, removed: true, removedWeight: 100 };
  }
  if (children.length === 1) {
    return { node: children[0] ?? null, removed: true, removedWeight };
  }
  return {
    node: {
      ...node,
      children,
      weights: directChildRemoved
        ? normalizeWeights(weights, children.length)
        : weights,
    },
    removed: true,
    removedWeight,
  };
}

function updateSplitWeights(
  node: PaneLayout,
  splitId: string,
  weights: readonly number[],
): PaneLayout {
  if (node.kind === "leaf") return node;
  if (node.splitId === splitId) {
    return {
      ...node,
      weights: normalizeWeights(weights, node.children.length),
    };
  }
  return {
    ...node,
    weights: childWeights(node),
    children: node.children.map((child) =>
      updateSplitWeights(child, splitId, weights),
    ),
  };
}

function resetSplitWeights(node: PaneLayout, splitId: string): PaneLayout {
  if (node.kind === "leaf") return node;
  if (node.splitId === splitId) {
    return { ...node, weights: equalWeights(node.children.length) };
  }
  return {
    ...node,
    weights: childWeights(node),
    children: node.children.map((child) => resetSplitWeights(child, splitId)),
  };
}
// Equalize the weights of the split that directly contains the leaf `paneId`.
// Boundary fallback for openPane: when dividing only the target's allocation
// would push a pane below the effective minimum, an equalized sibling row is
// preferable to refusing the open (MAX_PANES stays reachable in flat layouts).
function equalizeSplitContaining(node: PaneLayout, paneId: string): PaneLayout {
  if (node.kind === "leaf") return node;
  const hasLeaf = node.children.some(
    (c) => c.kind === "leaf" && c.paneId === paneId,
  );
  if (hasLeaf) {
    return { ...node, weights: equalWeights(node.children.length) };
  }
  return {
    ...node,
    weights: childWeights(node),
    children: node.children.map((child) =>
      equalizeSplitContaining(child, paneId),
    ),
  };
}

function moveDirectSibling(
  node: PaneLayout,
  paneId: string,
  targetId: string,
  direction: "row" | "column",
  position: "before" | "after",
): PaneLayout | null {
  if (node.kind === "leaf") return null;

  const sourceIndex = node.children.findIndex(
    (child) => child.kind === "leaf" && child.paneId === paneId,
  );
  const targetIndex = node.children.findIndex(
    (child) => child.kind === "leaf" && child.paneId === targetId,
  );

  if (sourceIndex !== -1 && targetIndex !== -1) {
    const weights = childWeights(node);
    const source = node.children[sourceIndex] as PaneLayout;
    const target = node.children[targetIndex] as PaneLayout;
    const sourceWeight = weights[sourceIndex] ?? 0;
    const targetWeight = weights[targetIndex] ?? 0;
    const children = [...node.children];
    const nextWeights = [...weights];

    children.splice(sourceIndex, 1);
    nextWeights.splice(sourceIndex, 1);
    const adjustedTargetIndex =
      sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;

    if (node.direction === direction) {
      const insertAt =
        position === "before" ? adjustedTargetIndex : adjustedTargetIndex + 1;
      children.splice(insertAt, 0, source);
      nextWeights.splice(insertAt, 0, sourceWeight);
      return { ...node, children, weights: nextWeights };
    }

    const combinedWeight = sourceWeight + targetWeight;
    const combined: PaneLayout = {
      kind: "split",
      splitId: nextSplitId(),
      direction,
      children: position === "before" ? [source, target] : [target, source],
      weights:
        position === "before"
          ? normalizeWeights([sourceWeight, targetWeight], 2)
          : normalizeWeights([targetWeight, sourceWeight], 2),
    };
    if (children.length === 1) return combined;
    children[adjustedTargetIndex] = combined;
    nextWeights[adjustedTargetIndex] = combinedWeight;
    return {
      ...node,
      children,
      weights: normalizeWeights(nextWeights, children.length),
    };
  }

  let changed = false;
  const children = node.children.map((child) => {
    const moved = moveDirectSibling(
      child,
      paneId,
      targetId,
      direction,
      position,
    );
    if (!moved) return child;
    changed = true;
    return moved;
  });

  return changed ? { ...node, weights: childWeights(node), children } : null;
}

/** Depth-first pane ids in layout order (stable render order for hosts). */
export function layoutPaneIds(node: PaneLayout): string[] {
  if (node.kind === "leaf") return [node.paneId];
  return node.children.flatMap(layoutPaneIds);
}

/** Build a normalized PaneEntry for `openPane`/`replacePane` input. */
function paneEntry(
  id: string,
  entry:
    | { kind: "chat"; sessionId?: string }
    | { kind: "file"; path: string }
    | { kind: "subagent"; sessionId: string; subagentId: string },
): PaneEntry {
  switch (entry.kind) {
    case "chat":
      return {
        id,
        kind: "chat",
        ...(entry.sessionId && { sessionId: entry.sessionId }),
      };
    case "file":
      return { id, kind: "file", path: entry.path };
    case "subagent":
      return {
        id,
        kind: "subagent",
        sessionId: entry.sessionId,
        subagentId: entry.subagentId,
      };
  }
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
    // ONE inspector per subagent: dropping/opening the same subagent again
    // focuses its existing pane instead of stacking duplicate inspectors.
    if (entry.kind === "subagent") {
      const existing = Object.values(panes).find(
        (p) =>
          p.kind === "subagent" &&
          p.sessionId === entry.sessionId &&
          p.subagentId === entry.subagentId,
      );
      if (existing) {
        set({ focusedPaneId: existing.id });
        return existing.id;
      }
    }
    if (Object.keys(panes).length >= MAX_PANES) return null;
    const besideId = opts?.besideId ?? focusedPaneId;
    if (!panes[besideId]) return null;
    const id = `pane-${paneSeq + 1}`;
    let nextLayout = insertBeside(
      layout,
      besideId,
      id,
      opts?.direction ?? "row",
      opts?.position ?? "after",
    );
    if (!meetsEffectiveMinimum(nextLayout)) {
      nextLayout = equalizeSplitContaining(nextLayout, id);
      if (!meetsEffectiveMinimum(nextLayout)) return null;
    }
    paneSeq += 1;
    set({
      panes: { ...panes, [id]: paneEntry(id, entry) },
      layout: nextLayout,
      focusedPaneId: id,
    });
    return id;
  },

  replacePane(paneId, entry) {
    const { panes } = get();
    if (!panes[paneId]) return;
    set({ panes: { ...panes, [paneId]: paneEntry(paneId, entry) } });
  },

  movePane(paneId, targetId, edge) {
    const { panes, layout } = get();
    if (paneId === targetId || !panes[paneId] || !panes[targetId]) return;
    // Detach the source leaf first (collapsing its old split); the target
    // still exists in the remainder because it is a different pane.
    const direction = edge === "left" || edge === "right" ? "row" : "column";
    const position = edge === "left" || edge === "top" ? "before" : "after";
    const directMove = moveDirectSibling(
      layout,
      paneId,
      targetId,
      direction,
      position,
    );
    if (directMove) {
      if (!meetsEffectiveMinimum(directMove)) return;
      set({
        layout: directMove,
        // The moved pane takes focus so pane-scoped commands follow the drag.
        focusedPaneId: paneId,
      });
      return;
    }

    const removed = removeLeaf(layout, paneId);
    if (!removed.node) return; // the only pane cannot move relative to itself
    const nextLayout = insertBeside(
      removed.node,
      targetId,
      paneId,
      direction,
      position,
      removed.removedWeight,
    );
    if (!meetsEffectiveMinimum(nextLayout)) return;
    set({
      layout: nextLayout,
      // The moved pane takes focus so pane-scoped commands follow the drag.
      focusedPaneId: paneId,
    });
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
    const nextLayout = removeLeaf(layout, paneId).node ?? defaultLayout();
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

  setSplitWeights(splitId, weights) {
    const layout = get().layout;
    const nextLayout = updateSplitWeights(layout, splitId, weights);
    if (!meetsEffectiveMinimum(nextLayout)) return;
    set({ layout: nextLayout });
  },

  resetSplitWeights(splitId) {
    const layout = get().layout;
    const nextLayout = resetSplitWeights(layout, splitId);
    if (!meetsEffectiveMinimum(nextLayout)) return;
    set({ layout: nextLayout });
  },

  reset() {
    set({
      panes: defaultPanes(),
      layout: defaultLayout(),
      focusedPaneId: MAIN_PANE_ID,
    });
  },
}));

// AGE-801 — the pane model. Default = one chat pane following the active
// session; opening panes splits the layout tree; closing collapses it; the cap
// holds at MAX_PANES; the last pane can never be closed.

import {
  layoutPaneIds,
  MAIN_PANE_ID,
  MAX_PANES,
  type PaneLayout,
  usePaneStore,
} from "@/store/panes";

beforeEach(() => {
  usePaneStore.getState().reset();
});

type BarePaneLayout =
  | { kind: "leaf"; paneId: string }
  | {
      kind: "split";
      direction: "row" | "column";
      children: BarePaneLayout[];
    };

function topology(node: PaneLayout): BarePaneLayout {
  if (node.kind === "leaf") return node;
  return {
    kind: "split",
    direction: node.direction,
    children: node.children.map(topology),
  };
}

function rootSplit(): Extract<PaneLayout, { kind: "split" }> {
  const layout = usePaneStore.getState().layout;
  expect(layout.kind).toBe("split");
  return layout as Extract<PaneLayout, { kind: "split" }>;
}

function makeRoomFor(targetId: string): void {
  const layout = usePaneStore.getState().layout;
  if (layout.kind !== "split") return;
  const targetIndex = layout.children.findIndex(
    (child) => child.kind === "leaf" && child.paneId === targetId,
  );
  if (targetIndex === -1) return;
  const otherWeight = 80 / (layout.children.length - 1);
  usePaneStore.getState().setSplitWeights(
    layout.splitId,
    layout.children.map((_, i) => (i === targetIndex ? 20 : otherWeight)),
  );
}

function openBalancedChatPane(): string {
  makeRoomFor(MAIN_PANE_ID);
  const id = usePaneStore
    .getState()
    .openPane({ kind: "chat" }, { besideId: MAIN_PANE_ID });
  expect(id).not.toBeNull();
  return id as string;
}

it("defaults to one chat pane that follows the active session", () => {
  const { panes, layout, focusedPaneId } = usePaneStore.getState();
  expect(Object.keys(panes)).toEqual([MAIN_PANE_ID]);
  expect(panes[MAIN_PANE_ID]).toEqual({ id: MAIN_PANE_ID, kind: "chat" });
  expect(layout).toEqual({ kind: "leaf", paneId: MAIN_PANE_ID });
  expect(focusedPaneId).toBe(MAIN_PANE_ID);
});

it("openPane splits beside the focused pane and focuses the new pane", () => {
  const id = usePaneStore
    .getState()
    .openPane({ kind: "chat", sessionId: "s2" });
  expect(id).not.toBeNull();
  const { panes, layout, focusedPaneId } = usePaneStore.getState();
  expect(Object.keys(panes)).toHaveLength(2);
  expect(panes[id!]).toEqual({ id: id!, kind: "chat", sessionId: "s2" });
  expect(focusedPaneId).toBe(id);
  expect(layoutPaneIds(layout)).toEqual([MAIN_PANE_ID, id!]);
});

it("sibling insertion extends an existing split in the same direction (no nesting)", () => {
  const a = usePaneStore.getState().openPane({ kind: "chat" });
  const b = usePaneStore.getState().openPane({ kind: "chat" });
  const layout = usePaneStore.getState().layout;
  // One flat row of three leaves, not a nested split-of-splits.
  expect(layout.kind).toBe("split");
  if (layout.kind === "split") {
    expect(layout.children).toHaveLength(3);
    expect(layout.children.every((c) => c.kind === "leaf")).toBe(true);
  }
  expect(layoutPaneIds(layout)).toEqual([MAIN_PANE_ID, a!, b!]);
});

it("a column split nests inside the row split", () => {
  const a = usePaneStore.getState().openPane({ kind: "chat" });
  const b = usePaneStore
    .getState()
    .openPane({ kind: "chat" }, { besideId: a!, direction: "column" });
  const layout = usePaneStore.getState().layout;
  expect(layout.kind).toBe("split");
  if (layout.kind === "split") {
    expect(layout.direction).toBe("row");
    const nested = layout.children[1];
    expect(nested?.kind).toBe("split");
    if (nested?.kind === "split") {
      expect(nested.direction).toBe("column");
      expect(layoutPaneIds(nested)).toEqual([a!, b!]);
    }
  }
});

it("enforces the MAX_PANES cap", () => {
  for (let i = 1; i < MAX_PANES; i += 1) {
    openBalancedChatPane();
  }
  expect(Object.keys(usePaneStore.getState().panes)).toHaveLength(MAX_PANES);
  expect(usePaneStore.getState().openPane({ kind: "chat" })).toBeNull();
  expect(Object.keys(usePaneStore.getState().panes)).toHaveLength(MAX_PANES);
});

it("closePane removes the pane, collapses the split, and refocuses", () => {
  const id = usePaneStore.getState().openPane({ kind: "chat" });
  usePaneStore.getState().closePane(id!);
  const { panes, layout, focusedPaneId } = usePaneStore.getState();
  expect(Object.keys(panes)).toEqual([MAIN_PANE_ID]);
  expect(layout).toEqual({ kind: "leaf", paneId: MAIN_PANE_ID });
  expect(focusedPaneId).toBe(MAIN_PANE_ID);
});

it("the last remaining pane can never be closed", () => {
  usePaneStore.getState().closePane(MAIN_PANE_ID);
  expect(Object.keys(usePaneStore.getState().panes)).toEqual([MAIN_PANE_ID]);
});

it("setPaneSession pins and unpins a chat pane", () => {
  usePaneStore.getState().setPaneSession(MAIN_PANE_ID, "s9");
  expect(usePaneStore.getState().panes[MAIN_PANE_ID]?.sessionId).toBe("s9");
  usePaneStore.getState().setPaneSession(MAIN_PANE_ID, undefined);
  expect(
    usePaneStore.getState().panes[MAIN_PANE_ID]?.sessionId,
  ).toBeUndefined();
});

it("setPaneSession is a no-op for file panes and unknown panes", () => {
  const fileId = usePaneStore
    .getState()
    .openPane({ kind: "file", path: "a.md" });
  usePaneStore.getState().setPaneSession(fileId!, "s1");
  expect(usePaneStore.getState().panes[fileId!]?.sessionId).toBeUndefined();
  usePaneStore.getState().setPaneSession("ghost", "s1");
});

it("focusPane ignores unknown ids", () => {
  usePaneStore.getState().focusPane("ghost");
  expect(usePaneStore.getState().focusedPaneId).toBe(MAIN_PANE_ID);
});

it("opening a file pane for an already-open path focuses the existing pane", () => {
  const first = usePaneStore
    .getState()
    .openPane({ kind: "file", path: "a.md" });
  usePaneStore.getState().focusPane(MAIN_PANE_ID);
  const second = usePaneStore
    .getState()
    .openPane({ kind: "file", path: "a.md" });
  // Same pane returned, no new pane created, focus moved to it — one editor
  // surface per path (a double CodeMirror mount over one FileTab buffer would
  // diverge edits and clobber saves).
  expect(second).toBe(first);
  expect(Object.keys(usePaneStore.getState().panes)).toHaveLength(2);
  expect(usePaneStore.getState().focusedPaneId).toBe(first);
});

// ---------------------------------------------------------------------------
// AGE-777: subagent panes + replacePane.
// ---------------------------------------------------------------------------

it("opens a subagent pane carrying its session and subagent ids", () => {
  const id = usePaneStore
    .getState()
    .openPane({ kind: "subagent", sessionId: "s1", subagentId: "a1" });
  expect(id).not.toBeNull();
  expect(usePaneStore.getState().panes[id!]).toEqual({
    id,
    kind: "subagent",
    sessionId: "s1",
    subagentId: "a1",
  });
  expect(usePaneStore.getState().focusedPaneId).toBe(id);
});

it("reopening the same subagent focuses its existing pane instead of duplicating", () => {
  const first = usePaneStore
    .getState()
    .openPane({ kind: "subagent", sessionId: "s1", subagentId: "a1" });
  usePaneStore.getState().focusPane(MAIN_PANE_ID);
  const again = usePaneStore
    .getState()
    .openPane({ kind: "subagent", sessionId: "s1", subagentId: "a1" });
  expect(again).toBe(first);
  expect(Object.keys(usePaneStore.getState().panes)).toHaveLength(2);
  expect(usePaneStore.getState().focusedPaneId).toBe(first);
  // A DIFFERENT subagent of the same session still gets its own pane.
  const other = usePaneStore
    .getState()
    .openPane({ kind: "subagent", sessionId: "s1", subagentId: "a2" });
  expect(other).not.toBe(first);
  expect(Object.keys(usePaneStore.getState().panes)).toHaveLength(3);
});

it("the MAX_PANES cap applies to subagent panes", () => {
  for (let i = 1; i < MAX_PANES; i += 1) {
    makeRoomFor(MAIN_PANE_ID);
    const id = usePaneStore
      .getState()
      .openPane(
        { kind: "subagent", sessionId: "s1", subagentId: `a${i}` },
        { besideId: MAIN_PANE_ID },
      );
    expect(id).not.toBeNull();
  }
  expect(
    usePaneStore
      .getState()
      .openPane({ kind: "subagent", sessionId: "s1", subagentId: "overflow" }),
  ).toBeNull();
  expect(Object.keys(usePaneStore.getState().panes)).toHaveLength(MAX_PANES);
});

it("replacePane swaps a pane's content in place, keeping its id and layout slot", () => {
  const id = usePaneStore
    .getState()
    .openPane({ kind: "subagent", sessionId: "s1", subagentId: "a1" });
  const layoutBefore = usePaneStore.getState().layout;
  usePaneStore.getState().replacePane(id!, { kind: "chat", sessionId: "s1" });
  const { panes, layout } = usePaneStore.getState();
  // Same pane id, same layout tree — only the content entry changed (the
  // subagent pane's "Back to chat" swap must never reflow the split).
  expect(panes[id!]).toEqual({ id, kind: "chat", sessionId: "s1" });
  expect(layout).toEqual(layoutBefore);
});

it("replacePane ignores unknown panes", () => {
  usePaneStore.getState().replacePane("ghost", { kind: "chat" });
  expect(usePaneStore.getState().panes.ghost).toBeUndefined();
});

// ---------------------------------------------------------------------------
// AGE-806: movePane re-docking + positional inserts.
// ---------------------------------------------------------------------------

it("movePane docks left/right into a row and top/bottom into a column", () => {
  const b = usePaneStore.getState().openPane({ kind: "chat" });
  // right: [main, b] → drop b on main's LEFT edge → [b, main].
  usePaneStore.getState().movePane(b!, MAIN_PANE_ID, "left");
  expect(topology(usePaneStore.getState().layout)).toEqual({
    kind: "split",
    direction: "row",
    children: [
      { kind: "leaf", paneId: b },
      { kind: "leaf", paneId: MAIN_PANE_ID },
    ],
  });
  // bottom: dock b under main → the row collapses into a column pair.
  usePaneStore.getState().movePane(b!, MAIN_PANE_ID, "bottom");
  expect(topology(usePaneStore.getState().layout)).toEqual({
    kind: "split",
    direction: "column",
    children: [
      { kind: "leaf", paneId: MAIN_PANE_ID },
      { kind: "leaf", paneId: b },
    ],
  });
  // The moved pane takes focus and its content entry is untouched.
  expect(usePaneStore.getState().focusedPaneId).toBe(b);
  expect(usePaneStore.getState().panes[b!]).toEqual({ id: b, kind: "chat" });
});

it("movePane collapses the vacated split and never loses a pane", () => {
  const b = usePaneStore.getState().openPane({ kind: "chat" });
  const c = usePaneStore
    .getState()
    .openPane({ kind: "chat" }, { besideId: b!, direction: "column" });
  // row[main, column[b, c]] → move c onto main's right edge.
  usePaneStore.getState().movePane(c!, MAIN_PANE_ID, "right");
  // The emptied column collapses back to b's leaf; all three panes remain.
  expect(topology(usePaneStore.getState().layout)).toEqual({
    kind: "split",
    direction: "row",
    children: [
      { kind: "leaf", paneId: MAIN_PANE_ID },
      { kind: "leaf", paneId: c },
      { kind: "leaf", paneId: b },
    ],
  });
  expect(layoutPaneIds(usePaneStore.getState().layout).sort()).toEqual(
    [MAIN_PANE_ID, b, c].sort(),
  );
});

it("movePane ignores self-drops, unknown panes, and the only pane", () => {
  const before = usePaneStore.getState().layout;
  usePaneStore.getState().movePane(MAIN_PANE_ID, MAIN_PANE_ID, "left");
  usePaneStore.getState().movePane("ghost", MAIN_PANE_ID, "left");
  usePaneStore.getState().movePane(MAIN_PANE_ID, "ghost", "left");
  expect(usePaneStore.getState().layout).toEqual(before);
});

it("eight panes rearrange into a 2x4 grid by docking onto bottom edges", () => {
  // Open seven extra panes in one row: [main, p1..p7].
  const ids: string[] = [MAIN_PANE_ID];
  for (let i = 1; i < MAX_PANES; i += 1) {
    makeRoomFor(ids[i - 1] as string);
    const id = usePaneStore
      .getState()
      .openPane({ kind: "chat" }, { besideId: ids[i - 1], direction: "row" });
    expect(id).not.toBeNull();
    ids.push(id as string);
  }
  // Dock the back four under the front four: a 2x4 grid of column pairs.
  for (let i = 0; i < 4; i += 1) {
    usePaneStore
      .getState()
      .movePane(ids[i + 4] as string, ids[i] as string, "bottom");
  }
  const layout = usePaneStore.getState().layout;
  expect(layout.kind).toBe("split");
  if (layout.kind === "split") {
    expect(layout.direction).toBe("row");
    expect(layout.children).toHaveLength(4);
    for (let i = 0; i < 4; i += 1) {
      expect(topology(layout.children[i] as PaneLayout)).toEqual({
        kind: "split",
        direction: "column",
        children: [
          { kind: "leaf", paneId: ids[i] },
          { kind: "leaf", paneId: ids[i + 4] },
        ],
      });
    }
  }
  // No pane was lost or duplicated on the way to the grid.
  expect(layoutPaneIds(layout).sort()).toEqual([...ids].sort());
});

it("openPane position:before inserts ahead of the target", () => {
  const b = usePaneStore
    .getState()
    .openPane(
      { kind: "chat" },
      { besideId: MAIN_PANE_ID, direction: "row", position: "before" },
    );
  expect(layoutPaneIds(usePaneStore.getState().layout)).toEqual([
    b,
    MAIN_PANE_ID,
  ]);
});

// ---------------------------------------------------------------------------
// AGE-813: durable split ids + session-local split weights.
// ---------------------------------------------------------------------------

it("split insertion divides only the target allocation", () => {
  const a = usePaneStore.getState().openPane({ kind: "chat" });
  let split = rootSplit();
  usePaneStore.getState().setSplitWeights(split.splitId, [20, 80]);

  const b = usePaneStore
    .getState()
    .openPane({ kind: "chat" }, { besideId: a!, direction: "row" });

  expect(b).not.toBeNull();
  split = rootSplit();
  expect(split.weights).toEqual([20, 40, 40]);
  expect(layoutPaneIds(split)).toEqual([MAIN_PANE_ID, a, b]);
});

it("closePane redistributes the removed child weight proportionally", () => {
  const a = usePaneStore.getState().openPane({ kind: "chat" });
  const b = usePaneStore
    .getState()
    .openPane({ kind: "chat" }, { besideId: MAIN_PANE_ID, direction: "row" });
  const split = rootSplit();
  usePaneStore.getState().setSplitWeights(split.splitId, [20, 30, 50]);

  usePaneStore.getState().closePane(b!);

  expect(rootSplit().weights[0]).toBeCloseTo((20 / 70) * 100);
  expect(rootSplit().weights[1]).toBeCloseTo((50 / 70) * 100);
  expect(layoutPaneIds(usePaneStore.getState().layout)).toEqual([
    MAIN_PANE_ID,
    a,
  ]);
});

it("movePane carries the moved leaf weight when reinserted as a sibling", () => {
  const a = usePaneStore.getState().openPane({ kind: "chat" });
  const b = usePaneStore
    .getState()
    .openPane({ kind: "chat" }, { besideId: MAIN_PANE_ID, direction: "row" });
  const split = rootSplit();
  usePaneStore.getState().setSplitWeights(split.splitId, [20, 30, 50]);

  usePaneStore.getState().movePane(b!, a!, "right");

  expect(rootSplit().weights[2]).toBeCloseTo(30);
  expect(layoutPaneIds(usePaneStore.getState().layout)).toEqual([
    MAIN_PANE_ID,
    a,
    b,
  ]);
});

it("one-child split collapse carries the child's parent weight up", () => {
  const a = usePaneStore.getState().openPane({ kind: "chat" });
  const b = usePaneStore
    .getState()
    .openPane({ kind: "chat" }, { besideId: a!, direction: "column" });
  const root = rootSplit();
  expect(root.children[1]?.kind).toBe("split");
  usePaneStore.getState().setSplitWeights(root.splitId, [40, 60]);
  const nested = root.children[1] as Extract<PaneLayout, { kind: "split" }>;
  usePaneStore.getState().setSplitWeights(nested.splitId, [25, 75]);

  usePaneStore.getState().closePane(a!);

  const nextRoot = rootSplit();
  expect(nextRoot.weights).toEqual([40, 60]);
  expect(layoutPaneIds(nextRoot)).toEqual([MAIN_PANE_ID, b]);
});

it("setSplitWeights normalizes bad input defensively", () => {
  usePaneStore.getState().openPane({ kind: "chat" });
  const split = rootSplit();

  usePaneStore.getState().setSplitWeights(split.splitId, [2, 3]);
  expect(rootSplit().weights).toEqual([40, 60]);

  usePaneStore.getState().setSplitWeights(split.splitId, [Number.NaN, 0]);
  expect(rootSplit().weights).toEqual([50, 50]);
});

it("openPane equalizes the containing split before blocking at the minimum", () => {
  const a = usePaneStore.getState().openPane({ kind: "chat" });
  const split = rootSplit();
  usePaneStore.getState().setSplitWeights(split.splitId, [82, 18]);

  const c = usePaneStore
    .getState()
    .openPane({ kind: "chat" }, { besideId: a!, direction: "row" });

  expect(c).not.toBeNull();
  const weights = rootSplit().weights;
  expect(weights).toHaveLength(3);
  for (const w of weights ?? []) {
    expect(w).toBeCloseTo(100 / 3, 5);
  }
});

it("effective-minimum guard blocks opens even equalizing cannot fit", () => {
  const a = usePaneStore.getState().openPane({ kind: "chat" });
  const b = usePaneStore
    .getState()
    .openPane({ kind: "chat" }, { besideId: a!, direction: "column" });
  const root = rootSplit();
  usePaneStore.getState().setSplitWeights(root.splitId, [80, 20]);
  const nested = rootSplit().children[1] as Extract<
    PaneLayout,
    { kind: "split" }
  >;
  usePaneStore.getState().setSplitWeights(nested.splitId, [50, 50]);
  const before = usePaneStore.getState().layout;

  // Halving b gives 5% effective; equalizing the column of three gives 6.67%.
  const blocked = usePaneStore
    .getState()
    .openPane({ kind: "chat" }, { besideId: b!, direction: "column" });

  expect(blocked).toBeNull();
  expect(usePaneStore.getState().layout).toEqual(before);

  usePaneStore.getState().setSplitWeights(nested.splitId, [95, 5]);
  expect(
    (rootSplit().children[1] as Extract<PaneLayout, { kind: "split" }>).weights,
  ).toEqual([50, 50]);
});

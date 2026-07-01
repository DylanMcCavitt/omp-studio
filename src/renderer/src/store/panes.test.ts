// AGE-801 — the pane model. Default = one chat pane following the active
// session; opening panes splits the layout tree; closing collapses it; the cap
// holds at MAX_PANES; the last pane can never be closed.

import {
  layoutPaneIds,
  MAIN_PANE_ID,
  MAX_PANES,
  usePaneStore,
} from "@/store/panes";

beforeEach(() => {
  usePaneStore.getState().reset();
});

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
    expect(usePaneStore.getState().openPane({ kind: "chat" })).not.toBeNull();
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

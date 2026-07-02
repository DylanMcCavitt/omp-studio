// AGE-806 — the pure drop-edge math behind pane/subagent docking. jsdom's
// synthetic drag events carry no coordinates, so the host tests exercise the
// default path; the quadrant geometry is pinned here directly.

import { dropEdgeFor } from "@/components/shell/pane-actions";

const RECT = { left: 0, top: 0, width: 100, height: 100 };

it("picks the edge by the dominant axis of the pointer offset", () => {
  expect(dropEdgeFor(RECT, 10, 50)).toBe("left");
  expect(dropEdgeFor(RECT, 90, 50)).toBe("right");
  expect(dropEdgeFor(RECT, 50, 10)).toBe("top");
  expect(dropEdgeFor(RECT, 50, 90)).toBe("bottom");
});

it("resolves diagonal hovers to the stronger axis", () => {
  expect(dropEdgeFor(RECT, 5, 30)).toBe("left"); // |dx| 0.45 > |dy| 0.2
  expect(dropEdgeFor(RECT, 60, 95)).toBe("bottom"); // |dy| 0.45 > |dx| 0.1
});

it("handles offset rects", () => {
  const rect = { left: 200, top: 100, width: 100, height: 100 };
  expect(dropEdgeFor(rect, 210, 150)).toBe("left");
  expect(dropEdgeFor(rect, 250, 190)).toBe("bottom");
});

it("defaults to docking beside (right) when coordinates are missing", () => {
  expect(dropEdgeFor(RECT, Number.NaN, Number.NaN)).toBe("right");
  expect(dropEdgeFor(RECT, undefined as unknown as number, 50)).toBe("right");
});

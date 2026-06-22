import { expect, test } from "bun:test";
import {
  projectLabel,
  RECENT_PROJECTS_LIMIT,
  upsertRecentProject,
} from "../src/renderer/src/lib/recent-projects";

test("projectLabel derives the basename and tolerates trailing separators", () => {
  expect(projectLabel("/home/dev/omp-studio")).toBe("omp-studio");
  expect(projectLabel("/home/dev/omp-studio/")).toBe("omp-studio");
  expect(projectLabel("C:\\Users\\dev\\proj")).toBe("proj");
  // A root-ish path with nothing after the separator falls back to the input.
  expect(projectLabel("/")).toBe("/");
});

test("upsertRecentProject inserts a new project at the front", () => {
  const out = upsertRecentProject([], "/a/b/proj", "2026-01-01T00:00:00.000Z");
  expect(out).toEqual([
    { cwd: "/a/b/proj", label: "proj", lastUsedAt: "2026-01-01T00:00:00.000Z" },
  ]);
});

test("upsertRecentProject dedupes by cwd, moves to front, and refreshes lastUsedAt", () => {
  const initial = [
    { cwd: "/p/one", label: "one", lastUsedAt: "2026-01-01T00:00:00.000Z" },
    { cwd: "/p/two", label: "two", lastUsedAt: "2026-01-02T00:00:00.000Z" },
  ];
  const out = upsertRecentProject(
    initial,
    "/p/two",
    "2026-02-01T00:00:00.000Z",
  );
  expect(out.map((p) => p.cwd)).toEqual(["/p/two", "/p/one"]);
  expect(out[0]?.lastUsedAt).toBe("2026-02-01T00:00:00.000Z");
  expect(out).toHaveLength(2);
});

test("upsertRecentProject caps the list at the limit", () => {
  let list = upsertRecentProject([], "/seed", "2026-01-01T00:00:00.000Z");
  for (let i = 0; i < RECENT_PROJECTS_LIMIT + 5; i++) {
    list = upsertRecentProject(
      list,
      `/p/${i}`,
      `2026-01-01T00:00:0${i % 10}.000Z`,
    );
  }
  expect(list).toHaveLength(RECENT_PROJECTS_LIMIT);
  // The most recently inserted project is at the front; the seed has fallen off.
  expect(list[0]?.cwd).toBe(`/p/${RECENT_PROJECTS_LIMIT + 4}`);
  expect(list.some((p) => p.cwd === "/seed")).toBe(false);
});

import { expect, test } from "bun:test";
import { resolveTheme } from "../src/renderer/src/lib/theme";

test("explicit modes ignore the OS preference", () => {
  expect(resolveTheme("dark", false)).toBe("dark");
  expect(resolveTheme("dark", true)).toBe("dark");
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("light", false)).toBe("light");
});

test("system mode follows prefers-color-scheme", () => {
  expect(resolveTheme("system", true)).toBe("dark");
  expect(resolveTheme("system", false)).toBe("light");
});

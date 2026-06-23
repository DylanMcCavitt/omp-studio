import { afterEach, beforeEach, expect, test } from "bun:test";
import { log, scoped } from "../src/main/logger";

// The logger writes through console.log (stdout) / console.error (stderr) and
// reads its threshold from OMP_STUDIO_LOG_LEVEL on every call, so we swap the
// console sinks per test and capture the emitted lines to assert on them.

const real = { log: console.log, error: console.error };
let stdout: string[];
let stderr: string[];

// Drop the timestamp token (no internal spaces) to assert the stable remainder.
const strip = (line: string): string => line.replace(/^\S+ /, "");

beforeEach(() => {
  stdout = [];
  stderr = [];
  console.log = (...args: unknown[]) => void stdout.push(args.join(" "));
  console.error = (...args: unknown[]) => void stderr.push(args.join(" "));
  delete process.env.OMP_STUDIO_LOG_LEVEL;
});

afterEach(() => {
  console.log = real.log;
  console.error = real.error;
  delete process.env.OMP_STUDIO_LOG_LEVEL;
});

test("formats timestamp, level, scope, message, and structured fields", () => {
  process.env.OMP_STUDIO_LOG_LEVEL = "debug";
  scoped("data").warn("disk full", { path: "/tmp/x", code: 28 });

  expect(stderr).toHaveLength(1);
  const line = stderr[0]!;
  expect(line).toMatch(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z WARN \[data\] disk full /,
  );
  expect(line).toContain("path=/tmp/x"); // strings render raw
  expect(line).toContain("code=28"); // non-strings are JSON-encoded
});

test("debug/info go to stdout; warn/error go to stderr", () => {
  process.env.OMP_STUDIO_LOG_LEVEL = "debug";
  const l = scoped("rpc");
  l.debug("d");
  l.info("i");
  l.warn("w");
  l.error("e");

  expect(stdout.map(strip)).toEqual(["DEBUG [rpc] d", "INFO [rpc] i"]);
  expect(stderr.map(strip)).toEqual(["WARN [rpc] w", "ERROR [rpc] e"]);
});

test("filters records below the OMP_STUDIO_LOG_LEVEL threshold", () => {
  process.env.OMP_STUDIO_LOG_LEVEL = "warn";
  const l = scoped("x");
  l.debug("d");
  l.info("i");
  l.warn("w");
  l.error("e");

  expect(stdout).toHaveLength(0); // debug + info are below threshold
  expect(stderr.map(strip)).toEqual(["WARN [x] w", "ERROR [x] e"]);
});

test("an invalid or absent level falls back so info still emits", () => {
  // CI's packaged-app smoke test greps stdout for an info-level line, so the
  // default threshold MUST admit info regardless of a bogus env value.
  process.env.OMP_STUDIO_LOG_LEVEL = "loud";
  log.info("smoke ok");
  expect(stdout).toHaveLength(1);
  expect(stdout[0]).toContain("smoke ok");
});

test("scoped() prefixes the tag and nested scopes chain", () => {
  process.env.OMP_STUDIO_LOG_LEVEL = "debug";
  scoped("github").info("hi");
  expect(strip(stdout[0]!)).toBe("INFO [github] hi");

  stdout.length = 0;
  scoped("a").scoped("b").info("nested");
  expect(strip(stdout[0]!)).toBe("INFO [a] [b] nested");

  stdout.length = 0;
  log.info("plain"); // root logger carries no scope bracket
  expect(strip(stdout[0]!)).toBe("INFO plain");
});

test("never throws on Error or circular fields, or a failing sink", () => {
  process.env.OMP_STUDIO_LOG_LEVEL = "debug";

  scoped("x").error("failed", { error: new Error("kaboom") });
  expect(stderr[0]).toContain("error=kaboom"); // Errors collapse to message

  stderr.length = 0;
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  expect(() => scoped("x").error("boom", { circular })).not.toThrow();
  expect(stderr).toHaveLength(1);

  console.error = () => {
    throw new Error("sink down");
  };
  expect(() => scoped("x").error("still fine")).not.toThrow();
});

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExternalTerminalLaunchers } from "../src/main/terminal/external-launchers";

const tmpRoot = mkdtempSync(join(tmpdir(), "omp-external-terminal-"));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

function detector(paths: string[]) {
  const found = new Set(paths);
  return (path: string) => found.has(path);
}

test("detects macOS app launchers from standard app locations", () => {
  const svc = new ExternalTerminalLaunchers({
    platform: "darwin",
    exists: detector(["/Applications/Ghostty.app"]),
  });

  const ghostty = svc.list().find((item) => item.profile === "ghostty");
  const system = svc.list().find((item) => item.profile === "system");

  expect(ghostty).toEqual({
    profile: "ghostty",
    label: "Ghostty",
    available: true,
    kind: "mac-app",
    detectedPath: "/Applications/Ghostty.app",
  });
  expect(system?.available).toBe(false);
});

test("detects command launchers on PATH", () => {
  const svc = new ExternalTerminalLaunchers({
    platform: "linux",
    envPath: "/opt/bin:/usr/bin",
    exists: detector(["/opt/bin/wezterm"]),
  });

  const wezterm = svc.list().find((item) => item.profile === "wezterm");

  expect(wezterm).toMatchObject({
    profile: "wezterm",
    available: true,
    kind: "command",
    detectedPath: "/opt/bin/wezterm",
  });
});

test("opens a requested macOS app with the workspace directory", () => {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const svc = new ExternalTerminalLaunchers({
    platform: "darwin",
    exists: detector(["/Applications/Ghostty.app"]),
    spawn: (command, args, opts) => {
      calls.push({ command, args, cwd: opts.cwd });
      return { unref() {} };
    },
  });

  const result = svc.open({ cwd: tmpRoot, profile: "ghostty" });

  expect(result).toMatchObject({
    profile: "ghostty",
    label: "Ghostty",
    cwd: tmpRoot,
  });
  expect(calls).toEqual([
    { command: "open", args: ["-a", "Ghostty", tmpRoot], cwd: tmpRoot },
  ]);
});

test("system profile falls back to the first available external terminal", () => {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const svc = new ExternalTerminalLaunchers({
    platform: "linux",
    envPath: "/bin",
    exists: detector(["/bin/kitty"]),
    spawn: (command, args, opts) => {
      calls.push({ command, args, cwd: opts.cwd });
      return { unref() {} };
    },
  });

  const result = svc.open({ cwd: tmpRoot, profile: "system" });

  expect(result.profile).toBe("kitty");
  expect(calls).toEqual([
    { command: "/bin/kitty", args: ["--directory", tmpRoot], cwd: tmpRoot },
  ]);
});

test("rejects unavailable requested profiles and invalid cwd", () => {
  const svc = new ExternalTerminalLaunchers({
    platform: "linux",
    exists: detector([]),
  });

  expect(() => svc.open({ cwd: tmpRoot, profile: "ghostty" })).toThrow(
    /not available: ghostty/,
  );
  expect(() => svc.open({ cwd: join(tmpRoot, "missing") })).toThrow(
    /cwd is not a directory/,
  );
});

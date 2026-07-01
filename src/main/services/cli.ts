import {
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  spawn,
} from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { augmentedEnv } from "../paths";

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface CliOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Kill the child and resolve `code: -1` once stdout exceeds this many bytes. */
  maxBytes?: number;
  /**
   * Spool stdout/stderr through temp files instead of Node streams. This avoids
   * Electron losing trailing output from fast Bun binaries after the first pipe
   * chunk while still using spawn args directly (no shell interpolation).
   */
  spoolOutput?: boolean;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function runCliSpooling(
  bin: string,
  args: string[],
  opts: CliOptions,
  timeoutMs: number,
): Promise<CliResult> {
  return new Promise<CliResult>((resolve) => {
    const dir = mkdtempSync(join(tmpdir(), "omp-studio-cli-"));
    const stdoutPath = join(dir, "stdout");
    const stderrPath = join(dir, "stderr");
    const stdoutFd = openSync(stdoutPath, "w");
    const stderrFd = openSync(stderrPath, "w");
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: CliResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeSync(stdoutFd);
      closeSync(stderrFd);
      rmSync(dir, { recursive: true, force: true });
      resolve(result);
    };

    let child: ChildProcess;
    try {
      child = spawn(bin, args, {
        cwd: opts.cwd,
        env: augmentedEnv(),
        stdio: ["ignore", stdoutFd, stderrFd],
      });
    } catch {
      finish({ stdout: "", stderr: "", code: -1 });
      return;
    }

    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ stdout: "", stderr: "", code: -1 });
    }, timeoutMs);

    child.on("error", () => {
      finish({ stdout: "", stderr: "", code: -1 });
    });
    child.on("close", (code) => {
      if (settled) return;
      const stdoutSize = statSync(stdoutPath).size;
      if (opts.maxBytes !== undefined && stdoutSize > opts.maxBytes) {
        finish({ stdout: "", stderr: "", code: -1 });
        return;
      }

      finish({
        stdout: readFileSync(stdoutPath, "utf8"),
        stderr: readFileSync(stderrPath, "utf8"),
        code: code ?? -1,
      });
    });
  });
}

/**
 * Spawn a CLI process and collect its output. Never throws: a spawn failure or
 * timeout resolves with `code: -1` (the process is killed on timeout).
 */
export async function runCli(
  bin: string,
  args: string[],
  opts: CliOptions = {},
): Promise<CliResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (opts.spoolOutput) return runCliSpooling(bin, args, opts, timeoutMs);
  return new Promise<CliResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let capped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let childClosed = false;
    let stdoutEnded = false;
    let stderrEnded = false;
    let exitCode = -1;

    const finishWhenDrained = (): void => {
      if (!childClosed || !stdoutEnded || !stderrEnded) return;
      finish({ stdout, stderr, code: exitCode });
    };

    const finish = (result: CliResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(bin, args, { cwd: opts.cwd, env: augmentedEnv() });
    } catch {
      finish({ stdout: "", stderr: "", code: -1 });
      return;
    }

    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ stdout, stderr, code: -1 });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (capped) return;
      stdout += chunk.toString();
      if (opts.maxBytes !== undefined && stdout.length > opts.maxBytes) {
        capped = true;
        child.kill("SIGKILL");
        finish({ stdout, stderr, code: -1 });
      }
    });
    child.stdout.on("end", () => {
      stdoutEnded = true;
      finishWhenDrained();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stderr.on("end", () => {
      stderrEnded = true;
      finishWhenDrained();
    });
    child.on("error", () => {
      finish({ stdout, stderr, code: -1 });
    });
    child.on("close", (code) => {
      childClosed = true;
      exitCode = code ?? -1;
      finishWhenDrained();
    });
  });
}

export interface ProbeResult {
  exitCode: number;
  /** Whether the process wrote anything to stdout. The bytes are NOT retained. */
  hasStdout: boolean;
}

/**
 * Count-only credential probe. Spawns `bin` and reports ONLY the exit code and
 * whether stdout produced any bytes. Unlike {@link runCli}, the stdout/stderr
 * bytes are discarded the instant they arrive — never concatenated into a
 * string, stored, returned, or logged — so a secret-bearing command (e.g.
 * `omp token <provider>`) can be checked for existence without ever capturing
 * the token value. A spawn failure or timeout resolves with `exitCode: -1`
 * (the process is killed on timeout).
 */
export async function probeCredential(
  bin: string,
  args: string[],
  opts: CliOptions = {},
): Promise<ProbeResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise<ProbeResult>((resolve) => {
    let hasStdout = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: ProbeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(bin, args, { cwd: opts.cwd, env: augmentedEnv() });
    } catch {
      finish({ exitCode: -1, hasStdout: false });
      return;
    }

    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ exitCode: -1, hasStdout });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      // Count-only: record that output exists, then drop the bytes. The chunk
      // (which may hold the token) is never accumulated into a string.
      if (chunk.length > 0) hasStdout = true;
    });
    // Drain stderr so the pipe never blocks; nothing is inspected or retained.
    child.stderr.on("data", () => {});
    child.on("error", () => {
      finish({ exitCode: -1, hasStdout });
    });
    child.on("close", (code) => {
      finish({ exitCode: code ?? -1, hasStdout });
    });
  });
}

/** Parse CLI JSON output that may include human-readable prelude/trailing text. */
export function parseJsonOutput<T>(stdout: string): T | null {
  for (let index = 0; index < stdout.length; index += 1) {
    const char = stdout[index];
    if (char !== "{" && char !== "[") continue;

    const end = findJsonPayloadEnd(stdout, index);
    if (end === -1) continue;

    try {
      return JSON.parse(stdout.slice(index, end + 1)) as T;
    } catch {
      // Human prelude can contain bracketed warning prefixes such as `[WARN]`.
      // Keep scanning until a real JSON payload parses.
    }
  }
  return null;
}

function findJsonPayloadEnd(stdout: string, start: number): number {
  const opener = stdout[start];
  const closer = opener === "{" ? "}" : "]";
  const stack = [closer];
  let inString = false;
  let escaped = false;

  for (let index = start + 1; index < stdout.length; index += 1) {
    const char = stdout[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      stack.push("}");
    } else if (char === "[") {
      stack.push("]");
    } else if (char === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return index;
    } else if (char === "}" || char === "]") {
      return -1;
    }
  }

  return -1;
}

/**
 * Run a CLI and parse its JSON output. omp prints extension warnings before the
 * JSON payload, so parsing starts at the first `{` or `[`. Returns null on a
 * non-zero exit, missing payload, or invalid JSON.
 */
export async function runJson<T>(
  bin: string,
  args: string[],
  opts?: CliOptions,
): Promise<T | null> {
  const { stdout, code } = await runCli(bin, args, opts);
  if (code !== 0) return null;
  return parseJsonOutput<T>(stdout);
}

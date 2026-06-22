import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { augmentedEnv } from "../paths";

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface CliOptions {
  cwd?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

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
  return new Promise<CliResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

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
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", () => {
      finish({ stdout, stderr, code: -1 });
    });
    child.on("close", (code) => {
      finish({ stdout, stderr, code: code ?? -1 });
    });
  });
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
  const start = stdout.search(/[{[]/);
  if (start < 0) return null;
  try {
    return JSON.parse(stdout.slice(start)) as T;
  } catch {
    return null;
  }
}

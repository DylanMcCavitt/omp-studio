import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MemoryUsageSnapshot } from "@shared/domain";

const execFileAsync = promisify(execFile);

export interface MemoryUsageReaders {
  appRssBytes?: () => number;
  processTreeRssBytes?: (rootPids: number[]) => Promise<number>;
}

/** Sum RSS for OMP rpc-ui roots and every descendant process they spawn. */
export async function getMemoryUsage(
  ompRootPids: number[],
  readers: MemoryUsageReaders = {},
): Promise<MemoryUsageSnapshot> {
  const appBytes = readers.appRssBytes?.() ?? process.memoryUsage().rss;
  const ompBytes = readers.processTreeRssBytes
    ? await readers.processTreeRssBytes(ompRootPids)
    : await sumProcessTreeRss(ompRootPids);
  return {
    totalBytes: appBytes + ompBytes,
    appBytes,
    ompBytes,
    ompInstanceCount: ompRootPids.length,
    generatedAt: new Date().toISOString(),
  };
}

async function sumProcessTreeRss(rootPids: number[]): Promise<number> {
  const unique = new Set<number>();
  for (const rootPid of rootPids) {
    for (const pid of await collectDescendantPids(rootPid)) unique.add(pid);
  }
  let total = 0;
  for (const pid of unique) {
    const rss = await readProcessRss(pid);
    if (rss != null) total += rss;
  }
  return total;
}

async function collectDescendantPids(rootPid: number): Promise<number[]> {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return [];
  const seen = new Set<number>([rootPid]);
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.pop();
    if (pid == null) continue;
    for (const childPid of await listChildPids(pid)) {
      if (seen.has(childPid)) continue;
      seen.add(childPid);
      queue.push(childPid);
    }
  }
  return [...seen];
}

async function listChildPids(parentPid: number): Promise<number[]> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Get-CimInstance Win32_Process -Filter "ParentProcessId=${parentPid}" | Select-Object -ExpandProperty ProcessId`,
        ],
        { encoding: "utf8", timeout: 5_000 },
      );
      return parsePidList(stdout);
    } catch {
      return [];
    }
  }
  try {
    const { stdout } = await execFileAsync("pgrep", ["-P", String(parentPid)], {
      encoding: "utf8",
      timeout: 5_000,
    });
    return parsePidList(stdout);
  } catch {
    return [];
  }
}

function parsePidList(stdout: string): number[] {
  return stdout
    .split(/\s+/)
    .map((part) => Number.parseInt(part, 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function readProcessRss(pid: number): Promise<number | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64`,
        ],
        { encoding: "utf8", timeout: 5_000 },
      );
      const bytes = Number.parseInt(stdout.trim(), 10);
      return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-o", "rss=", "-p", String(pid)],
      { encoding: "utf8", timeout: 5_000 },
    );
    const kb = Number.parseInt(stdout.trim(), 10);
    return Number.isFinite(kb) && kb > 0 ? kb * 1024 : null;
  } catch {
    return null;
  }
}

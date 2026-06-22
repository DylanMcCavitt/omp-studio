import { expect, test } from "bun:test";
import {
  type CliOptions,
  type CliResult,
  type ProbeResult,
  probeCredential,
} from "../src/main/services/cli";
import { detectProviderAuth } from "../src/main/services/config-service";
import type { ModelInfo } from "../src/shared/domain";

// Hermetic unit tests for provider-auth detection. The CLI runner and the
// count-only credential probe are stubbed, so no real `omp` is spawned and no
// real credentials are read. The probe itself is exercised against a real
// child process to prove it never retains the stdout bytes.

function model(provider: string, cost: ModelInfo["cost"]): ModelInfo {
  return {
    provider,
    id: `${provider}-model`,
    selector: `${provider}/model`,
    name: `${provider} model`,
    cost,
  };
}

const paid = (provider: string): ModelInfo =>
  model(provider, { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 });

const free = (provider: string): ModelInfo =>
  model(provider, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/** Stub runner that answers only `omp usage`; token never flows through it. */
function fakeUsage(providers: string[], code = 0) {
  const run = async (_bin: string, args: string[]): Promise<CliResult> => {
    if (args[0] === "usage") {
      const reports = providers.map((provider) => ({ provider }));
      return { stdout: JSON.stringify({ reports }), stderr: "", code };
    }
    return { stdout: "", stderr: "", code: 0 };
  };
  return run;
}

/** Stub count-only probe keyed by provider id, recording its calls. */
function fakeProbe(map: Record<string, ProbeResult>) {
  const calls: Array<{ args: string[]; opts?: CliOptions }> = [];
  const probe = async (
    _bin: string,
    args: string[],
    opts?: CliOptions,
  ): Promise<ProbeResult> => {
    calls.push({ args, opts });
    return map[args[1] ?? ""] ?? { exitCode: 1, hasStdout: false };
  };
  return { probe, calls };
}

test("provider present in `omp usage` is authenticated via usage", async () => {
  const { probe, calls } = fakeProbe({});
  const providers = await detectProviderAuth(
    [paid("anthropic")],
    fakeUsage(["anthropic"]),
    probe,
  );
  const p = providers.find((x) => x.id === "anthropic")!;
  expect(p.authStatus).toBe("authenticated");
  expect(p.authSource).toBe("usage");
  expect(p.authenticated).toBe(true);
  // usage already answered it — no token probe should run.
  expect(calls.length).toBe(0);
});

test("paid provider absent from usage with no credential is unauthenticated", async () => {
  const { probe } = fakeProbe({ openai: { exitCode: 1, hasStdout: false } });
  const providers = await detectProviderAuth(
    [paid("openai")],
    fakeUsage([]),
    probe,
  );
  const p = providers.find((x) => x.id === "openai")!;
  expect(p.authStatus).toBe("unauthenticated");
  expect(p.authSource).toBe("none");
  expect(p.authenticated).toBe(false);
});

test("paid provider with a credential-probe hit is authenticated via token", async () => {
  const { probe, calls } = fakeProbe({
    mistral: { exitCode: 0, hasStdout: true },
  });
  const providers = await detectProviderAuth(
    [paid("mistral")],
    fakeUsage([]),
    probe,
  );
  const p = providers.find((x) => x.id === "mistral")!;
  expect(p.authStatus).toBe("authenticated");
  expect(p.authSource).toBe("token");
  expect(p.authenticated).toBe(true);
  // count-only probe must be time-bounded.
  expect(calls.find((c) => c.args[0] === "token")?.opts?.timeoutMs).toBe(3000);
});

test("free/local provider is not_required and never probed for a token", async () => {
  const { probe, calls } = fakeProbe({});
  const providers = await detectProviderAuth(
    [free("llama.cpp")],
    fakeUsage([]),
    probe,
  );
  const p = providers.find((x) => x.id === "llama.cpp")!;
  expect(p.authStatus).toBe("not_required");
  expect(p.authSource).toBe("local");
  expect(p.authenticated).toBe(false);
  expect(calls.length).toBe(0);
});

test("probe timeout degrades to unknown, not false", async () => {
  // probeCredential reports a timeout / spawn failure / crash as exitCode -1.
  const { probe } = fakeProbe({ cohere: { exitCode: -1, hasStdout: false } });
  const providers = await detectProviderAuth(
    [paid("cohere")],
    fakeUsage([]),
    probe,
  );
  const p = providers.find((x) => x.id === "cohere")!;
  expect(p.authStatus).toBe("unknown");
  expect(p.authSource).toBe("error");
  expect(p.authenticated).toBe(false);
});

// --- The probe path itself (real child process) --------------------------

test("probeCredential reports stdout presence without returning/logging bytes", async () => {
  const SECRET = "sk-PROBE-CANARY-7c1e-DO-NOT-RETAIN";

  const logged: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = methods.map((m) => console[m]);
  for (const m of methods) {
    console[m] = (...args: unknown[]) => {
      logged.push(args.map((a) => String(a)).join(" "));
    };
  }

  let result: ProbeResult;
  try {
    result = await probeCredential("/bin/sh", ["-c", `printf '%s' ${SECRET}`]);
  } finally {
    methods.forEach((m, i) => {
      console[m] = originals[i]!;
    });
  }

  expect(result.exitCode).toBe(0);
  expect(result.hasStdout).toBe(true);
  // Only the exit code + boolean come back — never the token bytes.
  expect(Object.keys(result).sort()).toEqual(["exitCode", "hasStdout"]);
  expect(JSON.stringify(result)).not.toContain(SECRET);
  expect(logged.join("\n")).not.toContain(SECRET);
});

test("probeCredential: clean exit with no stdout => hasStdout false", async () => {
  const result = await probeCredential("/bin/sh", ["-c", "exit 0"]);
  expect(result.exitCode).toBe(0);
  expect(result.hasStdout).toBe(false);
});

test("probeCredential: nonzero exit with no stdout => not authenticated", async () => {
  const result = await probeCredential("/bin/sh", ["-c", "exit 3"]);
  expect(result.exitCode).toBe(3);
  expect(result.hasStdout).toBe(false);
});

test("probeCredential: timeout kills the child and resolves exitCode -1", async () => {
  const result = await probeCredential("/bin/sh", ["-c", "sleep 5"], {
    timeoutMs: 150,
  });
  expect(result.exitCode).toBe(-1);
});

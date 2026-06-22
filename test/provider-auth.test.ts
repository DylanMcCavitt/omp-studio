import { expect, test } from "bun:test";
import type { CliOptions, CliResult } from "../src/main/services/cli";
import { detectProviderAuth } from "../src/main/services/config-service";
import type { ModelInfo, ProviderInfo } from "../src/shared/domain";

// Hermetic unit tests for provider-auth detection. The CLI runner is stubbed,
// so no real `omp` is spawned and no real credentials are read.

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

interface FakeConfig {
  usageProviders?: string[];
  usageCode?: number;
  token?: Record<string, CliResult>;
}

function fakeRunner(cfg: FakeConfig) {
  const calls: Array<{ args: string[]; opts?: CliOptions }> = [];
  const run = async (
    _bin: string,
    args: string[],
    opts?: CliOptions,
  ): Promise<CliResult> => {
    calls.push({ args, opts });
    if (args[0] === "usage") {
      const reports = (cfg.usageProviders ?? []).map((provider) => ({
        provider,
      }));
      return {
        stdout: JSON.stringify({ reports }),
        stderr: "",
        code: cfg.usageCode ?? 0,
      };
    }
    if (args[0] === "token") {
      return cfg.token?.[args[1] ?? ""] ?? { stdout: "", stderr: "", code: 1 };
    }
    return { stdout: "", stderr: "", code: 0 };
  };
  return { run, calls };
}

test("provider present in `omp usage` is authenticated via usage", async () => {
  const { run, calls } = fakeRunner({ usageProviders: ["anthropic"] });
  const providers = await detectProviderAuth([paid("anthropic")], run);
  const p = providers.find((x) => x.id === "anthropic")!;
  expect(p.authStatus).toBe("authenticated");
  expect(p.authSource).toBe("usage");
  expect(p.authenticated).toBe(true);
  // usage already answered it — no token probe should run.
  expect(calls.some((c) => c.args[0] === "token")).toBe(false);
});

test("paid provider absent from usage with no token is unauthenticated", async () => {
  const { run } = fakeRunner({
    usageProviders: [],
    token: { openai: { stdout: "", stderr: "", code: 1 } },
  });
  const providers = await detectProviderAuth([paid("openai")], run);
  const p = providers.find((x) => x.id === "openai")!;
  expect(p.authStatus).toBe("unauthenticated");
  expect(p.authSource).toBe("none");
  expect(p.authenticated).toBe(false);
});

test("paid provider with a token-probe hit is authenticated via token", async () => {
  const { run, calls } = fakeRunner({
    usageProviders: [],
    token: { mistral: { stdout: "present", stderr: "", code: 0 } },
  });
  const providers = await detectProviderAuth([paid("mistral")], run);
  const p = providers.find((x) => x.id === "mistral")!;
  expect(p.authStatus).toBe("authenticated");
  expect(p.authSource).toBe("token");
  expect(p.authenticated).toBe(true);
  // count-only probe must be time-bounded.
  expect(calls.find((c) => c.args[0] === "token")?.opts?.timeoutMs).toBe(3000);
});

test("free/local provider is not_required and never probed for a token", async () => {
  const { run, calls } = fakeRunner({ usageProviders: [] });
  const providers = await detectProviderAuth([free("llama.cpp")], run);
  const p = providers.find((x) => x.id === "llama.cpp")!;
  expect(p.authStatus).toBe("not_required");
  expect(p.authSource).toBe("local");
  expect(p.authenticated).toBe(false);
  expect(calls.some((c) => c.args[0] === "token")).toBe(false);
});

test("token-probe timeout degrades to unknown, not false", async () => {
  const { run } = fakeRunner({
    usageProviders: [],
    // runCli reports a timeout / spawn failure / crash as code -1.
    token: { cohere: { stdout: "", stderr: "", code: -1 } },
  });
  const providers = await detectProviderAuth([paid("cohere")], run);
  const p = providers.find((x) => x.id === "cohere")!;
  expect(p.authStatus).toBe("unknown");
  expect(p.authSource).toBe("error");
  expect(p.authenticated).toBe(false);
});

test("token bytes never appear in returned data or any logged string", async () => {
  const SECRET = "sk-LEAK-CANARY-3f9a2b-DO-NOT-EXPOSE";
  const { run } = fakeRunner({
    usageProviders: [],
    token: { openai: { stdout: SECRET, stderr: SECRET, code: 0 } },
  });

  const logged: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = methods.map((m) => console[m]);
  for (const m of methods) {
    console[m] = (...args: unknown[]) => {
      logged.push(args.map((a) => String(a)).join(" "));
    };
  }

  let providers: ProviderInfo[];
  try {
    providers = await detectProviderAuth([paid("openai")], run);
  } finally {
    methods.forEach((m, i) => {
      console[m] = originals[i]!;
    });
  }

  const p = providers.find((x) => x.id === "openai")!;
  // The credential exists, so the provider is authenticated...
  expect(p.authStatus).toBe("authenticated");
  expect(p.authSource).toBe("token");
  // ...but the token value must never surface in the result or in any log.
  expect(JSON.stringify(providers)).not.toContain(SECRET);
  expect(logged.join("\n")).not.toContain(SECRET);
});

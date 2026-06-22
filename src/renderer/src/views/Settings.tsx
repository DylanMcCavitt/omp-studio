import type { ModelInfo } from "@shared/domain";
import {
  Boxes,
  Cpu,
  ExternalLink,
  FolderTree,
  KeyRound,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useMemo } from "react";
import { Badge, EmptyState, IconButton, Panel, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

const PATHS = [
  { label: "Agent directory", value: "~/.omp/agent" },
  { label: "Sessions", value: "~/.omp/agent/sessions" },
  { label: "MCP config", value: "~/.omp/agent/mcp.json" },
];

export default function Settings() {
  const models = useAsync(() => window.omp.listModels());
  const providers = useAsync(() => window.omp.listProviders());

  const grouped = useMemo(() => {
    const byProvider = new Map<string, ModelInfo[]>();
    for (const model of models.data ?? []) {
      const arr = byProvider.get(model.provider);
      if (arr) arr.push(model);
      else byProvider.set(model.provider, [model]);
    }
    return Array.from(byProvider, ([provider, items]) => ({ provider, items }));
  }, [models.data]);

  const busy = models.loading || providers.loading;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Settings</h1>
          <p className="truncate text-sm text-ink-muted">
            Models, providers, and harness paths
          </p>
        </div>
        <IconButton
          label="Reload"
          onClick={() => {
            models.reload();
            providers.reload();
          }}
        >
          <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
        </IconButton>
      </div>

      <div className="scrollbar min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-accent" />
                Models
                {models.data && (
                  <Badge variant="muted">
                    {formatNumber(models.data.length)}
                  </Badge>
                )}
              </span>
            }
          >
            {models.loading ? (
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            ) : models.error ? (
              <EmptyState
                icon={<TriangleAlert className="h-6 w-6" />}
                title="Failed to load models"
                hint={models.error}
              />
            ) : grouped.length === 0 ? (
              <EmptyState
                icon={<Cpu className="h-6 w-6" />}
                title="No models available"
              />
            ) : (
              <div className="space-y-4">
                {grouped.map((group) => (
                  <div key={group.provider}>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                        {group.provider}
                      </span>
                      <Badge variant="muted">{group.items.length}</Badge>
                    </div>
                    <div className="space-y-0.5">
                      {group.items.map((model) => (
                        <div
                          key={model.selector}
                          className="flex flex-wrap items-center gap-2 py-1"
                        >
                          <span className="flex-1 truncate font-mono text-xs text-ink">
                            {model.name}
                          </span>
                          {model.reasoning && (
                            <Badge variant="accent">reasoning</Badge>
                          )}
                          {typeof model.contextWindow === "number" && (
                            <span className="text-xs text-ink-faint">
                              {formatNumber(model.contextWindow)} ctx
                            </span>
                          )}
                          {model.cost?.input != null && (
                            <span className="text-xs text-ink-faint">
                              ${model.cost.input}/M in
                            </span>
                          )}
                          {model.cost?.output != null && (
                            <span className="text-xs text-ink-faint">
                              ${model.cost.output}/M out
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title={
              <span className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-accent" />
                Providers
              </span>
            }
          >
            {providers.loading ? (
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            ) : providers.error ? (
              <EmptyState
                icon={<TriangleAlert className="h-6 w-6" />}
                title="Failed to load providers"
                hint={providers.error}
              />
            ) : (providers.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon={<KeyRound className="h-6 w-6" />}
                title="No providers configured"
              />
            ) : (
              <div className="space-y-1">
                {providers.data?.map((provider) => (
                  <div
                    key={provider.id}
                    className="flex items-center gap-2 py-1"
                  >
                    <span className="flex-1 truncate text-sm text-ink">
                      {provider.name}
                    </span>
                    <span className="text-xs text-ink-faint">
                      {formatNumber(provider.modelCount)} models
                    </span>
                    <Badge
                      variant={provider.authenticated ? "success" : "muted"}
                    >
                      {provider.authenticated
                        ? "authenticated"
                        : "not authenticated"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title={
              <span className="flex items-center gap-2">
                <FolderTree className="h-4 w-4 text-accent" />
                Paths
              </span>
            }
          >
            <div className="space-y-3">
              {PATHS.map((path) => (
                <div key={path.label} className="flex flex-col gap-0.5">
                  <span className="text-xs text-ink-faint">{path.label}</span>
                  <code className="break-all font-mono text-xs text-ink-muted">
                    {path.value}
                  </code>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title={
              <span className="flex items-center gap-2">
                <Boxes className="h-4 w-4 text-accent" />
                About
              </span>
            }
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink">OMP Studio</span>
                <Badge variant="muted">v0.1.0</Badge>
              </div>
              <p className="text-xs text-ink-muted">
                A desktop companion for the Oh My Pi (omp) coding-agent harness.
              </p>
              <button
                onClick={() =>
                  window.omp.openExternal("https://github.com/can1357/oh-my-pi")
                }
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                oh-my-pi on GitHub
              </button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

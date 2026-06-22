import { Bot, RefreshCw, TriangleAlert } from "lucide-react";
import { Badge, Card, EmptyState, IconButton, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAsync } from "@/lib/useAsync";

export default function Agents() {
  const { data, loading, error, reload } = useAsync(() =>
    window.omp.listAgents(),
  );
  const agents = data ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Agents</h1>
          <p className="truncate text-sm text-ink-muted">
            Task subagents available to the harness
          </p>
        </div>
        <IconButton label="Reload agents" onClick={reload}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </IconButton>
      </div>

      <div className="scrollbar min-h-0 flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        ) : error ? (
          <EmptyState
            icon={<TriangleAlert className="h-6 w-6" />}
            title="Failed to load agents"
            hint={error}
          />
        ) : agents.length === 0 ? (
          <EmptyState
            icon={<Bot className="h-6 w-6" />}
            title="No agents found"
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <Card
                key={`${agent.source}:${agent.name}`}
                className="flex flex-col gap-2 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Bot className="h-4 w-4 shrink-0 text-accent" />
                  <span className="truncate font-mono text-sm text-ink">
                    {agent.name}
                  </span>
                  {agent.readOnly && <Badge variant="warn">read-only</Badge>}
                  <Badge variant="muted" className="ml-auto">
                    {agent.source}
                  </Badge>
                </div>
                {agent.model && (
                  <div>
                    <Badge variant="accent">{agent.model}</Badge>
                  </div>
                )}
                <p className="line-clamp-4 text-xs text-ink-muted">
                  {agent.description}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

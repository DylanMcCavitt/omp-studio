import { Bot, RefreshCw, TriangleAlert } from "lucide-react";
import { Button, Card, EmptyState, IconButton, Spinner } from "@/components/ui";
import { AGENT_DRAG_MIME, serializeAgentDrag } from "@/lib/agentDrag";
import { cn } from "@/lib/cn";
import { useAsync } from "@/lib/useAsync";

function agentMonogram(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

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
          <p className="text-sm text-ink-muted">
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
            action={
              <Button variant="subtle" size="sm" onClick={reload}>
                <RefreshCw className="h-3.5 w-3.5" />
                Try again
              </Button>
            }
          />
        ) : agents.length === 0 ? (
          <EmptyState
            icon={<Bot className="h-6 w-6" />}
            title="No agents found"
            hint="Bundled and discovered subagents appear here. Add them under ~/.omp/agent, then reload."
            action={
              <Button variant="subtle" size="sm" onClick={reload}>
                <RefreshCw className="h-3.5 w-3.5" />
                Reload
              </Button>
            }
          />
        ) : (
          <div
            data-testid="agents-card-grid"
            className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))]"
          >
            {agents.map((agent) => (
              <button
                key={`${agent.source}:${agent.name}`}
                type="button"
                draggable
                aria-label={`Drag ${agent.name} agent into chat`}
                title="Drag into chat composer"
                onDragStart={(event) => {
                  const payload = serializeAgentDrag(agent);
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData(AGENT_DRAG_MIME, payload);
                  event.dataTransfer.setData("text/plain", agent.name);
                }}
                className="cursor-grab text-left active:cursor-grabbing"
              >
                <Card className="flex h-full min-h-44 flex-col overflow-hidden p-0">
                  <div className="flex min-w-0 items-start gap-3 p-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-bg-panel font-mono text-sm font-semibold text-ink">
                      {agentMonogram(agent.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start gap-2">
                        <span className="min-w-0 flex-1 break-words font-mono text-sm font-semibold text-ink [overflow-wrap:anywhere]">
                          {agent.name}
                        </span>
                        {agent.model && (
                          <span
                            className="ml-auto max-w-28 shrink-0 truncate rounded-md border border-border bg-bg-raised px-1.5 py-0.5 font-mono text-[10px] text-ink-muted"
                            title={agent.model}
                          >
                            {agent.model}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 line-clamp-3 text-xs leading-5 text-ink-muted">
                        {agent.description}
                      </p>
                    </div>
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-dashed border-border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-faint" />
                      <span className="min-w-0 truncate" title={agent.source}>
                        {agent.source}
                      </span>
                    </span>
                    {agent.readOnly && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full border border-ink-faint" />
                        read-only
                      </span>
                    )}
                  </div>
                </Card>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

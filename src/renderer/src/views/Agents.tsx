import { Bot, RefreshCw, TriangleAlert } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Spinner,
} from "@/components/ui";
import { AGENT_DRAG_MIME, serializeAgentDrag } from "@/lib/agentDrag";
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                <Card className="flex h-full flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Bot className="h-4 w-4 shrink-0 text-accent" />
                    <span className="break-words font-mono text-sm text-ink">
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
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

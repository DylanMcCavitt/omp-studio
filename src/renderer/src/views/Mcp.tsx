import { Plug, RefreshCw, TriangleAlert } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Spinner,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

export default function Mcp() {
  const { data, loading, error, reload } = useAsync(() =>
    window.omp.listMcpServers(),
  );
  const servers = data ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">MCP Servers</h1>
          <p className="text-sm text-ink-muted">
            Configured in{" "}
            <code className="font-mono text-ink-muted">
              ~/.omp/agent/mcp.json
            </code>
          </p>
        </div>
        <IconButton label="Reload MCP servers" onClick={reload}>
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
            title="Failed to load MCP servers"
            hint={error}
            action={
              <Button variant="subtle" size="sm" onClick={reload}>
                <RefreshCw className="h-3.5 w-3.5" />
                Try again
              </Button>
            }
          />
        ) : servers.length === 0 ? (
          <EmptyState
            icon={<Plug className="h-6 w-6" />}
            title="No MCP servers configured"
            hint="Add servers to ~/.omp/agent/mcp.json, then reload to see them here."
            action={
              <Button variant="subtle" size="sm" onClick={reload}>
                <RefreshCw className="h-3.5 w-3.5" />
                Reload
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
            {servers.map((server) => {
              const target =
                server.url ??
                [server.command, ...(server.args ?? [])]
                  .filter(Boolean)
                  .join(" ");
              return (
                <Card
                  key={`${server.source}:${server.name}`}
                  className="flex flex-col gap-2 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        server.enabled ? "bg-success" : "bg-ink-faint",
                      )}
                      title={server.enabled ? "enabled" : "disabled"}
                    />
                    <span className="break-words font-mono text-sm text-ink [overflow-wrap:anywhere]">
                      {server.name}
                    </span>
                    <Badge variant="accent">{server.type}</Badge>
                    {server.authType && (
                      <Badge variant="warn">{server.authType}</Badge>
                    )}
                    <Badge variant="muted" className="ml-auto max-w-full truncate"
                    title={server.source}>
                      {server.source}
                    </Badge>
                  </div>
                  {target && (
                    <code className="break-words font-mono text-xs text-ink-muted [overflow-wrap:anywhere]">
                      {target}
                    </code>
                  )}
                  {typeof server.toolCount === "number" && (
                    <span className="text-xs text-ink-muted">
                      {formatNumber(server.toolCount)} tools
                    </span>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Roster of subagents spawned by the active session: label, agent-type badge
// and a status badge tinted by the reported status string.

import type { SubagentInfo } from "@shared/rpc";
import { Bot, Users } from "lucide-react";
import { Badge, EmptyState, Panel } from "@/components/ui";
import { useActiveSession } from "@/store/chat";

const EMPTY_SUBAGENTS: SubagentInfo[] = [];

export function SubagentTree() {
  const subagents = useActiveSession((s) => s?.subagents ?? EMPTY_SUBAGENTS);

  return (
    <Panel title="Subagents">
      {subagents.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="No subagents"
          hint="Spawned agents appear here."
        />
      ) : (
        <ul className="space-y-2">
          {subagents.map((sub) => {
            const status = sub.status ?? "";
            const variant = /error|fail/i.test(status)
              ? "danger"
              : /run|stream|active/i.test(status)
                ? "accent"
                : /done|complete|exit/i.test(status)
                  ? "success"
                  : "muted";
            return (
              <li
                key={sub.id}
                className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-raised px-2.5 py-1.5"
              >
                <Bot className="h-4 w-4 shrink-0 text-ink-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">
                    {sub.label ?? sub.id}
                  </div>
                  {sub.agentType && (
                    <Badge variant="muted" className="mt-0.5">
                      {sub.agentType}
                    </Badge>
                  )}
                </div>
                {status && <Badge variant={variant}>{status}</Badge>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

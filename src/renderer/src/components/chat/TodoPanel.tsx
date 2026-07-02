// The agent's current plan: phases with status-iconed tasks. Completed and
// dropped tasks are struck through.

import type { TodoPhase, TodoStatus } from "@shared/rpc";
import { CheckCircle2, Circle, ListTodo, Loader, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState, Panel } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useActiveSession } from "@/store/chat";

function TodoIcon({ status }: { status: TodoStatus }) {
  if (status === "completed") {
    return (
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
    );
  }
  if (status === "in_progress") {
    return (
      <Loader className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
    );
  }
  if (status === "dropped") {
    return <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />;
  }
  return <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />;
}

const EMPTY_TODOS: TodoPhase[] = [];

export function TodoPanel({
  headerLeading,
  dense,
}: {
  headerLeading?: ReactNode;
  dense?: boolean;
} = {}) {
  const phases = useActiveSession((s) => s?.todoPhases ?? EMPTY_TODOS);
  const hasTasks = phases.some((p) => p.tasks.length > 0);

  return (
    <Panel
      title="Plan"
      collapsible
      persistKey="chat.rail.todos"
      dense={dense}
      headerLeading={headerLeading}
    >
      {!hasTasks ? (
        <EmptyState
          icon={<ListTodo className="h-5 w-5" />}
          title="No todos"
          hint="Tasks appear as the agent plans."
        />
      ) : (
        <div className="space-y-3">
          {phases.map((phase) => (
            <div key={phase.id}>
              <div className="mb-1 min-w-0 truncate text-[0.7rem] font-medium uppercase tracking-wide text-ink-faint"
                title={phase.name}>
                {phase.name}
              </div>
              <ul className="space-y-1">
                {phase.tasks.map((task) => (
                  <li key={task.id} className="flex items-start gap-2 text-sm">
                    <TodoIcon status={task.status} />
                    <span
                      className={cn(
                        "min-w-0 flex-1 break-words text-ink-muted [overflow-wrap:anywhere]",
                        (task.status === "completed" ||
                          task.status === "dropped") &&
                          "text-ink-faint line-through",
                      )}
                    >
                      {task.content}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// The agent's current plan: phases with status-iconed tasks. Completed and
// dropped tasks are struck through.

import type { TodoStatus } from "@shared/rpc";
import { CheckCircle2, Circle, ListTodo, Loader, XCircle } from "lucide-react";
import { EmptyState, Panel } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useChatStore } from "@/store/chat";

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

export function TodoPanel() {
  const phases = useChatStore((s) => s.todoPhases);
  const hasTasks = phases.some((p) => p.tasks.length > 0);

  return (
    <Panel title="Plan">
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
              <div className="mb-1 text-[0.7rem] font-medium uppercase tracking-wide text-ink-faint">
                {phase.name}
              </div>
              <ul className="space-y-1">
                {phase.tasks.map((task) => (
                  <li key={task.id} className="flex items-start gap-2 text-sm">
                    <TodoIcon status={task.status} />
                    <span
                      className={cn(
                        "text-ink-muted",
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

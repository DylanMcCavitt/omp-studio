import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-10 text-center",
        className,
      )}
    >
      {icon && <div className="text-ink-faint">{icon}</div>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint != null && hint !== "" && (
        <p className="max-w-sm text-xs text-ink-muted">{hint}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

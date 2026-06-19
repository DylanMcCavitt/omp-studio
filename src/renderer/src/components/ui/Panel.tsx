import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PanelProps {
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

export function Panel({
  title,
  actions,
  className,
  bodyClassName,
  children,
}: PanelProps) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col rounded-xl border border-border bg-bg-panel shadow-panel",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          {title ? (
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
          ) : (
            <span />
          )}
          {actions && (
            <div className="flex items-center gap-1.5">{actions}</div>
          )}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", bodyClassName ?? "p-4")}>
        {children}
      </div>
    </section>
  );
}

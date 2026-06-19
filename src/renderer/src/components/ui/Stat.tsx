import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface StatProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: boolean;
}

export function Stat({ label, value, hint, icon, accent }: StatProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border p-4 shadow-panel transition-colors",
        accent
          ? "border-accent/40 bg-accent-soft"
          : "border-border bg-bg-panel hover:border-border-strong",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
          {label}
        </span>
        {icon && (
          <span className={cn(accent ? "text-accent" : "text-ink-muted")}>
            {icon}
          </span>
        )}
      </div>
      <span className="text-2xl font-semibold leading-tight text-ink">
        {value}
      </span>
      {hint != null && hint !== "" && (
        <span className="text-xs text-ink-muted">{hint}</span>
      )}
    </div>
  );
}

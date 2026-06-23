import { ChevronRight } from "lucide-react";
import { type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";
import { useCollapsePref } from "./useCollapsePref";

export interface PanelProps {
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
  /** Render the header as a disclosure toggle that hides the body. */
  collapsible?: boolean;
  /** Initial collapsed state when nothing is persisted (collapsible only). */
  defaultCollapsed?: boolean;
  /** Persist the collapsed state under `settings.ui.collapsed[persistKey]`. */
  persistKey?: string;
}

export function Panel({
  title,
  actions,
  className,
  bodyClassName,
  children,
  collapsible = false,
  defaultCollapsed = false,
  persistKey,
}: PanelProps) {
  const [collapsed, setCollapsed] = useCollapsePref(
    collapsible ? persistKey : undefined,
    defaultCollapsed,
  );
  const open = collapsible ? !collapsed : true;
  const bodyId = useId();

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col rounded-xl border border-border bg-bg-panel shadow-panel",
        className,
      )}
    >
      {(title || actions || collapsible) && (
        <header
          className={cn(
            "flex items-center justify-between gap-3 px-4 py-3",
            open && "border-b border-border-subtle",
          )}
        >
          {collapsible ? (
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              aria-expanded={open}
              aria-controls={bodyId}
              className="-ml-1 flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <ChevronRight
                className={cn(
                  "h-4 w-4 shrink-0 text-ink-faint transition-transform",
                  open && "rotate-90",
                )}
              />
              {title ? (
                <h2 className="truncate text-sm font-semibold text-ink">
                  {title}
                </h2>
              ) : (
                <span />
              )}
            </button>
          ) : title ? (
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
          ) : (
            <span />
          )}
          {actions && (
            <div className="flex items-center gap-1.5">{actions}</div>
          )}
        </header>
      )}
      {open && (
        <div
          id={collapsible ? bodyId : undefined}
          className={cn("min-h-0 flex-1", bodyClassName ?? "p-4")}
        >
          {children}
        </div>
      )}
    </section>
  );
}

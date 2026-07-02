import { ChevronRight } from "lucide-react";
import { type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";
import { useCollapsePref } from "./useCollapsePref";

export interface PanelProps {
  title?: ReactNode;
  actions?: ReactNode;
  /**
   * Node pinned to the very start of the header, before the collapse chevron /
   * title (e.g. a drag handle for a reorderable rail panel). Renders the header
   * even when there's no title/actions.
   */
  headerLeading?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
  /** Render the header as a disclosure toggle that hides the body. */
  collapsible?: boolean;
  /** Initial collapsed state when nothing is persisted (collapsible only). */
  defaultCollapsed?: boolean;
  /** Persist the collapsed state under `settings.ui.collapsed[persistKey]`. */
  persistKey?: string;
  /**
   * Compact, flat presentation for tight contexts (e.g. the sidebar panel dock):
   * drops the card chrome (border/background/shadow/rounding) and shrinks the
   * header + default body padding so panels read as glanceable widgets rather
   * than nested cards. The host supplies separation (dividers/border).
   */
  dense?: boolean;
}

export function Panel({
  title,
  actions,
  headerLeading,
  className,
  bodyClassName,
  children,
  collapsible = false,
  defaultCollapsed = false,
  persistKey,
  dense = false,
}: PanelProps) {
  const [collapsed, setCollapsed] = useCollapsePref(
    collapsible ? persistKey : undefined,
    defaultCollapsed,
  );
  const open = collapsible ? !collapsed : true;
  const bodyId = useId();
  const titleCls = dense
    ? "min-w-0 truncate text-xs font-semibold text-ink-muted"
    : "min-w-0 truncate text-sm font-semibold text-ink";

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col",
        !dense && "rounded-xl border border-border bg-bg-panel shadow-panel",
        className,
      )}
    >
      {(title || actions || collapsible || headerLeading) && (
        <header
          className={cn(
            "flex items-center justify-between gap-3",
            dense ? "px-3 py-2" : "px-4 py-3",
            open && "border-b border-border-subtle",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {headerLeading}
            {collapsible ? (
              <button
                type="button"
                onClick={() => setCollapsed(!collapsed)}
                aria-expanded={open}
                aria-controls={bodyId}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <ChevronRight
                  className={cn(
                    "shrink-0 text-ink-faint transition-transform",
                    dense ? "h-3.5 w-3.5" : "h-4 w-4",
                    open && "rotate-90",
                  )}
                />
                {title && <h2 className={titleCls}>{title}</h2>}
              </button>
            ) : (
              title && <h2 className={titleCls}>{title}</h2>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-1.5">{actions}</div>
          )}
        </header>
      )}
      {open && (
        <div
          id={collapsible ? bodyId : undefined}
          className={cn(
            "min-h-0 flex-1",
            bodyClassName ?? (dense ? "p-3" : "p-4"),
          )}
        >
          {children}
        </div>
      )}
    </section>
  );
}

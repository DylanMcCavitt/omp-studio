// Disclosure section: a chevron header that toggles an animated body. The
// sanctioned replacement for the hand-rolled `<details>`/chevron blocks across
// the app. `persistKey` mirrors the open state into `settings.ui.collapsed` via
// `useCollapsePref`; without one it is component-local. a11y: the header is a
// real button with `aria-expanded` + `aria-controls` pointing at the body.

import { ChevronRight } from "lucide-react";
import { type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";
import { useCollapsePref } from "./useCollapsePref";

export interface CollapsibleProps {
  title: ReactNode;
  /** Controls rendered to the right of the header (outside the toggle button). */
  actions?: ReactNode;
  /** Initial open state when nothing is persisted. Defaults to open. */
  defaultOpen?: boolean;
  /** Persist the open state under `settings.ui.collapsed[persistKey]`. */
  persistKey?: string;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

export function Collapsible({
  title,
  actions,
  defaultOpen = true,
  persistKey,
  className,
  bodyClassName,
  children,
}: CollapsibleProps) {
  // The persisted unit is "collapsed"; map the friendlier `defaultOpen` onto it.
  const [collapsed, setCollapsed] = useCollapsePref(persistKey, !defaultOpen);
  const open = !collapsed;
  const bodyId = useId();

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-1 text-left text-sm font-medium text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 text-ink-faint transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0 flex-1 truncate">{title}</span>
        </button>
        {actions && (
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        )}
      </div>
      {open && (
        <div
          id={bodyId}
          className={cn("animate-fade-in", bodyClassName ?? "pt-1")}
        >
          {children}
        </div>
      )}
    </div>
  );
}

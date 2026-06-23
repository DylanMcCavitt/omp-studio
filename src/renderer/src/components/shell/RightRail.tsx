// The thin fixed icon rail pinned to the far right of the shell (AGE-630). Lists
// every railable destination (NAV_ENTRIES minus the primary `chat` surface);
// clicking an icon toggles its expandable docked panel open/closed via the shell
// store. The active panel's icon is highlighted. This strip is always visible —
// the panel itself is mounted by `Layout` as a resizable panel beside `main`.

import { cn } from "@/lib/cn";
import { RAIL_ENTRIES } from "@/lib/nav-registry";
import { useShellStore } from "@/store/shell";

export function RightRail() {
  const openPanelId = useShellStore((s) => s.openPanelId);
  const togglePanel = useShellStore((s) => s.togglePanel);

  const renderItem = (entry: (typeof RAIL_ENTRIES)[number]) => {
    const { icon: Icon, label, route } = entry;
    const active = openPanelId === route;
    return (
      <button
        key={route}
        type="button"
        onClick={() => togglePanel(route)}
        aria-label={label}
        title={label}
        aria-pressed={active}
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          active
            ? "bg-accent-soft text-accent"
            : "text-ink-muted hover:bg-bg-hover hover:text-ink",
        )}
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-[-6px] h-5 w-0.5 rounded-r-full bg-accent"
          />
        )}
        <Icon size={16} className="shrink-0" />
      </button>
    );
  };

  // Settings is pinned to the bottom of the rail; everything else stacks at the
  // top, separated by a flexible spacer.
  const primary = RAIL_ENTRIES.filter((e) => e.route !== "settings");
  const footer = RAIL_ENTRIES.filter((e) => e.route === "settings");

  return (
    <nav
      aria-label="Tools"
      className="no-drag flex h-full w-12 shrink-0 flex-col items-center gap-1 border-l border-border bg-bg-raised py-2"
    >
      {primary.map(renderItem)}
      <div className="flex-1" />
      {footer.map(renderItem)}
    </nav>
  );
}

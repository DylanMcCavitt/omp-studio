import { Eye, EyeOff, GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { useDragReorder } from "@/components/layout/useDragReorder";
import { IconButton } from "@/components/ui";
import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";
import { cn } from "@/lib/cn";
import { reorder, resolveNav } from "@/lib/layout";
import { NAV_ENTRIES, type NavEntry } from "@/lib/nav-registry";
import { type Route, useAppStore } from "@/store/app";
import { useChatStore } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";

export function Sidebar() {
  const route = useAppStore((s) => s.route);
  const setRoute = useAppStore((s) => s.setRoute);
  const newChat = useChatStore((s) => s.newChat);
  const navOrder = useSettingsStore((s) => s.settings?.layout?.navOrder);
  const navHidden = useSettingsStore((s) => s.settings?.layout?.navHidden);
  const setLayout = useSettingsStore((s) => s.setLayout);

  const { visible, hidden, orderedRoutes } = resolveNav(
    NAV_ENTRIES,
    navOrder,
    navHidden,
  );

  const dnd = useDragReorder((from, to) => {
    const fromRoute = visible[from]?.route;
    const toRoute = visible[to]?.route;
    if (!fromRoute || !toRoute) return;
    setLayout({
      navOrder: reorder(
        orderedRoutes,
        orderedRoutes.indexOf(fromRoute),
        orderedRoutes.indexOf(toRoute),
      ),
    });
  });

  const hide = (target: Route) =>
    setLayout({ navHidden: [...(navHidden ?? []), target] });
  const show = (target: Route) =>
    setLayout({ navHidden: (navHidden ?? []).filter((r) => r !== target) });

  return (
    <nav className="no-drag flex h-full w-full min-w-0 flex-col border-r border-border bg-bg-raised">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-bold text-bg shadow-glow">
          ω
        </div>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold text-ink">
            OMP Studio
          </span>
          <span className="truncate text-xs text-ink-faint">
            Oh My Pi cockpit
          </span>
        </div>
      </div>

      <div className="px-3 pb-3">
        <WorkspaceSwitcher />
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={newChat}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg transition-colors",
            "hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          )}
        >
          <Plus size={16} />
          New chat
        </button>
      </div>

      <div className="scrollbar flex-1 overflow-y-auto px-2 py-2">
        <ul className="flex flex-col gap-0.5">
          {visible.map((entry, index) => (
            <li
              key={entry.route}
              {...dnd.zoneProps(index)}
              className={cn(
                "rounded-lg",
                dnd.overIndex === index &&
                  dnd.dragIndex !== index &&
                  "ring-2 ring-accent/40",
              )}
            >
              <NavRow
                entry={entry}
                active={route === entry.route}
                dragging={dnd.dragIndex === index}
                onSelect={() => setRoute(entry.route)}
                onHide={() => hide(entry.route)}
                handleProps={dnd.handleProps(index)}
              />
            </li>
          ))}
        </ul>

        {hidden.length > 0 && (
          <NavOverflow
            hidden={hidden}
            activeRoute={route}
            onSelect={setRoute}
            onShow={show}
          />
        )}
      </div>

      <div className="border-t border-border-subtle px-4 py-3">
        <span className="text-xs text-ink-faint">omp harness</span>
      </div>
    </nav>
  );
}

function NavRow({
  entry,
  active,
  dragging,
  onSelect,
  onHide,
  handleProps,
}: {
  entry: NavEntry;
  active: boolean;
  dragging: boolean;
  onSelect: () => void;
  onHide: () => void;
  handleProps: React.ComponentProps<"button">;
}) {
  const { icon: Icon, label } = entry;
  return (
    <div
      className={cn(
        "group/nav flex items-center rounded-lg transition-colors",
        dragging && "opacity-50",
        active ? "bg-accent-soft" : "hover:bg-bg-hover",
      )}
    >
      <button
        type="button"
        {...handleProps}
        aria-label={`Reorder ${label}`}
        title="Drag to reorder"
        className="flex h-9 w-5 shrink-0 cursor-grab items-center justify-center text-ink-faint opacity-0 focus-visible:opacity-100 group-hover/nav:opacity-100"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-1 text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          active ? "text-accent" : "text-ink-muted group-hover/nav:text-ink",
        )}
      >
        <Icon size={17} className="shrink-0" />
        <span className="truncate">{label}</span>
      </button>
      <IconButton
        label={`Hide ${label}`}
        onClick={onHide}
        className="mr-1 h-7 w-7 opacity-0 focus-visible:opacity-100 group-hover/nav:opacity-100"
      >
        <EyeOff className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
}

function NavOverflow({
  hidden,
  activeRoute,
  onSelect,
  onShow,
}: {
  hidden: NavEntry[];
  activeRoute: Route;
  onSelect: (route: Route) => void;
  onShow: (route: Route) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 border-t border-border-subtle pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-ink-faint transition-colors hover:bg-bg-hover hover:text-ink-muted"
      >
        <MoreHorizontal className="h-4 w-4 shrink-0" />
        {open ? "Hide overflow" : `More (${hidden.length})`}
      </button>
      {open && (
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {hidden.map((entry) => {
            const { icon: Icon, label } = entry;
            return (
              <li
                key={entry.route}
                className="group/hidden flex items-center rounded-lg hover:bg-bg-hover"
              >
                <button
                  type="button"
                  onClick={() => onSelect(entry.route)}
                  aria-current={
                    entry.route === activeRoute ? "page" : undefined
                  }
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2.5 px-3 py-1.5 text-sm transition-colors",
                    entry.route === activeRoute
                      ? "text-accent"
                      : "text-ink-faint group-hover/hidden:text-ink-muted",
                  )}
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
                <IconButton
                  label={`Show ${label}`}
                  onClick={() => onShow(entry.route)}
                  className="mr-1 h-7 w-7 opacity-0 focus-visible:opacity-100 group-hover/hidden:opacity-100"
                >
                  <Eye className="h-3.5 w-3.5" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

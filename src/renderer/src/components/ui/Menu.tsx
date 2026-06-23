// Actions menu built on Popover: a `role="menu"` list with roving tabindex
// (arrows/Home/End move focus, exactly one item is tabbable) and MenuItem /
// MenuSeparator children. Selecting an item runs its handler then closes the
// menu and returns focus to the trigger (via Popover's `close`). The sanctioned
// replacement for hand-rolled action dropdowns.

import {
  type ButtonHTMLAttributes,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { cn } from "@/lib/cn";
import { Popover, type PopoverRenderProps } from "./Popover";

interface MenuContextValue {
  close: () => void;
}
const MenuContext = createContext<MenuContextValue | null>(null);

export interface MenuProps {
  /** Render the trigger; spread `triggerRef` + wire `toggle` onto a button. */
  trigger: (props: PopoverRenderProps) => ReactNode;
  /** MenuItem / MenuSeparator children. */
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
  "aria-label"?: string;
}

export function Menu({
  trigger,
  children,
  align,
  className,
  "aria-label": ariaLabel,
}: MenuProps) {
  return (
    <Popover
      trigger={trigger}
      align={align}
      contentClassName={cn("min-w-[11rem] p-1", className)}
    >
      {({ close }) => (
        <MenuContext.Provider value={{ close }}>
          <MenuList ariaLabel={ariaLabel}>{children}</MenuList>
        </MenuContext.Provider>
      )}
    </Popover>
  );
}

function MenuList({
  children,
  ariaLabel,
}: {
  children: ReactNode;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const items = useCallback(
    () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]:not([disabled])',
        ) ?? [],
      ),
    [],
  );

  // On open, make the first item the single tabbable one and focus it.
  useEffect(() => {
    const list = items();
    list.forEach((el, i) => {
      el.tabIndex = i === 0 ? 0 : -1;
    });
    list[0]?.focus();
  }, [items]);

  const focusItem = (el: HTMLButtonElement | undefined) => {
    if (!el) return;
    for (const item of items()) item.tabIndex = item === el ? 0 : -1;
    el.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = items();
    if (list.length === 0) return;
    const idx = list.indexOf(document.activeElement as HTMLButtonElement);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusItem(list[idx < 0 || idx === list.length - 1 ? 0 : idx + 1]);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusItem(list[idx <= 0 ? list.length - 1 : idx - 1]);
        break;
      case "Home":
        e.preventDefault();
        focusItem(list[0]);
        break;
      case "End":
        e.preventDefault();
        focusItem(list[list.length - 1]);
        break;
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className="flex flex-col"
    >
      {children}
    </div>
  );
}

export interface MenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Optional leading icon. */
  icon?: ReactNode;
}

export function MenuItem({
  icon,
  className,
  onClick,
  children,
  ...rest
}: MenuItemProps) {
  const ctx = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={(e) => {
        onClick?.(e);
        ctx?.close();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-ink-muted transition-colors",
        "hover:bg-bg-hover hover:text-ink focus:bg-bg-hover focus:text-ink focus:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      {icon && <span className="shrink-0 text-ink-faint">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border-subtle" />;
}

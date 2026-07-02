import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export type IconButtonVariant = "ghost" | "primary" | "active";
export type IconButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<IconButtonVariant, string> = {
  ghost: "text-ink-muted hover:bg-bg-hover hover:text-ink",
  primary: "bg-accent text-bg hover:bg-accent-hover",
  active: "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent",
};

const SIZES: Record<IconButtonSize, string> = {
  sm: "h-7 w-7 rounded-lg",
  md: "h-8 w-8 rounded-md",
  lg: "h-9 w-9 rounded-md",
};

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name for the icon-only control. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      variant = "ghost",
      size = "md",
      className,
      type = "button",
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          "disabled:cursor-not-allowed disabled:opacity-50",
          VARIANTS[variant],
          SIZES[size],
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "ghost" | "subtle" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

// shadcn/ui button family on the monochrome accent (AGE-672): a near-white/
// graphite solid `primary` (subtle shadow), an outlined `subtle` (secondary),
// a borderless `ghost`, and a tinted (not solid) `danger`. rounded-md, h-9.
//
// Usage rule (AGE-673): the solid `primary` is the loudest control (highest
// contrast), so reserve it for the single decisive action in a focused context —
// composer Send, a dialog's confirm, a gate's enable. Standalone navigation /
// creation CTAs that sit in the chrome (sidebar "New chat", empty-state "Start a
// chat") use `ghost` so they read as controls, not bright banners.
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-bg hover:bg-accent-hover border border-transparent shadow-sm",
  ghost:
    "bg-transparent text-ink-muted hover:bg-bg-hover hover:text-ink border border-transparent",
  subtle:
    "bg-bg-raised text-ink hover:bg-bg-hover border border-border-strong shadow-sm",
  danger: "bg-danger/10 text-danger hover:bg-danger/20 border border-danger/30",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-md",
  md: "h-9 px-4 text-sm gap-2 rounded-md",
};

export function Button({
  variant = "subtle",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}

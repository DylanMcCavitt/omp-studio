import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface CardProps {
  className?: string;
  children?: ReactNode;
  /** Render as a different element (e.g. "button", "a"). Defaults to "div". */
  as?: ElementType;
}

export function Card({ className, children, as: Tag = "div" }: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-xl border border-border bg-bg-panel shadow-panel",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

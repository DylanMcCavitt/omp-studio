import { cn } from "@/lib/cn";

export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse-slow rounded-md bg-bg-hover", className)}
      aria-hidden
    />
  );
}

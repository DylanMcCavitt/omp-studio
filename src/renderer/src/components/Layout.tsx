import type { ReactNode } from "react";
import { Toaster } from "@/components/ui";
import { Sidebar } from "./Sidebar";

export interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <header className="titlebar flex h-7 shrink-0 items-center border-b border-border-subtle bg-bg-raised pl-[72px]">
        <span className="flex-1 text-center text-xs font-medium text-ink-faint">
          OMP Studio
        </span>
        <span className="w-[72px]" />
      </header>
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}

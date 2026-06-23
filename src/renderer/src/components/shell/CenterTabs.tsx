// The center surface tab strip (AGE-634). The center is the primary chat/files
// area: an always-present "Chat" tab plus one tab per open file. Every pane stays
// MOUNTED and is toggled with `hidden`, so switching tabs preserves the chat
// (a live stream keeps running) and each editor's cursor/scroll/undo. The strip
// only appears once a file is open; with no files the chat (or its empty state)
// renders exactly as before. Closing a dirty file confirms via the store wrapper.

import { FileText, MessageSquare, X } from "lucide-react";
import type { ReactNode } from "react";
import { FileEditor } from "@/components/files/FileEditor";
import { cn } from "@/lib/cn";
import {
  type CenterTab,
  CHAT_TAB,
  closeFileWithConfirm,
  fileBasename,
  useFilesStore,
} from "@/store/files";

const TAB_BASE =
  "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
const TAB_ACTIVE = "bg-bg-hover text-ink";
const TAB_INACTIVE = "text-ink-muted hover:bg-bg-hover/60 hover:text-ink";

export function CenterTabs({ chat }: { chat: ReactNode }) {
  const order = useFilesStore((s) => s.order);
  const activeTab = useFilesStore((s) => s.activeTab);
  const hasFiles = order.length > 0;
  // With no files the chat owns the surface; otherwise it shows only when focused.
  const chatActive = !hasFiles || activeTab === CHAT_TAB;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {hasFiles && <TabStrip order={order} activeTab={activeTab} />}
      <div className="relative min-h-0 min-w-0 flex-1">
        <Pane active={chatActive}>{chat}</Pane>
        {order.map((path) => (
          <Pane key={path} active={activeTab === path}>
            <FileEditor path={path} />
          </Pane>
        ))}
      </div>
    </div>
  );
}

/**
 * A mounted-but-toggled pane: the inactive pane is removed from layout with the
 * native `hidden` attribute (so the chat keeps streaming and each editor keeps
 * its cursor/scroll/undo across switches). `hidden` is used over a `display`
 * utility because the pane carries no competing `display` class, so the UA
 * `display:none` always wins.
 */
function Pane({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div
      hidden={!active}
      aria-hidden={!active}
      className="absolute inset-0 min-h-0 min-w-0"
    >
      {children}
    </div>
  );
}

function TabStrip({
  order,
  activeTab,
}: {
  order: string[];
  activeTab: CenterTab;
}) {
  const setActiveTab = useFilesStore((s) => s.setActiveTab);
  return (
    <div
      role="tablist"
      aria-label="Open tabs"
      className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-subtle bg-bg-raised px-1.5"
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === CHAT_TAB}
        onClick={() => setActiveTab(CHAT_TAB)}
        className={cn(
          TAB_BASE,
          activeTab === CHAT_TAB ? TAB_ACTIVE : TAB_INACTIVE,
        )}
      >
        <MessageSquare size={13} className="shrink-0" />
        Chat
      </button>
      {order.map((path) => (
        <FileTabButton
          key={path}
          path={path}
          active={activeTab === path}
          onSelect={() => setActiveTab(path)}
        />
      ))}
    </div>
  );
}

function FileTabButton({
  path,
  active,
  onSelect,
}: {
  path: string;
  active: boolean;
  onSelect: () => void;
}) {
  const dirty = useFilesStore((s) => s.tabs[path]?.dirty === true);
  const name = fileBasename(path);
  return (
    // Presentational wrapper so the select + close buttons stay siblings (never
    // nested interactives); the close button overlays the select button's right
    // padding so a click on it never selects the tab.
    <div className="relative flex shrink-0 items-stretch">
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onSelect}
        title={path}
        className={cn(TAB_BASE, "pr-7", active ? TAB_ACTIVE : TAB_INACTIVE)}
      >
        <FileText size={13} className="shrink-0 text-ink-faint" />
        <span className="max-w-[11rem] truncate">{name}</span>
        {dirty && (
          <span
            role="img"
            aria-label="Unsaved changes"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
          />
        )}
      </button>
      <button
        type="button"
        aria-label={`Close ${name}`}
        onClick={() => closeFileWithConfirm(path)}
        className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-ink-faint transition-colors hover:bg-bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <X size={12} />
      </button>
    </div>
  );
}

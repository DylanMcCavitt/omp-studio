// A single open-file pane (AGE-634). Renders the tab's state: a spinner while
// the initial read is in flight, a read-only notice for files that are too large
// or binary (no editor mounts for those), an error notice when the read failed,
// and otherwise the CodeMirror surface. The actual editor is `React.lazy`-loaded
// so the `@codemirror/*` packages stay in their own async chunk, off the initial
// bundle. Cmd/Ctrl+S saves the active buffer (bound inside the editor); the
// Save button mirrors it for pointer users.

import { FileWarning, Save } from "lucide-react";
import { lazy, Suspense } from "react";
import { EmptyState, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { type FileTab, fileBasename, useFilesStore } from "@/store/files";

const CodeMirrorEditor = lazy(() => import("./CodeMirrorEditor"));

export function FileEditor({ path }: { path: string }) {
  const tab = useFilesStore((s) => s.tabs[path]);
  const setDirtyText = useFilesStore((s) => s.setDirtyText);
  const save = useFilesStore((s) => s.save);

  if (!tab) return null;

  const readOnly = tab.tooLarge || tab.binary || tab.error;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-raised px-3">
        <span className="truncate text-xs text-ink-muted" title={path}>
          {path}
        </span>
        {tab.dirty && (
          <span
            role="img"
            aria-label="Unsaved changes"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
          />
        )}
        <div className="flex-1" />
        {!readOnly && (
          <button
            type="button"
            onClick={() => void save(path)}
            disabled={!tab.dirty}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              tab.dirty
                ? "bg-accent text-bg hover:bg-accent-hover"
                : "cursor-default text-ink-faint",
            )}
          >
            <Save size={14} />
            Save
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <EditorBody
          tab={tab}
          onChange={(text) => setDirtyText(path, text)}
          onSave={() => void save(path)}
        />
      </div>
    </div>
  );
}

function EditorBody({
  tab,
  onChange,
  onSave,
}: {
  tab: FileTab;
  onChange: (text: string) => void;
  onSave: () => void;
}) {
  if (tab.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={20} />
      </div>
    );
  }
  if (tab.error) {
    return (
      <EmptyState
        className="h-full"
        icon={<FileWarning className="h-6 w-6" />}
        title="Couldn’t open file"
        hint={`${fileBasename(tab.path)} could not be read.`}
      />
    );
  }
  if (tab.tooLarge) {
    return (
      <EmptyState
        className="h-full"
        icon={<FileWarning className="h-6 w-6" />}
        title="File too large to edit"
        hint="This file exceeds the editor’s size limit and is read-only."
      />
    );
  }
  if (tab.binary) {
    return (
      <EmptyState
        className="h-full"
        icon={<FileWarning className="h-6 w-6" />}
        title="Binary file"
        hint="This file isn’t text and can’t be edited here."
      />
    );
  }
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spinner size={20} />
        </div>
      }
    >
      <CodeMirrorEditor
        path={tab.path}
        initialDoc={tab.text}
        onChange={onChange}
        onSave={onSave}
      />
    </Suspense>
  );
}

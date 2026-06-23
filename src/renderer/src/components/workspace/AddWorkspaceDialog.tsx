// Add-workspace dialog (feature 1): pick a project directory and optionally
// override its display label, then persist it as a first-class Workspace and
// select it as the target for new chats. Built on the shared ModalShell so it
// inherits the focus trap, Esc-to-cancel, and Cmd/Ctrl+Enter-to-submit
// behaviour every blocking dialog uses. Adding selects, but spawns nothing.

import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { ModalShell } from "@/components/chat/ui-request/ModalShell";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { projectLabel } from "@/lib/workspaces";
import { useAppStore } from "@/store/app";
import { useSettingsStore } from "@/store/settings";
import { toast } from "@/store/toast";

export function AddWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const addWorkspace = useSettingsStore((s) => s.addWorkspace);
  const setSelectedProject = useAppStore((s) => s.setSelectedProject);
  const [cwd, setCwd] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const pick = () => {
    void window.omp.pickDirectory().then((dir) => {
      if (dir) setCwd(dir);
    });
  };

  const submit = async () => {
    if (!cwd || submitting) return;
    setSubmitting(true);
    try {
      const trimmed = label.trim();
      await addWorkspace(cwd, trimmed || undefined);
      setSelectedProject(cwd);
      toast.success(`Added workspace “${trimmed || projectLabel(cwd)}”`);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title="Add workspace"
      message="Pick a project directory. New chats use it as their working directory."
      onDismiss={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!cwd || submitting}
          >
            {submitting ? "Adding…" : "Add workspace"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">
            Directory
          </span>
          <button
            type="button"
            onClick={pick}
            className="flex w-full items-center gap-2 rounded-lg border border-border-subtle bg-bg-raised px-3 py-2 text-left text-sm hover:bg-bg-hover"
          >
            <FolderOpen className="h-4 w-4 shrink-0 text-ink-muted" />
            <span
              className={cn("truncate", cwd ? "text-ink" : "text-ink-faint")}
            >
              {cwd ?? "Choose a project directory"}
            </span>
          </button>
        </div>

        <div>
          <label
            htmlFor="workspace-label"
            className="mb-1.5 block text-xs font-medium text-ink-muted"
          >
            Label (optional)
          </label>
          <input
            id="workspace-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={
              cwd ? projectLabel(cwd) : "Defaults to the folder name"
            }
            className="w-full rounded-lg border border-border-subtle bg-bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
        </div>
      </div>
    </ModalShell>
  );
}

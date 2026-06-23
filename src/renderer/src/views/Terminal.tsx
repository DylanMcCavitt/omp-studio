// Feature 7 — Terminal view. Renders a real shell (xterm.js ↔ a main-process
// pty) scoped to the active workspace cwd (`app.selectedProject`). The
// capability is OFF by default: until `settings.terminal.enabled` is true the
// body is replaced by the honest acknowledgement gate (`TerminalGate`), which
// blocks the shell from ever spawning. With no workspace selected there is no
// valid cwd to spawn in, so we show an empty state instead of a failing pty.
//
// Route is wired separately by the nav registry (this is the default export the
// registry mounts). The pty lifecycle lives entirely in `XtermView` +
// `store/terminal.ts`; this view only chooses gate / empty / live and owns the
// restart affordance after a shell exits.

import { TerminalSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { TerminalGate } from "@/components/terminal/TerminalGate";
import { XtermView } from "@/components/terminal/XtermView";
import { Button, EmptyState } from "@/components/ui";
import { projectLabel } from "@/lib/workspaces";
import { useAppStore } from "@/store/app";
import { useSettingsStore } from "@/store/settings";

export default function Terminal() {
  const enabled = useSettingsStore(
    (s) => s.settings?.terminal?.enabled === true,
  );
  const cwd = useAppStore((s) => s.selectedProject);

  // Exit banner + restart: a fresh `key` (cwd + nonce) remounts XtermView,
  // which disposes the dead pty and spawns a new one.
  const [exitCode, setExitCode] = useState<number | null | undefined>(
    undefined,
  );
  const [restartNonce, setRestartNonce] = useState(0);

  // A workspace switch retargets the terminal; clear any stale exit banner.
  useEffect(() => {
    setExitCode(undefined);
  }, [cwd]);

  const restart = () => {
    setExitCode(undefined);
    setRestartNonce((n) => n + 1);
  };

  const exited = exitCode !== undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Terminal</h1>
          <p className="truncate text-sm text-ink-muted">
            {enabled && cwd
              ? `Shell in ${projectLabel(cwd)} · ${cwd}`
              : "A real shell at your user privilege — not a sandbox"}
          </p>
        </div>
      </div>

      {exited && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-bg-raised px-6 py-2 text-xs">
          <span className="text-ink-muted">
            Shell exited{exitCode != null ? ` (code ${exitCode})` : ""}.
          </span>
          <Button size="sm" variant="subtle" onClick={restart}>
            Restart
          </Button>
        </div>
      )}

      <div className="relative min-h-0 flex-1 bg-bg-raised">
        {!enabled ? (
          <>
            {/* Inert backdrop behind the blocking gate. */}
            <EmptyState
              className="h-full"
              icon={<TerminalSquare className="h-8 w-8" />}
              title="Terminal is off"
              hint="Enable the terminal to open a shell in your active workspace."
            />
            <TerminalGate />
          </>
        ) : !cwd ? (
          <EmptyState
            className="h-full"
            icon={<TerminalSquare className="h-8 w-8" />}
            title="No workspace selected"
            hint="Select or add a workspace to open a terminal in its directory."
          />
        ) : (
          <XtermView
            key={`${cwd}:${restartNonce}`}
            cwd={cwd}
            onExit={(code) => setExitCode(code)}
          />
        )}
      </div>
    </div>
  );
}

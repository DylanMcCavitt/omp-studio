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

import type { ExternalTerminalLauncherInfo } from "@shared/ipc";
import { ExternalLink, Plus, TerminalSquare, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TerminalGate } from "@/components/terminal/TerminalGate";
import { XtermView } from "@/components/terminal/XtermView";
import { Button, EmptyState } from "@/components/ui";
import { projectLabel } from "@/lib/workspaces";
import { useAppStore } from "@/store/app";
import { useSettingsStore } from "@/store/settings";
import { useTerminalStore } from "@/store/terminal";

export default function Terminal() {
  const terminalSettings = useSettingsStore((s) => s.settings?.terminal);
  const enabled = terminalSettings?.enabled === true;
  const defaultTarget = terminalSettings?.defaultTarget ?? "built-in";
  const externalProfile = terminalSettings?.externalProfile ?? "system";
  const cwd = useAppStore((s) => s.selectedProject);

  const terminals = useTerminalStore((s) => s.terminals);
  const createTerminal = useTerminalStore((s) => s.create);
  const disposeTerminal = useTerminalStore((s) => s.dispose);
  const entries = useMemo(
    () =>
      Object.values(terminals)
        .filter((t) => t.cwd === cwd)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [terminals, cwd],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [autoStartedCwd, setAutoStartedCwd] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | undefined>();
  const [externalLaunchers, setExternalLaunchers] = useState<
    ExternalTerminalLauncherInfo[]
  >([]);
  const [externalLoading, setExternalLoading] = useState(false);
  const [openingExternal, setOpeningExternal] = useState(false);
  const [externalError, setExternalError] = useState<string | undefined>();
  const [externalStatus, setExternalStatus] = useState<string | undefined>();

  const spawnTerminal = useCallback(async () => {
    if (!cwd || creating) return;
    setCreating(true);
    setCreateError(undefined);
    try {
      const info = await createTerminal(cwd, 80, 24);
      setActiveId(info.id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  }, [cwd, creating, createTerminal]);

  useEffect(() => {
    if (!enabled || !cwd) {
      setExternalLaunchers([]);
      return;
    }
    let cancelled = false;
    setExternalLoading(true);
    void window.omp.terminal
      .externalLaunchers()
      .then((launchers) => {
        if (!cancelled) setExternalLaunchers(launchers);
      })
      .catch((error) => {
        if (!cancelled) {
          setExternalLaunchers([]);
          setExternalError(
            error instanceof Error ? error.message : String(error),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setExternalLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, cwd]);

  useEffect(() => {
    setActiveId(null);
    setAutoStartedCwd(null);
    setCreateError(undefined);
    setExternalError(undefined);
    setExternalStatus(undefined);
  }, [cwd]);

  useEffect(() => {
    if (!enabled || !cwd) return;
    if (activeId && entries.some((entry) => entry.id === activeId)) return;
    const first = entries[0];
    if (first) {
      setActiveId(first.id);
      return;
    }
    if (defaultTarget === "external") return;
    if (!creating && autoStartedCwd !== cwd) {
      setAutoStartedCwd(cwd);
      void spawnTerminal();
    }
  }, [
    enabled,
    cwd,
    entries,
    activeId,
    creating,
    autoStartedCwd,
    spawnTerminal,
    defaultTarget,
  ]);

  const closeTerminal = async (id: string) => {
    const index = entries.findIndex((entry) => entry.id === id);
    const next = entries[index + 1] ?? entries[index - 1] ?? null;
    if (activeId === id) setActiveId(next?.id ?? null);
    await disposeTerminal(id);
  };

  const preferredExternal = useMemo(() => {
    if (externalProfile === "system") {
      return (
        externalLaunchers.find(
          (launcher) => launcher.profile === "system" && launcher.available,
        ) ?? externalLaunchers.find((launcher) => launcher.available)
      );
    }
    return externalLaunchers.find(
      (launcher) => launcher.profile === externalProfile,
    );
  }, [externalLaunchers, externalProfile]);

  const externalLabel = preferredExternal?.label ?? "external terminal";
  const externalButtonTitle = preferredExternal?.available
    ? `Open ${preferredExternal.label} as a separate app`
    : preferredExternal
      ? `${preferredExternal.label} is not available; external terminals open as separate apps.`
      : "No matching external terminal is available; external terminals open as separate apps.";

  const openExternalTerminal = async () => {
    if (!cwd || openingExternal) return;
    setOpeningExternal(true);
    setExternalError(undefined);
    setExternalStatus(undefined);
    try {
      const result = await window.omp.terminal.openExternal({
        cwd,
        profile: externalProfile,
      });
      setExternalStatus(`Opened ${result.label} for ${projectLabel(cwd)}.`);
    } catch (error) {
      setExternalError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningExternal(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Terminal</h1>
          <p className="truncate text-sm text-ink-muted">
            {enabled && cwd
              ? `Built-in xterm shell in ${projectLabel(cwd)} · ${cwd}`
              : "A real shell at your user privilege — not a sandbox"}
          </p>
        </div>
      </div>
      {enabled && cwd && (
        <div className="flex shrink-0 items-center gap-1 border-b border-border bg-bg-panel px-3 py-2">
          <div
            role="tablist"
            aria-label="Terminal sessions"
            className="scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          >
            {entries.map((entry, index) => {
              const selected = entry.id === activeId;
              const label = `Terminal ${index + 1}${entry.exited ? " exited" : ""}`;
              return (
                <div
                  key={entry.id}
                  className={[
                    "flex max-w-64 items-center rounded-md border text-xs transition-colors",
                    selected
                      ? "border-accent/50 bg-accent-soft text-accent"
                      : "border-border-subtle bg-bg-raised text-ink-muted",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActiveId(entry.id)}
                    className="flex min-w-0 items-center gap-2 px-2.5 py-1 text-left hover:text-ink"
                    title={entry.cwd}
                  >
                    <span className="truncate">{label}</span>
                    <span className="font-mono text-[10px] opacity-70">
                      {projectLabel(entry.cwd)}
                    </span>
                    <span
                      className={
                        entry.exited
                          ? "rounded-full bg-warn/10 px-1.5 text-warn"
                          : "rounded-full bg-success/10 px-1.5 text-success"
                      }
                    >
                      {entry.exited ? "exited" : "live"}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${label}`}
                    className="mr-1 rounded p-0.5 text-ink-faint hover:bg-bg-hover hover:text-danger"
                    onClick={() => void closeTerminal(entry.id)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
          <Button
            size="sm"
            variant={defaultTarget === "external" ? "primary" : "subtle"}
            disabled={
              externalLoading ||
              openingExternal ||
              !preferredExternal?.available
            }
            title={externalButtonTitle}
            onClick={() => void openExternalTerminal()}
          >
            <ExternalLink className="h-4 w-4" />
            {openingExternal ? "Opening…" : `Open ${externalLabel}`}
          </Button>
          <Button
            size="sm"
            variant="subtle"
            onClick={() => void spawnTerminal()}
          >
            <Plus className="h-4 w-4" />
            New terminal
          </Button>
        </div>
      )}
      {createError && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger"
        >
          <span>Terminal failed to start: {createError}</span>
          <Button
            size="sm"
            variant="subtle"
            onClick={() => void spawnTerminal()}
          >
            Retry
          </Button>
        </div>
      )}
      {externalError && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger"
        >
          <span>External terminal failed to open: {externalError}</span>
          <Button
            size="sm"
            variant="subtle"
            onClick={() => void openExternalTerminal()}
          >
            Retry
          </Button>
        </div>
      )}
      {externalStatus && (
        <div
          role="status"
          className="border-b border-success/30 bg-success/5 px-4 py-2 text-sm text-success"
        >
          {externalStatus}
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
        ) : entries.length === 0 ? (
          <EmptyState
            className="h-full"
            icon={<TerminalSquare className="h-8 w-8" />}
            title={creating ? "Starting terminal…" : "No terminal tabs"}
            hint={
              defaultTarget === "external"
                ? `Open ${externalLabel} as a separate app, or create a built-in xterm tab for this workspace.`
                : "Create a built-in xterm tab for the selected workspace."
            }
          />
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className={entry.id === activeId ? "h-full" : "hidden h-full"}
            >
              <XtermView
                id={entry.id}
                cwd={entry.cwd}
                active={entry.id === activeId}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Active-chat composer (AGE-705). A rounded bordered input box: a textarea over
// a controls row of attach (paperclip) · model chip (Live Dot + model +
// chevron) · spacer · send (accent, up-arrow). While the agent streams the send
// slot becomes Steer + Stop. Both send paths accept image attachments. The
// placeholder names the active workspace ("Message {workspace}…"). Hangs the
// slash-command palette off the composer overlay seam, fed by the active
// session's available commands. Disabled until a session is active. Model
// selection, attachment, and send behavior are unchanged — this is visual only.

import type { AvailableCommand } from "@shared/rpc";
import { ArrowUp, Navigation, Square } from "lucide-react";
import { ModelControl } from "@/components/chat/ModelControl";
import { PromptComposer } from "@/components/chat/PromptComposer";
import { SlashCommandPalette } from "@/components/chat/SlashCommandPalette";
import { Button } from "@/components/ui";
import { projectLabel, workspaceColorForCwd } from "@/lib/workspaces";
import { useAppStore } from "@/store/app";
import { useActiveSession, useChatStore } from "@/store/chat";
import { sessionStatus } from "@/store/session-reducer";
import { useSettingsStore } from "@/store/settings";

/** Stable empty ref so the no-session selector keeps a steady identity. */
const NO_COMMANDS: AvailableCommand[] = [];

export function Composer() {
  const sessionId = useActiveSession((s) => s?.sessionId ?? null);
  const status = useActiveSession((s) => s?.status ?? "idle");
  const model = useActiveSession((s) => s?.model ?? null);
  const selectedProject = useAppStore((s) => s.selectedProject);
  const send = useChatStore((s) => s.send);
  const steer = useChatStore((s) => s.steer);
  const abort = useChatStore((s) => s.abort);
  const setModel = useChatStore((s) => s.setModel);
  const availableCommands = useActiveSession(
    (s) => s?.availableCommands ?? NO_COMMANDS,
  );
  const workspaces = useSettingsStore((s) => s.settings?.workspaces);
  const pendingComposerText = useAppStore((s) => s.pendingComposerText);
  const clearPendingComposerText = useAppStore(
    (s) => s.clearPendingComposerText,
  );

  const streaming = status === "streaming";
  const disabled = !sessionId;

  // Name the active workspace for the placeholder: read the same chrome source
  // as the window title (app.selectedProject), preferring the saved workspace's
  // label, then the path basename, so the composer never disagrees with the
  // active workspace shown elsewhere in the chrome.
  const workspaceName =
    workspaces?.find((w) => w.cwd === selectedProject)?.label ??
    (selectedProject ? projectLabel(selectedProject) : null);
  const color = workspaceColorForCwd(workspaces, selectedProject ?? undefined);

  return (
    <div className="border-t border-border-subtle bg-bg-panel px-4 py-3">
      <div
        data-testid="composer-width"
        className="mx-auto w-full max-w-[min(100%,72rem)]"
      >
        <PromptComposer
          disabled={disabled}
          injectText={pendingComposerText}
          onInjectConsumed={clearPendingComposerText}
          placeholder={
            disabled
              ? "No active session"
              : streaming
                ? "Steer the agent…"
                : `Message ${workspaceName ?? "workspace"}…`
          }
          onSubmit={(text, images) =>
            streaming ? steer(text, images) : send(text, images)
          }
          renderOverlay={(ctx) => (
            <SlashCommandPalette {...ctx} commands={availableCommands} />
          )}
          renderControls={() =>
            disabled ? null : (
              <ModelControl
                model={model}
                onChange={setModel}
                color={color}
                status={sessionStatus({ live: true, status })}
              />
            )
          }
          renderActions={({ submit, canSubmit }) =>
            streaming ? (
              <>
                <Button variant="subtle" onClick={submit} disabled={!canSubmit}>
                  <Navigation className="h-4 w-4" />
                  Steer
                </Button>
                <Button
                  variant="danger"
                  onClick={() => void abort()}
                  disabled={disabled}
                >
                  <Square className="h-4 w-4" />
                  Stop
                </Button>
              </>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                aria-label="Send"
                title="Send"
                className="inline-flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-lg bg-accent text-bg transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )
          }
        />
      </div>
    </div>
  );
}

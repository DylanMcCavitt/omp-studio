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
import { useRef, useState } from "react";
import { AgentDropChooser } from "@/components/chat/AgentDropChooser";
import { ModelControl } from "@/components/chat/ModelControl";
import { PromptComposer } from "@/components/chat/PromptComposer";
import { SlashCommandPalette } from "@/components/chat/SlashCommandPalette";
import { Button, IconButton } from "@/components/ui";
import type { AgentDragPayload } from "@/lib/agentDrag";
import { projectLabel, workspaceColorForCwd } from "@/lib/workspaces";
import { useAppStore } from "@/store/app";
import { useChatStore, useSession } from "@/store/chat";
import { sessionStatus } from "@/store/session-reducer";
import { useSettingsStore } from "@/store/settings";

/** Stable empty ref so the no-session selector keeps a steady identity. */
const NO_COMMANDS: AvailableCommand[] = [];

export function Composer({ sessionId }: { sessionId: string }) {
  const open = useSession(sessionId, (s) => Boolean(s));
  const status = useSession(sessionId, (s) => s?.status ?? "idle");
  const model = useSession(sessionId, (s) => s?.model ?? null);
  const selectedProject = useAppStore((s) => s.selectedProject);
  const send = useChatStore((s) => s.send);
  const steer = useChatStore((s) => s.steer);
  const abort = useChatStore((s) => s.abort);
  const setModel = useChatStore((s) => s.setModel);
  const availableCommands = useSession(
    sessionId,
    (s) => s?.availableCommands ?? NO_COMMANDS,
  );
  const workspaces = useSettingsStore((s) => s.settings?.workspaces);
  // Global one-shot prefill ("Use in chat" from Skills etc.) targets the
  // ACTIVE session's composer only — a pinned pane rendering another session
  // must not adopt (or consume) it (AGE-801 multi-pane).
  const isActivePane = useChatStore((s) => s.activeSessionId === sessionId);
  const pendingComposerText = useAppStore((s) =>
    isActivePane ? s.pendingComposerText : undefined,
  );
  const clearPendingComposerText = useAppStore(
    (s) => s.clearPendingComposerText,
  );
  // AGE-779 — a dropped agent opens the routing chooser instead of silently
  // inserting steering text; "Steer" adopts the previewed text via the same
  // one-shot inject seam the Skills prefill uses (local, pane-scoped).
  const [droppedAgent, setDroppedAgent] = useState<AgentDragPayload | null>(
    null,
  );
  const [steerText, setSteerText] = useState<string | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const closeDroppedAgent = () => {
    setDroppedAgent(null);
    requestAnimationFrame(() => {
      composerRef.current
        ?.querySelector<HTMLTextAreaElement>("textarea")
        ?.focus();
    });
  };

  const streaming = status === "streaming";
  // Disabled until this pane's session is registered in the store — a pane
  // whose session is still opening (or gone) must not accept input.
  const disabled = !open;

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
        ref={composerRef}
        data-testid="composer-width"
        className="relative mx-auto w-full max-w-[min(100%,72rem)]"
      >
        {droppedAgent && (
          <AgentDropChooser
            payload={droppedAgent}
            sessionId={sessionId}
            onSteer={setSteerText}
            onClose={closeDroppedAgent}
          />
        )}
        <PromptComposer
          disabled={disabled}
          injectText={steerText ?? pendingComposerText}
          onInjectConsumed={() => {
            // The local steer adoption and the global Skills prefill share the
            // inject seam; consume whichever fed it.
            if (steerText != null) setSteerText(null);
            else clearPendingComposerText();
          }}
          onAgentDrop={setDroppedAgent}
          globalShortcuts={isActivePane}
          placeholder={
            disabled
              ? "No active session"
              : streaming
                ? "Steer the agent…"
                : `Message ${workspaceName ?? "workspace"}…`
          }
          onSubmit={(text, images) =>
            streaming
              ? steer(text, images, sessionId)
              : send(text, images, sessionId)
          }
          renderOverlay={(ctx) => (
            <SlashCommandPalette {...ctx} commands={availableCommands} />
          )}
          renderControls={() =>
            disabled ? null : (
              <ModelControl
                model={model}
                onChange={(provider, modelId) =>
                  setModel(provider, modelId, sessionId)
                }
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
                  variant="warn"
                  onClick={() => void abort(sessionId)}
                  disabled={disabled}
                >
                  <Square className="h-4 w-4" />
                  Stop
                </Button>
              </>
            ) : (
              <IconButton
                label="Send"
                variant="primary"
                size="sm"
                onClick={submit}
                disabled={!canSubmit}
                className="select-none"
              >
                <ArrowUp className="h-4 w-4" />
              </IconButton>
            )
          }
        />
      </div>
    </div>
  );
}

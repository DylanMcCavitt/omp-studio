// Active-chat composer. Wraps the reusable PromptComposer with the chat-specific
// action buttons: Send when idle, Steer + Stop while the agent streams. Both
// send paths accept image attachments. Hangs the slash-command palette off the
// composer overlay seam, fed by the active session's available commands.
// Disabled until a session is active.

import type { AvailableCommand } from "@shared/rpc";
import { Navigation, Send, Square } from "lucide-react";
import { PromptComposer } from "@/components/chat/PromptComposer";
import { SlashCommandPalette } from "@/components/chat/SlashCommandPalette";
import { Button } from "@/components/ui";
import { useAppStore } from "@/store/app";
import { useActiveSession, useChatStore } from "@/store/chat";

/** Stable empty ref so the no-session selector keeps a steady identity. */
const NO_COMMANDS: AvailableCommand[] = [];

export function Composer() {
  const sessionId = useActiveSession((s) => s?.sessionId ?? null);
  const status = useActiveSession((s) => s?.status ?? "idle");
  const send = useChatStore((s) => s.send);
  const steer = useChatStore((s) => s.steer);
  const abort = useChatStore((s) => s.abort);
  const availableCommands = useActiveSession(
    (s) => s?.availableCommands ?? NO_COMMANDS,
  );
  const pendingComposerText = useAppStore((s) => s.pendingComposerText);
  const clearPendingComposerText = useAppStore(
    (s) => s.clearPendingComposerText,
  );

  const streaming = status === "streaming";
  const disabled = !sessionId;

  return (
    <div className="border-t border-border-subtle bg-bg-panel px-4 py-3">
      <div className="mx-auto max-w-3xl">
        <PromptComposer
          disabled={disabled}
          injectText={pendingComposerText}
          onInjectConsumed={clearPendingComposerText}
          placeholder={
            disabled
              ? "No active session"
              : streaming
                ? "Steer the agent…"
                : "Send a message…"
          }
          onSubmit={(text, images) =>
            streaming ? steer(text, images) : send(text, images)
          }
          renderOverlay={(ctx) => (
            <SlashCommandPalette {...ctx} commands={availableCommands} />
          )}
          renderActions={({ submit, canSubmit }) =>
            streaming ? (
              <>
                <Button variant="subtle" onClick={submit} disabled={!canSubmit}>
                  <span className="flex items-center gap-1.5">
                    <Navigation className="h-4 w-4" />
                    Steer
                  </span>
                </Button>
                <Button
                  variant="danger"
                  onClick={() => void abort()}
                  disabled={disabled}
                >
                  <span className="flex items-center gap-1.5">
                    <Square className="h-4 w-4" />
                    Stop
                  </span>
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={submit} disabled={!canSubmit}>
                <span className="flex items-center gap-1.5">
                  <Send className="h-4 w-4" />
                  Send
                </span>
              </Button>
            )
          }
        />
      </div>
    </div>
  );
}

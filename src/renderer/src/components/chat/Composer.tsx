// Active-chat composer. Wraps the reusable PromptComposer with the chat-specific
// action buttons: Send when idle, Steer + Stop while the agent streams. Both
// send paths accept image attachments. Disabled until a session is active.

import { Navigation, Send, Square } from "lucide-react";
import { PromptComposer } from "@/components/chat/PromptComposer";
import { Button } from "@/components/ui";
import { useActiveSession, useChatStore } from "@/store/chat";

export function Composer() {
  const sessionId = useActiveSession((s) => s?.sessionId ?? null);
  const status = useActiveSession((s) => s?.status ?? "idle");
  const send = useChatStore((s) => s.send);
  const steer = useChatStore((s) => s.steer);
  const abort = useChatStore((s) => s.abort);

  const streaming = status === "streaming";
  const disabled = !sessionId;

  return (
    <div className="border-t border-border-subtle bg-bg-panel px-4 py-3">
      <div className="mx-auto max-w-3xl">
        <PromptComposer
          disabled={disabled}
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

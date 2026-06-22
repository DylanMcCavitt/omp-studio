// Prompt input. Auto-growing textarea (Enter sends, Shift+Enter newlines). When
// idle it shows Send; while the agent streams it shows Steer + Stop. Disabled
// until a session is active.

import { Navigation, Send, Square } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { useChatStore } from "@/store/chat";

export function Composer() {
  const sessionId = useChatStore((s) => s.sessionId);
  const status = useChatStore((s) => s.status);
  const send = useChatStore((s) => s.send);
  const steer = useChatStore((s) => s.steer);
  const abort = useChatStore((s) => s.abort);

  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const streaming = status === "streaming";
  const disabled = !sessionId;

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const submit = () => {
    const value = text.trim();
    if (!value || disabled) return;
    if (streaming) void steer(value);
    else void send(value);
    setText("");
    const el = ref.current;
    if (el) el.style.height = "auto";
  };

  return (
    <div className="border-t border-border-subtle bg-bg-panel px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          ref={ref}
          value={text}
          rows={1}
          disabled={disabled}
          placeholder={
            disabled
              ? "No active session"
              : streaming
                ? "Steer the agent…"
                : "Send a message…"
          }
          onChange={(e) => {
            setText(e.target.value);
            resize();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="scrollbar max-h-[200px] min-h-[2.5rem] flex-1 resize-none rounded-lg border border-border-subtle bg-bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none disabled:opacity-50"
        />
        {streaming ? (
          <>
            <Button
              variant="subtle"
              onClick={submit}
              disabled={disabled || !text.trim()}
            >
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
          <Button
            variant="primary"
            onClick={submit}
            disabled={disabled || !text.trim()}
          >
            <span className="flex items-center gap-1.5">
              <Send className="h-4 w-4" />
              Send
            </span>
          </Button>
        )}
      </div>
    </div>
  );
}

// First-run acknowledgement gate for the terminal (feature 7). The terminal
// capability is OFF by default; this blocking modal is shown until the user
// enables it. The copy is deliberately, honestly alarming: the terminal is a
// REAL shell at the user's full privilege — Studio's renderer isolation does
// NOT sandbox it. We never call it "secure" or "safe". Enabling flips
// `settings.terminal.enabled` through the same pessimistic settings update
// every other preference uses.

import { useState } from "react";
import { ModalShell } from "@/components/chat/ui-request/ModalShell";
import { Badge, Button } from "@/components/ui";
import { useSettingsStore } from "@/store/settings";
import { useShellStore } from "@/store/shell";

// Mirrors the main settings-service default; used only as a floor if the
// persisted concurrency value is somehow absent when we flip `enabled`.
const DEFAULT_TERMINAL_MAX_CONCURRENT = 4;

export function TerminalGate() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const closePanel = useShellStore((s) => s.closePanel);
  const [enabling, setEnabling] = useState(false);

  const leave = () => closePanel();

  const enable = async () => {
    if (enabling) return;
    setEnabling(true);
    const current = settings?.terminal;
    await update({
      terminal: {
        enabled: true,
        maxConcurrent:
          current?.maxConcurrent ?? DEFAULT_TERMINAL_MAX_CONCURRENT,
        defaultTarget: current?.defaultTarget ?? "built-in",
        externalProfile: current?.externalProfile ?? "system",
      },
    });
    setEnabling(false);
  };

  return (
    <ModalShell
      title="Enable the terminal?"
      kicker={<Badge variant="warn">Real shell · full account access</Badge>}
      onDismiss={leave}
      onSubmit={() => void enable()}
      footer={
        <>
          <Button variant="subtle" onClick={leave} disabled={enabling}>
            Not now
          </Button>
          <Button
            variant="primary"
            onClick={() => void enable()}
            disabled={enabling}
          >
            {enabling ? "Enabling…" : "Enable terminal"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ink-muted">
        <p>
          This opens a <strong className="text-ink">real shell</strong> running
          on your computer with your full user-account privileges — exactly like
          typing into your system terminal.
        </p>
        <p>
          Commands you run here can read, change, or delete your files and reach
          the network. The shell is{" "}
          <strong className="text-ink">not sandboxed</strong>, and Studio cannot
          contain what it does.
        </p>
        <p>
          The shell process is owned by Studio's main process (this window never
          holds a handle to it) and is killed when Studio quits. Enable it only
          if you understand and accept that.
        </p>
      </div>
    </ModalShell>
  );
}

// Feature 2 — the single connect / disconnect surface for Linear, reused by the
// Linear view (when unauthenticated) and the Settings → Integrations panel.
//
// Security contract (mirrors the main-side keychain storage):
//   - the API key is typed into a local, password-masked field only;
//   - it is forwarded ONCE to `linear.setApiKey` (via the store) and the field
//     is CLEARED on submit — the renderer never retains it;
//   - the key is never read back or persisted anywhere in the renderer; main
//     validates it, stores it in the OS keychain, and returns only non-secret
//     status. `disconnect` asks main to delete the stored key.

import { ExternalLink, KeyRound, Unplug } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Badge, Button, Spinner } from "@/components/ui";
import { useLinearStore } from "@/store/linear";
import { toast } from "@/store/toast";

/** Where users mint a personal API key (opened in the system browser). */
const API_KEY_URL = "https://linear.app/settings/api";

export function LinearConnectCard({ className }: { className?: string }) {
  const status = useLinearStore((s) => s.status);
  const connecting = useLinearStore((s) => s.connecting);
  const error = useLinearStore((s) => s.error);
  const connect = useLinearStore((s) => s.connect);
  const disconnect = useLinearStore((s) => s.disconnect);

  const [key, setKey] = useState("");
  const [rejected, setRejected] = useState(false);

  if (status?.status === "authenticated") {
    const viewer = status.viewer;
    return (
      <div className={className}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">Connected</Badge>
          <span className="min-w-0 truncate text-sm text-ink">
            {viewer
              ? viewer.organization
                ? `${viewer.name} · ${viewer.organization}`
                : viewer.name
              : "Linear account"}
          </span>
          <Button
            variant="warn"
            size="sm"
            className="ml-auto"
            disabled={connecting}
            onClick={() => {
              void disconnect().then(() => toast.info("Disconnected Linear"));
            }}
          >
            {connecting ? (
              <Spinner size={14} />
            ) : (
              <Unplug className="h-3.5 w-3.5" />
            )}
            Disconnect
          </Button>
        </div>
      </div>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed || connecting) return;
    // Clear the field before awaiting — the secret never lingers in state.
    setKey("");
    setRejected(false);
    const result = await connect(trimmed);
    if (result.status === "authenticated") {
      toast.success("Connected to Linear");
    } else {
      setRejected(true);
    }
  };

  return (
    <form onSubmit={onSubmit} className={className}>
      <label
        htmlFor="linear-api-key"
        className="mb-1.5 block text-xs font-medium text-ink-muted"
      >
        Linear API key
      </label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            id="linear-api-key"
            type="password"
            value={key}
            autoComplete="off"
            spellCheck={false}
            placeholder="lin_api_…"
            onChange={(e) => setKey(e.target.value)}
            disabled={connecting}
            className="w-full rounded-lg border border-border-subtle bg-bg-raised py-2 pl-8 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none disabled:opacity-50"
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          className="shrink-0"
          disabled={connecting || !key.trim()}
        >
          {connecting ? <Spinner size={14} /> : null}
          Connect
        </Button>
      </div>

      {rejected && (
        <p className="mt-2 text-xs text-danger">
          {error
            ? `Could not connect: ${error}`
            : "That key could not be verified. Check it and try again."}
        </p>
      )}

      <p className="mt-2 text-xs text-ink-muted">
        The key is stored securely by the app and never kept in the window.
      </p>
      <button
        type="button"
        onClick={() => void window.omp.openExternal(API_KEY_URL)}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
      >
        Get a personal API key
        <ExternalLink className="h-3 w-3" />
      </button>
    </form>
  );
}

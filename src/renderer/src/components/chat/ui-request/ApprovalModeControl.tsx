// Per-session approval control. Shows the session's approval mode (captured at
// spawn) as a compact pill and, on click, a panel listing the session-scoped
// "Always allow" rules with a way to revoke each. Rendered as a fixed chip by
// the UiRequestLayer so it never collides with the chat header/right-rail that
// other workers own. Approval mode is fixed at spawn (no runtime RPC setter),
// so this is a display + allowlist-management surface, not a mode switcher.

import type { ApprovalMode, ApprovalPolicy } from "@shared/rpc";
import { ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AllowRule } from "@/store/approvals";

const MODE_LABEL: Record<ApprovalMode, string> = {
  "always-ask": "Always ask",
  write: "Auto-approve writes",
  yolo: "Yolo — all tools",
};

const MODE_TONE: Record<ApprovalMode, string> = {
  "always-ask": "border-border-strong bg-bg-hover text-ink-muted",
  write: "border-warn/40 bg-warn/10 text-warn",
  yolo: "border-danger/40 bg-danger/10 text-danger",
};

export interface ApprovalModeControlProps {
  policy: ApprovalPolicy | undefined;
  rules: AllowRule[];
  onRevoke(key: string): void;
}

export function ApprovalModeControl({
  policy,
  rules,
  onRevoke,
}: ApprovalModeControlProps) {
  const [open, setOpen] = useState(false);
  const mode: ApprovalMode = policy?.mode ?? "always-ask";

  return (
    <div className="fixed bottom-4 left-4 z-40">
      {open && (
        <>
          {/* Click-away layer. */}
          <button
            type="button"
            aria-label="Close approval panel"
            className="fixed inset-0 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-full left-0 mb-2 w-72 animate-fade-in rounded-xl border border-border bg-bg-panel shadow-panel">
            <div className="border-b border-border-subtle px-3 py-2.5">
              <p className="text-xs font-semibold text-ink">
                Session approval mode
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {MODE_LABEL[mode]}
                {policy?.autoApprove ? " · auto-approve all" : ""}
              </p>
            </div>
            <div className="px-3 py-2.5">
              <p className="mb-1.5 text-xs font-medium text-ink-muted">
                Always-allowed this session
              </p>
              {rules.length === 0 ? (
                <p className="text-xs text-ink-faint">
                  No rules yet. Use “Always allow” on an approval to add one.
                </p>
              ) : (
                <ul className="scrollbar max-h-48 space-y-1 overflow-y-auto">
                  {rules.map((rule) => (
                    <li
                      key={rule.key}
                      className="flex items-center gap-2 rounded-md bg-bg-raised px-2 py-1"
                    >
                      <span
                        className="min-w-0 flex-1 truncate text-xs text-ink"
                        title={rule.label}
                      >
                        {rule.label}
                      </span>
                      <IconButton
                        label={`Revoke ${rule.label}`}
                        className="h-6 w-6"
                        onClick={() => onRevoke(rule.key)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Approval mode: ${MODE_LABEL[mode]}. ${rules.length} always-allow rule(s).`}
        className={cn(
          "relative inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-panel transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          MODE_TONE[mode],
        )}
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        {MODE_LABEL[mode]}
        {rules.length > 0 && (
          <span className="ml-0.5 rounded-full bg-accent/20 px-1.5 text-[10px] text-accent">
            {rules.length}
          </span>
        )}
      </button>
    </div>
  );
}

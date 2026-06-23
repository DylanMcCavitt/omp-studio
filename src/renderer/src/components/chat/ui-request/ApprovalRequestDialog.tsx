// Tool-approval dialog (method "confirm"). The safety-critical one: the default
// focused action and the Esc key are BOTH Deny, so a reflexive Enter/Escape
// never approves. Cmd/Ctrl+Enter is the explicit Approve-once accelerator.
// "Always allow for this session" is offered only when the request yields a
// stable structured key (see logic.approvalKey).

import type { ExtensionUiRequest, ExtensionUiResponse } from "@shared/rpc";
import { Badge, Button } from "@/components/ui";
import { asString } from "./logic";
import { ModalShell } from "./ModalShell";

export interface ApprovalRequestDialogProps {
  request: ExtensionUiRequest;
  onResolve(response: ExtensionUiResponse): void;
  /** Add the session allow rule and approve; only wired when canAlwaysAllow. */
  onAlwaysAllow(): void;
  canAlwaysAllow: boolean;
}

export function ApprovalRequestDialog({
  request,
  onResolve,
  onAlwaysAllow,
  canAlwaysAllow,
}: ApprovalRequestDialogProps) {
  return (
    <ModalShell
      title={asString(request.title) ?? "Approve this action?"}
      message={asString(request.message)}
      kicker={<Badge variant="warn">Approval required</Badge>}
      onDismiss={() => onResolve({ confirmed: false })}
      onSubmit={() => onResolve({ confirmed: true })}
      footer={
        <>
          <Button
            data-autofocus
            variant="danger"
            onClick={() => onResolve({ confirmed: false })}
          >
            Deny
          </Button>
          {canAlwaysAllow && (
            <Button variant="subtle" onClick={onAlwaysAllow}>
              Always allow
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => onResolve({ confirmed: true })}
          >
            Approve once
          </Button>
        </>
      }
    />
  );
}

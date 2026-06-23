// Tool-approval dialog. The safety-critical one: the default focused action and
// the Esc key are BOTH Deny, so a reflexive Enter/Escape never approves.
// Cmd/Ctrl+Enter is the explicit Approve-once accelerator. "Always allow for
// this session" is offered only when the request yields a stable key (see
// logic.approvalKey / approvalSelectKey). omp delivers tool approvals as either
// a `confirm` or an approval-shaped `select` (title `Allow tool: …`, options
// Approve/Deny); the layer routes both here and supplies `decide` so the right
// response shape ({confirmed} vs {value}) goes back on the wire.

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
  /**
   * Maps the Deny/Approve decision to the wire response. Defaults to the
   * `confirm` shape ({confirmed}); the layer overrides it for approval-shaped
   * `select` requests, whose reply is {value:"Approve"|"Deny"} instead — so the
   * same rich dialog backs both methods without knowing which it is serving.
   */
  decide?: (approved: boolean) => ExtensionUiResponse;
}

export function ApprovalRequestDialog({
  request,
  onResolve,
  onAlwaysAllow,
  canAlwaysAllow,
  decide = (approved) => ({ confirmed: approved }),
}: ApprovalRequestDialogProps) {
  return (
    <ModalShell
      title={asString(request.title) ?? "Approve this action?"}
      message={asString(request.message)}
      kicker={<Badge variant="warn">Approval required</Badge>}
      onDismiss={() => onResolve(decide(false))}
      onSubmit={() => onResolve(decide(true))}
      footer={
        <>
          <Button
            data-autofocus
            variant="danger"
            onClick={() => onResolve(decide(false))}
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
            onClick={() => onResolve(decide(true))}
          >
            Approve once
          </Button>
        </>
      }
    />
  );
}

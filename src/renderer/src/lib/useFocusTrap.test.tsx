// G2 — the shared focus-trap primitive, exercised through a representative
// dialog (the C3 approval dialog, which is built on ModalShell → useFocusTrap).
// Asserts the three behaviours every modal inherits: the default action takes
// focus on open, Tab/Shift+Tab cycle within the dialog (focus never escapes),
// and focus returns to the trigger when the dialog closes. Behaviour via roles
// and focus state only — never styling.

import type { ExtensionUiRequest } from "@shared/rpc";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ApprovalRequestDialog } from "@/components/chat/ui-request/ApprovalRequestDialog";

function approvalRequest(): ExtensionUiRequest {
  return { type: "extension_ui_request", id: "r1", method: "confirm" };
}

function Dialog() {
  return (
    <ApprovalRequestDialog
      request={approvalRequest()}
      onResolve={() => {}}
      onAlwaysAllow={() => {}}
      canAlwaysAllow={false}
    />
  );
}

describe("useFocusTrap (via the approval dialog)", () => {
  it("moves focus to the default action (Deny) on open", () => {
    render(<Dialog />);
    expect(screen.getByRole("button", { name: "Deny" })).toHaveFocus();
  });

  it("wraps Tab from the last control back to the first", () => {
    render(<Dialog />);
    const deny = screen.getByRole("button", { name: "Deny" });
    const approve = screen.getByRole("button", { name: "Approve once" });
    approve.focus();
    fireEvent.keyDown(approve, { key: "Tab" });
    expect(deny).toHaveFocus();
  });

  it("wraps Shift+Tab from the first control back to the last", () => {
    render(<Dialog />);
    const deny = screen.getByRole("button", { name: "Deny" });
    const approve = screen.getByRole("button", { name: "Approve once" });
    // Deny is the open default; Shift+Tab off it wraps to the last control.
    fireEvent.keyDown(deny, { key: "Tab", shiftKey: true });
    expect(approve).toHaveFocus();
  });

  it("restores focus to the trigger when the dialog closes", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && (
            <ApprovalRequestDialog
              request={approvalRequest()}
              onResolve={() => setOpen(false)}
              onAlwaysAllow={() => {}}
              canAlwaysAllow={false}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open" });
    // Focus the trigger, then open: the trap captures it as the restore target.
    trigger.focus();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Deny" })).toHaveFocus();
    // The Deny button denies/closes the dialog → focus returns to the trigger.
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(trigger).toHaveFocus();
  });
});

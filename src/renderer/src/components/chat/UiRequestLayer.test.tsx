// AGE-608 — the UiRequestLayer's approval routing. omp delivers a real tool
// approval as an Approve/Deny `select` (not a `confirm`), so the layer must
// route those to the rich ApprovalRequestDialog (Deny default-focus, danger/
// "Approval required" affordance, Always-allow) and map the chosen affordance
// back to the select's {value} response — while keeping every generic select on
// the plain SelectRequestDialog. We drive the REAL chat + approval stores (only
// the IPC-bound respondUi/dismissUiRequest are spied) and assert through roles
// and the exact ExtensionUiResponse posted, never styling.

import type { ChatUiRequestEvent } from "@shared/ipc";
import type { ExtensionUiRequest } from "@shared/rpc";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useApprovalStore } from "@/store/approvals";
import type { AllowRule } from "@/store/approvals";
import { useChatStore } from "@/store/chat";
import { createSession } from "@/store/session-reducer";
import { UiRequestLayer } from "./UiRequestLayer";

// Full store snapshots (state + real actions) captured before any test mutates
// them, so each test restarts from a clean slice with the real actions back.
const PRISTINE_CHAT = useChatStore.getState();
const PRISTINE_APPROVALS = useApprovalStore.getState();

beforeEach(() => {
  useChatStore.setState(
    { ...PRISTINE_CHAT, openSessions: {}, activeSessionId: null },
    true,
  );
  useApprovalStore.setState(
    { ...PRISTINE_APPROVALS, policies: {}, rulesBySession: {} },
    true,
  );
});

function selectReq(
  id: string,
  title: string,
  options: string[],
): ExtensionUiRequest {
  return { type: "extension_ui_request", id, method: "select", title, options };
}

function uiEvent(request: ExtensionUiRequest): ChatUiRequestEvent {
  return { sessionId: "s1", request, responseRequired: true };
}

/** Seed the active session's queue (+ optional allowlist) and spy the wire. */
function seed(events: ChatUiRequestEvent[], opts: { rules?: AllowRule[] } = {}) {
  const respondUi = vi.fn(async () => {});
  const dismissUiRequest = vi.fn();
  useChatStore.setState({
    openSessions: { s1: createSession("s1", { status: "idle", uiRequests: events }) },
    activeSessionId: "s1",
    respondUi,
    dismissUiRequest,
  });
  if (opts.rules) {
    useApprovalStore.setState({ rulesBySession: { s1: opts.rules } });
  }
  return { respondUi };
}

const APPROVAL_TITLE = "Allow tool: write\nPath: a.txt\nContent: ok";

describe("UiRequestLayer — approval-select routing", () => {
  it("renders an approval-shaped select with the rich dialog (Deny default, no listbox)", () => {
    seed([uiEvent(selectReq("r1", APPROVAL_TITLE, ["Approve", "Deny"]))]);
    render(<UiRequestLayer />);
    const dialog = screen.getByRole("dialog");
    // Rich approval affordances, NOT the generic select listbox.
    expect(within(dialog).getByText("Approval required")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Deny" })).toHaveFocus();
    expect(within(dialog).queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("maps Approve once → {value:'Approve'} on the matching select response", async () => {
    const user = userEvent.setup();
    const { respondUi } = seed([
      uiEvent(selectReq("r1", APPROVAL_TITLE, ["Approve", "Deny"])),
    ]);
    render(<UiRequestLayer />);
    await user.click(screen.getByRole("button", { name: "Approve once" }));
    expect(respondUi).toHaveBeenCalledWith({
      sessionId: "s1",
      requestId: "r1",
      response: { value: "Approve" },
    });
  });

  it("maps Deny → {value:'Deny'} on the matching select response", async () => {
    const user = userEvent.setup();
    const { respondUi } = seed([
      uiEvent(selectReq("r1", APPROVAL_TITLE, ["Approve", "Deny"])),
    ]);
    render(<UiRequestLayer />);
    await user.click(screen.getByRole("button", { name: "Deny" }));
    expect(respondUi).toHaveBeenCalledWith({
      sessionId: "s1",
      requestId: "r1",
      response: { value: "Deny" },
    });
  });

  it("keeps a GENERIC select on the plain SelectRequestDialog", async () => {
    const user = userEvent.setup();
    const { respondUi } = seed([
      uiEvent(selectReq("r1", "Pick a branch", ["alpha", "beta"])),
    ]);
    render(<UiRequestLayer />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("listbox")).toBeInTheDocument();
    expect(within(dialog).queryByText("Approval required")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Select" }));
    expect(respondUi).toHaveBeenCalledWith({
      sessionId: "s1",
      requestId: "r1",
      response: { value: "alpha" },
    });
  });

  it("Always allow records the session rule (title key) and approves", async () => {
    const user = userEvent.setup();
    const { respondUi } = seed([
      uiEvent(selectReq("r1", APPROVAL_TITLE, ["Approve", "Deny"])),
    ]);
    render(<UiRequestLayer />);
    await user.click(screen.getByRole("button", { name: "Always allow" }));
    expect(respondUi).toHaveBeenCalledWith({
      sessionId: "s1",
      requestId: "r1",
      response: { value: "Approve" },
    });
    const rules = useApprovalStore.getState().rulesBySession.s1;
    expect(rules?.[0]?.key).toBe(`approval-select:${APPROVAL_TITLE}`);
  });

  it("auto-approves an allowlisted select-approval with NO dialog", async () => {
    const title = "Allow tool: read Path: a.txt";
    const { respondUi } = seed(
      [uiEvent(selectReq("r1", title, ["Approve", "Deny"]))],
      {
        rules: [
          { key: `approval-select:${title}`, label: title, createdAt: 1 },
        ],
      },
    );
    render(<UiRequestLayer />);
    // Suppressed: it resolves on the wire without ever showing a modal.
    await waitFor(() =>
      expect(respondUi).toHaveBeenCalledWith({
        sessionId: "s1",
        requestId: "r1",
        response: { value: "Approve" },
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

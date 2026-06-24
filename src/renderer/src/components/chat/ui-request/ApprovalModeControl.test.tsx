// AGE-686 — the approval-mode chip moved out of the viewport-`fixed`
// UiRequestLayer overlay (where it collided with the left sidebar footer / panel
// dock) into the chat header as a self-contained, store-connected chip. These
// pin the behavior the new placement must keep: it reflects the active session's
// approval mode + always-allow count, opens a dropdown listing the session
// allowlist, revokes a rule, closes on click-away, and renders nothing without a
// live session. We drive the REAL chat + approval stores and assert through
// roles/text, never styling or position.

import type { ApprovalPolicy } from "@shared/rpc";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AllowRule } from "@/store/approvals";
import { useApprovalStore } from "@/store/approvals";
import { useChatStore } from "@/store/chat";
import type { ChatStatus } from "@/store/session-reducer";
import { createSession } from "@/store/session-reducer";
import { ApprovalModeControl } from "./ApprovalModeControl";

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

/** Seed an active session (+ optional policy / allowlist) like a live chat. */
function seed(
  opts: {
    status?: ChatStatus;
    policy?: ApprovalPolicy;
    rules?: AllowRule[];
  } = {},
) {
  useChatStore.setState({
    openSessions: {
      s1: createSession("s1", { status: opts.status ?? "idle" }),
    },
    activeSessionId: "s1",
  });
  if (opts.policy) useApprovalStore.setState({ policies: { s1: opts.policy } });
  if (opts.rules) {
    useApprovalStore.setState({ rulesBySession: { s1: opts.rules } });
  }
}

const rule = (key: string, label: string): AllowRule => ({
  key,
  label,
  createdAt: 1,
});

describe("ApprovalModeControl — header chip (AGE-686)", () => {
  it("reflects the active session's approval mode and always-allow count", () => {
    seed({
      policy: { mode: "yolo", autoApprove: true },
      rules: [rule("k1", "write a.txt")],
    });
    render(<ApprovalModeControl />);
    expect(
      screen.getByRole("button", {
        name: /Approval mode: Yolo — all tools\. 1 always-allow rule/,
      }),
    ).toHaveTextContent("Yolo — all tools");
  });

  it("falls back to Always ask when the session has no captured policy", () => {
    seed();
    render(<ApprovalModeControl />);
    expect(
      screen.getByRole("button", { name: /Approval mode: Always ask/ }),
    ).toBeInTheDocument();
  });

  it("opens a dropdown listing the session allowlist and revokes a rule", async () => {
    const user = userEvent.setup();
    seed({
      policy: { mode: "write", autoApprove: false },
      rules: [rule("k1", "write a.txt"), rule("k2", "read b.txt")],
    });
    render(<ApprovalModeControl />);

    // Closed: the rules panel is not mounted yet.
    expect(screen.queryByText("Always-allowed this session")).toBeNull();

    await user.click(
      screen.getByRole("button", {
        name: /Approval mode: Auto-approve writes/,
      }),
    );
    expect(screen.getByText("Always-allowed this session")).toBeInTheDocument();
    expect(screen.getByText("write a.txt")).toBeInTheDocument();
    expect(screen.getByText("read b.txt")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Revoke write a.txt" }),
    );

    // Revoked from the store and removed from the open dropdown.
    expect(
      useApprovalStore.getState().rulesBySession.s1?.map((r) => r.key),
    ).toEqual(["k2"]);
    expect(screen.queryByText("write a.txt")).toBeNull();
    expect(screen.getByText("read b.txt")).toBeInTheDocument();
  });

  it("shows the empty hint when the session has no rules, and closes on click-away", async () => {
    const user = userEvent.setup();
    seed({ policy: { mode: "always-ask", autoApprove: false } });
    render(<ApprovalModeControl />);

    await user.click(screen.getByRole("button", { name: /Approval mode/ }));
    const panel = screen.getByText("Always-allowed this session").parentElement;
    expect(
      within(panel as HTMLElement).getByText(/No rules yet/),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Close approval panel" }),
    );
    expect(screen.queryByText("Always-allowed this session")).toBeNull();
  });

  it("renders nothing without an active session", () => {
    const { container } = render(<ApprovalModeControl />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing once the session has exited", () => {
    seed({ status: "exited", policy: { mode: "yolo", autoApprove: true } });
    const { container } = render(<ApprovalModeControl />);
    expect(container).toBeEmptyDOMElement();
  });
});

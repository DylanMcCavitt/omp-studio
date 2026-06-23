// C3 — blocking extension UI-request dialogs. These assert the safety-critical
// behaviour the PRD pins down: the approval dialog defaults focus to Deny and
// answers reflexive Esc/Enter as a denial, while the explicit Cmd/Ctrl+Enter
// accelerator approves; and that select/input/editor produce {value} on submit
// and {cancelled} on dismiss. We pass `onResolve` directly (the layer wires it
// to the store's respondUi), so we verify the exact ExtensionUiResponse shape
// each interaction yields via role queries + user-event — never styling.

import type { ExtensionUiMethod, ExtensionUiRequest } from "@shared/rpc";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApprovalRequestDialog } from "./ApprovalRequestDialog";
import { EditorRequestDialog } from "./EditorRequestDialog";
import { InputRequestDialog } from "./InputRequestDialog";
import { SelectRequestDialog } from "./SelectRequestDialog";

function makeRequest(
  method: ExtensionUiMethod,
  extra: Record<string, unknown> = {},
): ExtensionUiRequest {
  return {
    type: "extension_ui_request",
    id: "req-1",
    method,
    ...extra,
  };
}

/** A response callback fired exactly once with the given ExtensionUiResponse. */
function expectCalledOnceWith(mock: ReturnType<typeof vi.fn>, arg: unknown) {
  expect(mock).toHaveBeenCalledTimes(1);
  expect(mock).toHaveBeenCalledWith(arg);
}

describe("ApprovalRequestDialog", () => {
  it("focuses Deny by default — never the approve action", () => {
    render(
      <ApprovalRequestDialog
        request={makeRequest("confirm", { title: "Run rm -rf?" })}
        onResolve={vi.fn()}
        onAlwaysAllow={vi.fn()}
        canAlwaysAllow={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Deny" })).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Approve once" }),
    ).not.toHaveFocus();
  });

  it("denies on Escape with {confirmed:false}", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <ApprovalRequestDialog
        request={makeRequest("confirm")}
        onResolve={onResolve}
        onAlwaysAllow={vi.fn()}
        canAlwaysAllow={false}
      />,
    );
    await user.keyboard("{Escape}");
    expectCalledOnceWith(onResolve, { confirmed: false });
  });

  it("denies on a reflexive Enter (focused Deny) — never approves", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <ApprovalRequestDialog
        request={makeRequest("confirm")}
        onResolve={onResolve}
        onAlwaysAllow={vi.fn()}
        canAlwaysAllow={false}
      />,
    );
    // Deny is the focused default; a reflexive Enter activates it (deny).
    await user.keyboard("{Enter}");
    expect(onResolve).toHaveBeenCalledWith({ confirmed: false });
    expect(onResolve).not.toHaveBeenCalledWith({ confirmed: true });
  });

  it("approves only on the explicit Cmd/Ctrl+Enter accelerator", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <ApprovalRequestDialog
        request={makeRequest("confirm")}
        onResolve={onResolve}
        onAlwaysAllow={vi.fn()}
        canAlwaysAllow={false}
      />,
    );
    // The accelerator lives on the dialog; focus it so a button's native Enter
    // activation can't shadow the modifier shortcut.
    screen.getByRole("dialog").focus();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expectCalledOnceWith(onResolve, { confirmed: true });
  });

  it("approves when Approve once is clicked", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <ApprovalRequestDialog
        request={makeRequest("confirm")}
        onResolve={onResolve}
        onAlwaysAllow={vi.fn()}
        canAlwaysAllow={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Approve once" }));
    expectCalledOnceWith(onResolve, { confirmed: true });
  });

  it("offers Always allow only when canAlwaysAllow, wiring it to onAlwaysAllow", async () => {
    const user = userEvent.setup();
    const onAlwaysAllow = vi.fn();
    const { rerender } = render(
      <ApprovalRequestDialog
        request={makeRequest("confirm")}
        onResolve={vi.fn()}
        onAlwaysAllow={onAlwaysAllow}
        canAlwaysAllow={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Always allow" }),
    ).not.toBeInTheDocument();

    rerender(
      <ApprovalRequestDialog
        request={makeRequest("confirm")}
        onResolve={vi.fn()}
        onAlwaysAllow={onAlwaysAllow}
        canAlwaysAllow={true}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Always allow" }));
    expect(onAlwaysAllow).toHaveBeenCalledOnce();
  });
});

describe("SelectRequestDialog", () => {
  const options = ["alpha", "beta", "gamma"];

  it("focuses the listbox and submits the arrowed option as {value}", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <SelectRequestDialog
        request={makeRequest("select", { title: "Pick one", options })}
        onResolve={onResolve}
      />,
    );
    const listbox = screen.getByRole("listbox", { name: "Pick one" });
    expect(listbox).toHaveFocus();
    // Down once highlights "beta"; Enter submits it.
    await user.keyboard("{ArrowDown}{Enter}");
    expectCalledOnceWith(onResolve, { value: "beta" });
  });

  it("reflects the highlight via aria-selected as you arrow", async () => {
    const user = userEvent.setup();
    render(
      <SelectRequestDialog
        request={makeRequest("select", { options })}
        onResolve={vi.fn()}
      />,
    );
    const opts = screen.getAllByRole("option");
    expect(opts[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(opts[0]).toHaveAttribute("aria-selected", "false");
    expect(opts[1]).toHaveAttribute("aria-selected", "true");
  });

  it("submits the highlighted option via the Select button", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <SelectRequestDialog
        request={makeRequest("select", { options })}
        onResolve={onResolve}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Select" }));
    expectCalledOnceWith(onResolve, { value: "alpha" });
  });

  it("cancels on Escape with {cancelled:true}", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <SelectRequestDialog
        request={makeRequest("select", { options })}
        onResolve={onResolve}
      />,
    );
    await user.keyboard("{Escape}");
    expectCalledOnceWith(onResolve, { cancelled: true });
  });
});

describe("InputRequestDialog", () => {
  it("returns the typed text as {value} on submit", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <InputRequestDialog
        request={makeRequest("input", { placeholder: "branch name" })}
        onResolve={onResolve}
      />,
    );
    const field = screen.getByPlaceholderText("branch name");
    expect(field).toHaveFocus();
    await user.type(field, "feature/x");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expectCalledOnceWith(onResolve, { value: "feature/x" });
  });

  it("submits on Enter within the field", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <InputRequestDialog
        request={makeRequest("input")}
        onResolve={onResolve}
      />,
    );
    await user.type(screen.getByRole("textbox"), "hello{Enter}");
    expectCalledOnceWith(onResolve, { value: "hello" });
  });

  it("cancels with {cancelled:true} on the Cancel button and on Escape", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    const { rerender } = render(
      <InputRequestDialog
        request={makeRequest("input")}
        onResolve={onResolve}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onResolve).toHaveBeenLastCalledWith({ cancelled: true });

    onResolve.mockClear();
    rerender(
      <InputRequestDialog
        request={makeRequest("input")}
        onResolve={onResolve}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onResolve).toHaveBeenLastCalledWith({ cancelled: true });
  });
});

describe("EditorRequestDialog", () => {
  it("prefills the textarea and submits the edited text as {value} on Cmd/Ctrl+Enter", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <EditorRequestDialog
        request={makeRequest("editor", { prefill: "line one" })}
        onResolve={onResolve}
      />,
    );
    const area = screen.getByRole("textbox");
    expect(area).toHaveValue("line one");
    await user.type(area, " edited");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expectCalledOnceWith(onResolve, { value: "line one edited" });
  });

  it("submits via the Submit button", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <EditorRequestDialog
        request={makeRequest("editor", { prefill: "draft" })}
        onResolve={onResolve}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expectCalledOnceWith(onResolve, { value: "draft" });
  });

  it("cancels with {cancelled:true} on Escape", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <EditorRequestDialog
        request={makeRequest("editor")}
        onResolve={onResolve}
      />,
    );
    await user.keyboard("{Escape}");
    expectCalledOnceWith(onResolve, { cancelled: true });
  });
});

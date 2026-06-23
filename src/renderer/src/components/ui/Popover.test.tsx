// AGE-612 §3 — the Popover primitive's dismissal mechanics (useDismiss): opens
// from its trigger, closes on Escape with focus returned to the trigger, and
// closes on an outside pointer click. Behaviour + roles only.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover } from "./Popover";

function Harness() {
  return (
    <Popover
      trigger={({ open, toggle, triggerRef }) => (
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          onClick={toggle}
        >
          Open
        </button>
      )}
    >
      <p>Popover body</p>
    </Popover>
  );
}

it("opens from the trigger and renders its content", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  expect(screen.queryByText("Popover body")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Open" }));
  expect(screen.getByText("Popover body")).toBeInTheDocument();
});

it("closes on Escape and returns focus to the trigger", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  const trigger = screen.getByRole("button", { name: "Open" });
  await user.click(trigger);
  expect(screen.getByText("Popover body")).toBeInTheDocument();

  await user.keyboard("{Escape}");
  expect(screen.queryByText("Popover body")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("closes on an outside pointer click", async () => {
  const user = userEvent.setup();
  render(
    <div>
      <Harness />
      <button type="button">Outside</button>
    </div>,
  );

  await user.click(screen.getByRole("button", { name: "Open" }));
  expect(screen.getByText("Popover body")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Outside" }));
  expect(screen.queryByText("Popover body")).not.toBeInTheDocument();
});

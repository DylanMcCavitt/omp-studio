// AGE-671 — the shared per-workspace color controls. The picker is the user's
// set/change/clear surface (Add dialog + Manage row); the dot is the at-a-glance
// indicator. Assertions go through roles + the inline swatch, never exact hex.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceColorDot, WorkspaceColorPicker } from "./WorkspaceColor";

it("WorkspaceColorPicker reports the chosen palette key", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<WorkspaceColorPicker value={undefined} onChange={onChange} />);

  await user.click(screen.getByRole("button", { name: "Blue" }));

  expect(onChange).toHaveBeenCalledWith("blue");
});

it("WorkspaceColorPicker clears the color via the No color option", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<WorkspaceColorPicker value="blue" onChange={onChange} />);

  await user.click(screen.getByRole("button", { name: "No color" }));

  expect(onChange).toHaveBeenCalledWith(undefined);
});

it("WorkspaceColorPicker marks the active selection as pressed", () => {
  render(<WorkspaceColorPicker value="green" onChange={() => {}} />);

  expect(screen.getByRole("button", { name: "Green" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "No color" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

it("WorkspaceColorDot paints an inline swatch for a color and stays hollow when unset", () => {
  const { container, rerender } = render(<WorkspaceColorDot color="red" />);
  expect((container.firstChild as HTMLElement).style.backgroundColor).not.toBe(
    "",
  );

  rerender(<WorkspaceColorDot color={undefined} />);
  expect((container.firstChild as HTMLElement).style.backgroundColor).toBe("");
});

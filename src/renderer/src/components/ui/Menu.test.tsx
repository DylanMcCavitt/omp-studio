// AGE-612 §3 — the Menu primitive built on Popover. Verifies it opens into a
// `role="menu"` list of items, runs an item's handler, and closes afterward.
// Behaviour + roles only.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Menu, MenuItem, MenuSeparator } from "./Menu";

function Harness({ onPick = () => {} }: { onPick?: (id: string) => void }) {
  return (
    <Menu
      aria-label="Actions"
      trigger={({ open, toggle, triggerRef }) => (
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          onClick={toggle}
        >
          Actions
        </button>
      )}
    >
      <MenuItem onClick={() => onPick("rename")}>Rename</MenuItem>
      <MenuSeparator />
      <MenuItem onClick={() => onPick("delete")}>Delete</MenuItem>
    </Menu>
  );
}

it("opens into a menu listing its items", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  await user.click(screen.getByRole("button", { name: "Actions" }));
  expect(screen.getByRole("menu", { name: "Actions" })).toBeInTheDocument();
  expect(screen.getAllByRole("menuitem")).toHaveLength(2);
});

it("runs an item handler then closes the menu", async () => {
  const onPick = vi.fn();
  const user = userEvent.setup();
  render(<Harness onPick={onPick} />);

  await user.click(screen.getByRole("button", { name: "Actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Delete" }));

  expect(onPick).toHaveBeenCalledWith("delete");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

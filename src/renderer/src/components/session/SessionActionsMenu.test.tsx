import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionActionsMenu } from "./SessionActionsMenu";

it("preserves trigger aria/tabIndex while using the shared icon button", async () => {
  const user = userEvent.setup();
  render(
    <SessionActionsMenu
      triggerTabIndex={-1}
      target={{
        path: "/tmp/session.jsonl",
        title: "Build UI",
        archived: false,
      }}
    />,
  );

  const trigger = screen.getByRole("button", { name: "Session actions" });
  expect(trigger.tabIndex).toBe(-1);
  expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  expect(trigger).toHaveAttribute("aria-expanded", "false");

  await user.click(trigger);

  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(
    screen.getByRole("menu", { name: "Session actions" }),
  ).toBeInTheDocument();
});

it("renders delete affordances with warn styling, not danger red", async () => {
  const user = userEvent.setup();
  render(
    <SessionActionsMenu
      target={{
        path: "/tmp/session.jsonl",
        title: "Build UI",
        archived: false,
      }}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Session actions" }));
  const deleteItem = screen.getByRole("menuitem", { name: "Delete…" });
  expect(deleteItem.className).toContain("hover:bg-warn/10");
  expect(deleteItem.className).toContain("text-ink");
  expect(deleteItem.className).not.toContain("text-danger");
  await user.click(deleteItem);

  const dialog = screen.getByRole("alertdialog", { name: "Delete session" });
  expect(dialog.className).toContain("border-warn/40");
  expect(dialog.className).not.toContain("border-danger");
  expect(
    within(dialog).getByRole("button", { name: "Delete" }).className,
  ).toContain("bg-warn/10");
});

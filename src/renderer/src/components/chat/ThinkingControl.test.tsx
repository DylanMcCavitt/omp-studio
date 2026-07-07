// AGE-666 / AGE-776 — the inline header thinking-level picker. The behaviours
// that matter: the compact trigger explicitly labels the active reasoning level,
// opening lists the six levels, and choosing one reports it. Verified through
// roles + the onChange callback; the menu is pure prop-driven UI (no bridge calls).

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThinkingControl } from "./ThinkingControl";

it("shows the active reasoning label on the trigger", () => {
  render(<ThinkingControl level="medium" onChange={vi.fn()} />);
  const trigger = screen.getByRole("button", { name: "Reasoning: Medium" });

  expect(trigger).toBeInTheDocument();
  expect(trigger).toHaveTextContent("Reasoning: Medium");
});

it("opens the menu and lists every level", async () => {
  const user = userEvent.setup();
  render(<ThinkingControl level="medium" onChange={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Reasoning: Medium" }));

  for (const name of ["Off", "Minimal", "Low", "Medium", "High", "Xhigh"]) {
    expect(screen.getByRole("menuitem", { name })).toBeInTheDocument();
  }
});

it("reports the chosen level and not the others", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<ThinkingControl level="medium" onChange={onChange} />);

  await user.click(screen.getByRole("button", { name: "Reasoning: Medium" }));
  await user.click(screen.getByRole("menuitem", { name: "High" }));

  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith("high");
});

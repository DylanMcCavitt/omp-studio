import { render, screen } from "@testing-library/react";
import { Button } from "./Button";

it("renders warn as a tinted yellow action with ink text", () => {
  render(<Button variant="warn">Warn action</Button>);

  const button = screen.getByRole("button", { name: "Warn action" });
  expect(button.className).toContain("border-warn/40");
  expect(button.className).toContain("bg-warn/10");
  expect(button.className).toContain("text-ink");
  expect(button.className).toContain("hover:bg-warn/20");
});

it("keeps danger available for true error/destructive red semantics", () => {
  render(<Button variant="danger">Danger action</Button>);

  const button = screen.getByRole("button", { name: "Danger action" });
  expect(button.className).toContain("bg-danger/10");
  expect(button.className).toContain("text-danger");
  expect(button.className).toContain("hover:bg-danger/20");
});

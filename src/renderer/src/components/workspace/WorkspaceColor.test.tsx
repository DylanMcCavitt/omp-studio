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
  const dot = container.firstChild as HTMLElement;
  expect(dot.style.backgroundColor).not.toBe("");
  // Identity mode (no status) keeps today's 10px Tailwind size with no inline
  // override, so the five existing callers stay visually unchanged (AC5).
  expect(dot.className).toContain("h-2.5");
  expect(dot.className).toContain("w-2.5");
  expect(dot.style.width).toBe("");

  rerender(<WorkspaceColorDot color={undefined} />);
  expect((container.firstChild as HTMLElement).style.backgroundColor).toBe("");
});

it("WorkspaceColorDot running fill: solid swatch + pulse ring in the glow", () => {
  const { container } = render(
    <WorkspaceColorDot color="blue" status="running" />,
  );
  const dot = container.firstChild as HTMLElement;
  expect(dot.getAttribute("data-status")).toBe("running");
  expect(dot.className).toContain("animate-omp-pulse");
  expect(dot.style.backgroundColor).not.toBe("");
  // The pulse keyframe reads the per-workspace glow off this custom property.
  expect(dot.style.getPropertyValue("--omp-glow")).toMatch(/^rgba\(/);
});

it("WorkspaceColorDot idle fill: hollow inset ring, no solid background", () => {
  const { container } = render(
    <WorkspaceColorDot color="blue" status="idle" />,
  );
  const dot = container.firstChild as HTMLElement;
  expect(dot.getAttribute("data-status")).toBe("idle");
  expect(dot.className).not.toContain("animate-omp-pulse");
  expect(dot.style.boxShadow).toContain("inset");
  expect(dot.style.backgroundColor).toBe("");
});

it("WorkspaceColorDot done fill: solid swatch faded to .3", () => {
  const { container } = render(
    <WorkspaceColorDot color="blue" status="done" />,
  );
  const dot = container.firstChild as HTMLElement;
  expect(dot.getAttribute("data-status")).toBe("done");
  expect(dot.style.backgroundColor).not.toBe("");
  expect(dot.style.opacity).toBe("0.3");
});

it("WorkspaceColorDot status dots default to 8px and honor a size override", () => {
  const { container, rerender } = render(
    <WorkspaceColorDot color="blue" status="running" />,
  );
  expect((container.firstChild as HTMLElement).style.width).toBe("8px");
  rerender(<WorkspaceColorDot color="blue" status="idle" size={7} />);
  expect((container.firstChild as HTMLElement).style.width).toBe("7px");
});

it("WorkspaceColorDot falls back to identity rendering when status has no color", () => {
  const { container } = render(
    <WorkspaceColorDot color={undefined} status="running" />,
  );
  const dot = container.firstChild as HTMLElement;
  expect(dot.getAttribute("data-status")).toBeNull();
  expect(dot.className).not.toContain("animate-omp-pulse");
  // No hue to paint → hollow ring, but the requested status size still applies.
  expect(dot.className).toContain("border-border-strong");
  expect(dot.style.width).toBe("8px");
  expect(dot.style.backgroundColor).toBe("");
});

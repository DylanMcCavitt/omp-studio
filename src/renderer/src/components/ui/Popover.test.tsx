// AGE-612 §3 — the Popover primitive's dismissal mechanics (useDismiss): opens
// from its trigger, closes on Escape with focus returned to the trigger, and
// closes on an outside pointer click. Behaviour + roles only.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover } from "./Popover";

function PortalHarness() {
  return (
    <Popover
      contentClassName="w-72"
      placement="auto"
      portal
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

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    bottom: y + height,
    height,
    left: x,
    right: x + width,
    top: y,
    width,
    x,
    y,
    toJSON: () => ({}),
  } as DOMRect;
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

function mockRects({
  contentHeight,
  contentWidth,
  triggerX,
  triggerY,
}: {
  contentHeight: number;
  contentWidth: number;
  triggerX: number;
  triggerY: number;
}) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function getBoundingClientRect(this: HTMLElement) {
      if (this instanceof HTMLButtonElement && this.textContent === "Open") {
        return rect(triggerX, triggerY, 80, 28);
      }
      if (this.textContent?.includes("Popover body")) {
        return rect(0, 0, contentWidth, contentHeight);
      }
      return rect(0, 0, 0, 0);
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

it("portals and flips above the trigger near the viewport bottom", async () => {
  const user = userEvent.setup();
  setViewport(800, 600);
  mockRects({
    contentHeight: 300,
    contentWidth: 288,
    triggerX: 100,
    triggerY: 560,
  });
  render(<PortalHarness />);

  await user.click(screen.getByRole("button", { name: "Open" }));

  const panel = screen.getByText("Popover body", {
    selector: "p",
  }).parentElement;
  expect(panel).not.toBeNull();
  await waitFor(() =>
    expect(panel).toHaveStyle({
      left: "100px",
      top: "256px",
    }),
  );
  expect(panel).toHaveClass("fixed");
  expect(panel).toHaveStyle({ minWidth: "80px" });
});

it("clamps portaled content inside the right viewport edge", async () => {
  const user = userEvent.setup();
  setViewport(800, 600);
  mockRects({
    contentHeight: 200,
    contentWidth: 288,
    triggerX: 760,
    triggerY: 100,
  });
  render(<PortalHarness />);

  await user.click(screen.getByRole("button", { name: "Open" }));

  const panel = screen.getByText("Popover body", {
    selector: "p",
  }).parentElement;
  expect(panel).not.toBeNull();
  await waitFor(() =>
    expect(panel).toHaveStyle({
      left: "504px",
      top: "132px",
    }),
  );
  expect(panel).toHaveClass("fixed");
});

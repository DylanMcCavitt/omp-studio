// G2 — the app render error boundary. Verifies a thrown render error shows the
// fallback (not a blank screen), Reset-to-dashboard fires onReset and recovers,
// Copy-error writes the message to the clipboard, and a changed resetKey clears a
// caught error. A child that only throws when told lets us toggle the crash.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";

function Boom({ crash }: { crash: boolean }): JSX.Element {
  if (crash) throw new Error("kaboom");
  return <div>healthy view</div>;
}

describe("AppErrorBoundary", () => {
  it("renders children when there is no error", () => {
    render(
      <AppErrorBoundary>
        <Boom crash={false} />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("healthy view")).toBeInTheDocument();
  });

  it("shows the fallback (with the message) instead of crashing", () => {
    // Suppress React's expected error console noise for this case.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <Boom crash={true} />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("kaboom")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("Reset to dashboard invokes onReset", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onReset = vi.fn();
    render(
      <AppErrorBoundary onReset={onReset}>
        <Boom crash={true} />
      </AppErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset to dashboard" }));
    expect(onReset).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("Copy error writes the message to the clipboard", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <AppErrorBoundary>
        <Boom crash={true} />
      </AppErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy error" }));
    expect(writeText).toHaveBeenCalled();
    expect(String(writeText.mock.calls[0]?.[0])).toContain("kaboom");
    spy.mockRestore();
  });

  it("clears the caught error when resetKey changes", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <AppErrorBoundary resetKey="chat">
        <Boom crash={true} />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Navigate away (resetKey changes) and render a healthy child.
    rerender(
      <AppErrorBoundary resetKey="dashboard">
        <Boom crash={false} />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("healthy view")).toBeInTheDocument();
    spy.mockRestore();
  });
});

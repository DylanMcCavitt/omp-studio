import { describe, expect, it } from "vitest";
import { terminalDotStatus } from "./terminal-dot-status";

describe("terminalDotStatus — Live Dot fill for the workspace tab", () => {
  it("idle when no terminal tabs exist yet", () => {
    expect(terminalDotStatus({ creating: false, hasEntries: false })).toBe(
      "idle",
    );
  });

  it("running while a tab is being created", () => {
    expect(terminalDotStatus({ creating: true, hasEntries: false })).toBe(
      "running",
    );
  });

  it("running for a live shell", () => {
    expect(
      terminalDotStatus({
        creating: false,
        hasEntries: true,
        activeExited: false,
      }),
    ).toBe("running");
  });

  it("done when the active shell has exited", () => {
    expect(
      terminalDotStatus({
        creating: false,
        hasEntries: true,
        activeExited: true,
      }),
    ).toBe("done");
  });
});

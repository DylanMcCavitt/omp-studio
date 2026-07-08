import { describe, expect, it } from "vitest";
import { terminalDotStatus } from "./terminal-dot-status";

describe("terminalDotStatus — Live Dot fill for the workspace tab", () => {
  it("idle when no terminal tabs exist yet", () => {
    expect(terminalDotStatus({ creating: false, entries: [] })).toBe("idle");
  });

  it("running while a tab is being created", () => {
    expect(terminalDotStatus({ creating: true, entries: [] })).toBe("running");
  });

  it("running for a live shell", () => {
    expect(
      terminalDotStatus({ creating: false, entries: [{ exited: false }] }),
    ).toBe("running");
  });

  it("done when every shell has exited", () => {
    expect(
      terminalDotStatus({
        creating: false,
        entries: [{ exited: true }, { exited: true }],
      }),
    ).toBe("done");
  });

  it("running when the active tab exited but another shell is live", () => {
    // Aggregation across tabs: any live pty keeps the dot running even if the
    // tab the user is looking at has exited.
    expect(
      terminalDotStatus({
        creating: false,
        entries: [{ exited: true }, { exited: false }],
      }),
    ).toBe("running");
  });

  it("done for all-exited tabs regardless of a stale active-tab id", () => {
    // The helper never consults the active id, so a stale selection cannot
    // misreport a running shell when every entry has exited.
    expect(
      terminalDotStatus({ creating: false, entries: [{ exited: true }] }),
    ).toBe("done");
  });
});

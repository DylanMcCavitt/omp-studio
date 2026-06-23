import { describe, expect, test } from "bun:test";
import {
  approvalKey,
  approvalSelectKey,
  approvalSelectShape,
  asString,
  classifyUiRequest,
  collectResponseRequiredTimeouts,
  isAllowed,
  isSelectApprovalAllowed,
  partitionUiRequests,
} from "../src/renderer/src/components/chat/ui-request/logic";
import type { ChatUiRequestEvent } from "../src/shared/ipc";
import type { ExtensionUiMethod, ExtensionUiRequest } from "../src/shared/rpc";

// The pipeline logic is pure and DOM-free, so we drive it with plain request
// objects. ExtensionUiRequest is deliberately loose (`[key: string]: unknown`),
// so partial fixtures exercise exactly the fields each branch reads.

function req(
  method: ExtensionUiMethod,
  extra: Record<string, unknown> = {},
  id = `${method}-1`,
): ExtensionUiRequest {
  return {
    type: "extension_ui_request",
    id,
    method,
    ...extra,
  } as ExtensionUiRequest;
}

function ev(
  request: ExtensionUiRequest,
  responseRequired = true,
  sessionId = "s1",
): ChatUiRequestEvent {
  return { sessionId, request, responseRequired };
}

describe("classifyUiRequest", () => {
  test("modal methods route to the dialog layer", () => {
    for (const m of ["confirm", "select", "input", "editor"] as const) {
      expect(classifyUiRequest(req(m))).toBe("modal");
    }
  });

  test("cancel and open_url get their own kinds", () => {
    expect(classifyUiRequest(req("cancel", { targetId: "x" }))).toBe("cancel");
    expect(classifyUiRequest(req("open_url", { url: "https://x" }))).toBe(
      "open_url",
    );
  });

  test("passive methods are hints", () => {
    for (const m of [
      "notify",
      "setStatus",
      "setWidget",
      "setTitle",
      "set_editor_text",
    ] as const) {
      expect(classifyUiRequest(req(m))).toBe("hint");
    }
  });
});

describe("approvalKey", () => {
  test("requires a structured tool identity + argument signature", () => {
    expect(
      approvalKey(
        req("confirm", { toolName: "bash", arguments: { cmd: "ls" } }),
      ),
    ).toBe('tool:bash:{"cmd":"ls"}');
  });

  test("argument signature is order-independent (stable across key order)", () => {
    const a = approvalKey(
      req("confirm", { toolName: "edit", arguments: { b: 2, a: 1 } }),
    );
    const b = approvalKey(
      req("confirm", { toolName: "edit", arguments: { a: 1, b: 2 } }),
    );
    expect(a).toBe(b);
  });

  test("NEVER keys on a prose title (no leak between same-titled actions)", () => {
    // A generic/shared title must not become a stable allow key.
    expect(approvalKey(req("confirm", { title: "Run command" }))).toBeNull();
    expect(approvalKey(req("confirm", { title: "Confirm" }))).toBeNull();
  });

  test("is null when there is no tool identity at all", () => {
    expect(approvalKey(req("confirm", { message: "Continue?" }))).toBeNull();
  });
});

describe("isAllowed", () => {
  const keys = new Set(['tool:bash:{"cmd":"ls"}']);

  test("matches an allowlisted confirm by its structured key", () => {
    expect(
      isAllowed(
        keys,
        req("confirm", { toolName: "bash", arguments: { cmd: "ls" } }),
      ),
    ).toBe(true);
  });

  test("rejects the same tool with different arguments", () => {
    expect(
      isAllowed(
        keys,
        req("confirm", { toolName: "bash", arguments: { cmd: "rm" } }),
      ),
    ).toBe(false);
  });

  test("never auto-approves a prose-titled confirm (no key)", () => {
    const titleKeys = new Set(["confirm:Run command"]);
    expect(isAllowed(titleKeys, req("confirm", { title: "Run command" }))).toBe(
      false,
    );
  });

  test("never auto-approves a non-confirm method", () => {
    expect(
      isAllowed(
        keys,
        req("select", { toolName: "bash", arguments: { cmd: "ls" } }),
      ),
    ).toBe(false);
  });
});

describe("partitionUiRequests", () => {
  test("splits a mixed queue and picks the oldest response-required modal", () => {
    const queue: ChatUiRequestEvent[] = [
      ev(req("notify", { message: "hi" }, "n1"), false),
      ev(req("confirm", { title: "Approve?" }, "c1")),
      ev(req("input", { title: "Branch" }, "i1")),
      ev(req("open_url", { url: "https://x" }, "u1"), false),
      ev(req("cancel", { targetId: "c1" }, "x1")),
    ];
    const p = partitionUiRequests(queue);
    expect(p.modal?.request.id).toBe("c1");
    expect(p.hints.map((h) => h.request.id)).toEqual(["n1"]);
    expect(p.openUrls.map((o) => o.request.id)).toEqual(["u1"]);
    expect(p.cancels.map((c) => c.request.id)).toEqual(["x1"]);
  });

  test("ignores a modal method that is not response-required", () => {
    const queue: ChatUiRequestEvent[] = [
      ev(req("confirm", { title: "Approve?" }, "c1"), false),
    ];
    expect(partitionUiRequests(queue).modal).toBeNull();
  });

  test("an empty queue produces empty buckets", () => {
    const p = partitionUiRequests([]);
    expect(p.modal).toBeNull();
    expect(p.hints).toEqual([]);
    expect(p.openUrls).toEqual([]);
    expect(p.cancels).toEqual([]);
  });
});

describe("collectResponseRequiredTimeouts", () => {
  test("collects response-required requests across ALL sessions", () => {
    const openSessions = {
      s1: {
        uiRequests: [
          ev(req("confirm", { timeout: 1000 }, "c1"), true, "s1"),
          ev(req("notify", { message: "hi" }, "n1"), false, "s1"),
        ],
      },
      s2: {
        uiRequests: [ev(req("input", {}, "i1"), true, "s2")],
      },
    };
    const out = collectResponseRequiredTimeouts(openSessions, 300_000);
    expect(out).toEqual([
      { sessionId: "s1", requestId: "c1", timeoutMs: 1000 },
      { sessionId: "s2", requestId: "i1", timeoutMs: 300_000 },
    ]);
  });

  test("uses the default when timeout is missing or invalid", () => {
    const openSessions = {
      s1: {
        uiRequests: [
          ev(req("confirm", { timeout: 0 }, "c1"), true, "s1"),
          ev(req("editor", { timeout: -5 }, "e1"), true, "s1"),
        ],
      },
    };
    const out = collectResponseRequiredTimeouts(openSessions, 42);
    expect(out.map((p) => p.timeoutMs)).toEqual([42, 42]);
  });

  test("skips non-response-required hints", () => {
    const openSessions = {
      s1: {
        uiRequests: [ev(req("open_url", { url: "x" }, "u1"), false, "s1")],
      },
    };
    expect(collectResponseRequiredTimeouts(openSessions, 1000)).toEqual([]);
  });
});

describe("asString", () => {
  test("returns trimmed-non-empty strings and rejects everything else", () => {
    expect(asString("ok")).toBe("ok");
    expect(asString("   ")).toBeUndefined();
    expect(asString(42)).toBeUndefined();
    expect(asString(undefined)).toBeUndefined();
  });
});

// omp surfaces a tool approval as a `select` (title `Allow tool: …`, options
// ["Approve","Deny"]) — verified against the agent runtime — not a `confirm`.
// These cover the detection + key derivation that route it to the rich dialog.

// The canonical omp approval-select frame: only method/title/options, no
// structured tool identity.
const approvalReq = (title = "Allow tool: write\nPath: a.txt\nContent: ok") =>
  req("select", { title, options: ["Approve", "Deny"] });

describe("approvalSelectShape", () => {
  test("resolves the canonical Approve/Deny select", () => {
    expect(approvalSelectShape(approvalReq())).toEqual({
      approve: "Approve",
      deny: "Deny",
    });
  });

  test("is order-independent (Deny listed first)", () => {
    expect(
      approvalSelectShape(req("select", { options: ["Deny", "Approve"] })),
    ).toEqual({ approve: "Approve", deny: "Deny" });
  });

  test("matches option labels case-insensitively, echoing the EXACT strings", () => {
    // The response must echo omp's own option string verbatim, so the resolved
    // approve/deny keep their original casing even when matched loosely.
    expect(
      approvalSelectShape(req("select", { options: ["approve", "DENY"] })),
    ).toEqual({ approve: "approve", deny: "DENY" });
  });

  test("is null for a generic (non-approval) select", () => {
    expect(
      approvalSelectShape(req("select", { options: ["alpha", "beta"] })),
    ).toBeNull();
  });

  test("is null for a 3+ option select even if it contains Approve/Deny", () => {
    // A richer multi-choice must stay generic so its extra option is never
    // dropped behind a two-button approval dialog.
    expect(
      approvalSelectShape(
        req("select", { options: ["Approve", "Deny", "Maybe"] }),
      ),
    ).toBeNull();
  });

  test("is null when options are missing or not a string array", () => {
    expect(approvalSelectShape(req("select", {}))).toBeNull();
    expect(
      approvalSelectShape(req("select", { options: "Approve" })),
    ).toBeNull();
  });

  test("is null for a non-select method", () => {
    expect(
      approvalSelectShape(req("confirm", { options: ["Approve", "Deny"] })),
    ).toBeNull();
  });
});

describe("approvalSelectKey", () => {
  test("keys an approval-select on its action-specific title", () => {
    expect(approvalSelectKey(approvalReq("Allow tool: read Path: a.txt"))).toBe(
      "approval-select:Allow tool: read Path: a.txt",
    );
  });

  test("distinct titles (different args) produce distinct keys", () => {
    expect(
      approvalSelectKey(approvalReq("Allow tool: write Path: a.txt")),
    ).not.toBe(approvalSelectKey(approvalReq("Allow tool: write Path: b.txt")));
  });

  test("prefers a structured tool key when the frame carries one", () => {
    // Forward-compatible: an omp that adds toolName/arguments keys on those.
    expect(
      approvalSelectKey(
        req("select", {
          options: ["Approve", "Deny"],
          title: "Allow tool: bash",
          toolName: "bash",
          arguments: { cmd: "ls" },
        }),
      ),
    ).toBe('tool:bash:{"cmd":"ls"}');
  });

  test("is null for a non-approval select", () => {
    expect(
      approvalSelectKey(req("select", { title: "Pick", options: ["a", "b"] })),
    ).toBeNull();
  });

  test("is null for an approval-select with no title to key on", () => {
    expect(
      approvalSelectKey(req("select", { options: ["Approve", "Deny"] })),
    ).toBeNull();
  });
});

describe("isSelectApprovalAllowed", () => {
  const keys = new Set(["approval-select:Allow tool: read Path: a.txt"]);

  test("auto-approves an allowlisted approval-select by its title key", () => {
    expect(
      isSelectApprovalAllowed(
        keys,
        approvalReq("Allow tool: read Path: a.txt"),
      ),
    ).toBe(true);
  });

  test("rejects the same tool with different args (different title)", () => {
    expect(
      isSelectApprovalAllowed(
        keys,
        approvalReq("Allow tool: read Path: b.txt"),
      ),
    ).toBe(false);
  });

  test("never auto-approves a generic select", () => {
    expect(
      isSelectApprovalAllowed(keys, req("select", { options: ["a", "b"] })),
    ).toBe(false);
  });
});

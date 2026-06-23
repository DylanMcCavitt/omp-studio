import { beforeEach, expect, test } from "bun:test";
import { useApprovalStore } from "../src/renderer/src/store/approvals";

// The approval store holds renderer-only UI state (per-session policy + the
// always-allow list). Its actions are pure store transitions, so we drive them
// through getState() without React.

beforeEach(() => {
  useApprovalStore.setState({ policies: {}, rulesBySession: {} });
});

test("setPolicy records a session's spawn-time approval policy", () => {
  useApprovalStore
    .getState()
    .setPolicy("s1", { mode: "write", autoApprove: false });
  expect(useApprovalStore.getState().policies.s1).toEqual({
    mode: "write",
    autoApprove: false,
  });
});

test("addRule appends and dedupes by key", () => {
  const { addRule } = useApprovalStore.getState();
  addRule("s1", { key: "confirm:Run", label: "Run", createdAt: 1 });
  addRule("s1", { key: "confirm:Run", label: "Run again", createdAt: 2 });
  addRule("s1", { key: "confirm:Edit", label: "Edit", createdAt: 3 });
  const rules = useApprovalStore.getState().rulesBySession.s1 ?? [];
  expect(rules.map((r) => r.key)).toEqual(["confirm:Run", "confirm:Edit"]);
  // The first rule wins; a duplicate key never overwrites its label.
  expect(rules[0]?.label).toBe("Run");
});

test("revokeRule removes one rule by key", () => {
  const { addRule, revokeRule } = useApprovalStore.getState();
  addRule("s1", { key: "a", label: "A", createdAt: 1 });
  addRule("s1", { key: "b", label: "B", createdAt: 2 });
  revokeRule("s1", "a");
  expect(
    (useApprovalStore.getState().rulesBySession.s1 ?? []).map((r) => r.key),
  ).toEqual(["b"]);
});

test("prune drops policy + rules for sessions that are no longer open", () => {
  const s = useApprovalStore.getState();
  s.setPolicy("s1", { mode: "always-ask", autoApprove: false });
  s.setPolicy("s2", { mode: "yolo", autoApprove: true });
  s.addRule("s1", { key: "a", label: "A", createdAt: 1 });
  s.addRule("s2", { key: "b", label: "B", createdAt: 2 });

  s.prune(["s2"]);

  const after = useApprovalStore.getState();
  expect(Object.keys(after.policies)).toEqual(["s2"]);
  expect(Object.keys(after.rulesBySession)).toEqual(["s2"]);
});

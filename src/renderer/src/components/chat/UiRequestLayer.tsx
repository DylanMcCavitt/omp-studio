// The visible layer of the extension UI-request pipeline (C3). Mounted once at
// the ChatWorkspace root (so it survives session switches within the chat
// route), it reads the ACTIVE session's `uiRequests` queue from the store and:
//   - renders the oldest response-required request as a focused modal dialog
//     (confirm/select/input/editor), responding via the store's respondUi so the
//     correct {confirmed}|{value}|{cancelled} shape reaches the originating child;
//   - auto-approves a confirm whose stable key is on the session allowlist
//     ("Always allow for this session") instead of re-prompting;
//   - dismisses a request when the agent sends a `cancel` for it;
//   - surfaces passive hints as toasts and open_url as an explicit-action banner;
//   - drops the modal when the session exits or a request's timeout elapses
//     (there is no settled event from the bridge — orphan handling is derived);
//   - shows a per-session approval-mode control with the allowlist + revoke.
//
// All UI renders through fixed-position overlays / portals, so the only edit to
// ChatWorkspace is the single mount — no collision with the header/right-rail
// that other workers own.

import type { ChatUiRequestEvent } from "@shared/ipc";
import type { ExtensionUiResponse } from "@shared/rpc";
import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { NO_RULES, useApprovalStore } from "@/store/approvals";
import { useActiveSession, useChatStore } from "@/store/chat";
import { ApprovalModeControl } from "./ui-request/ApprovalModeControl";
import { ApprovalRequestDialog } from "./ui-request/ApprovalRequestDialog";
import { EditorRequestDialog } from "./ui-request/EditorRequestDialog";
import { InputRequestDialog } from "./ui-request/InputRequestDialog";
import {
  approvalKey,
  asString,
  collectResponseRequiredTimeouts,
  isAllowed,
  partitionUiRequests,
} from "./ui-request/logic";
import { SelectRequestDialog } from "./ui-request/SelectRequestDialog";
import { UiHints } from "./ui-request/UiHints";

/** Stable empty queue so the no-active-session selector keeps a steady ref. */
const NO_UI: ChatUiRequestEvent[] = [];

// Mirror of the bridge's fail-closed backstop (rpc-session.ts). Used only to
// drop a stale modal when a request without its own timeout elapses; the bridge
// independently answers the child, so we never write a response on timeout.
const DEFAULT_UI_REQUEST_TIMEOUT_MS = 300_000;

export function UiRequestLayer() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const uiRequests = useActiveSession((s) => s?.uiRequests ?? NO_UI);
  const status = useActiveSession((s) => s?.status ?? "idle");
  const respondUi = useChatStore((s) => s.respondUi);
  const dismissUi = useChatStore((s) => s.dismissUiRequest);

  // Approval state for the active session (policy display + allowlist).
  const policy = useApprovalStore((s) =>
    activeSessionId ? s.policies[activeSessionId] : undefined,
  );
  const rules = useApprovalStore((s) =>
    activeSessionId
      ? (s.rulesBySession[activeSessionId] ?? NO_RULES)
      : NO_RULES,
  );
  const addRule = useApprovalStore((s) => s.addRule);
  const revokeRule = useApprovalStore((s) => s.revokeRule);
  const prune = useApprovalStore((s) => s.prune);

  // Prune approval state for sessions that are no longer open (close ≠ delete,
  // but a closed session's allowlist should not linger).
  const openSessionIds = useChatStore(
    useShallow((s) => Object.keys(s.openSessions)),
  );
  useEffect(() => {
    prune(openSessionIds);
  }, [openSessionIds, prune]);

  const allowKeys = useMemo(() => new Set(rules.map((r) => r.key)), [rules]);

  const { modal, hints, openUrls, cancels } = useMemo(
    () => partitionUiRequests(uiRequests),
    [uiRequests],
  );

  // A confirm already covered by the session allowlist is auto-approved without
  // ever rendering a dialog (computed synchronously so the modal never flashes).
  const suppressed =
    modal !== null &&
    modal.request.method === "confirm" &&
    isAllowed(allowKeys, modal.request);

  // Tracks request ids already auto-resolved (auto-approve / cancel handling) so
  // a re-render never double-fires the side effect.
  const handledRef = useRef<Set<string>>(new Set());

  // Per-request fail-closed timeout timers, keyed by request id across all
  // sessions (managed by the cross-session timeout sweeper effect below).
  const timeoutTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Auto-approve allowlisted confirms.
  useEffect(() => {
    if (!modal || !suppressed) return;
    const id = modal.request.id;
    if (handledRef.current.has(id)) return;
    handledRef.current.add(id);
    void respondUi({
      sessionId: modal.sessionId,
      requestId: id,
      response: { confirmed: true },
    });
  }, [modal, suppressed, respondUi]);

  // Honor `cancel` requests: drop the targeted request (the agent withdrew it)
  // and ack the cancel itself, both with a cancelled response.
  useEffect(() => {
    for (const event of cancels) {
      const cancelId = event.request.id;
      if (handledRef.current.has(cancelId)) continue;
      handledRef.current.add(cancelId);
      const targetId = asString(event.request.targetId);
      if (targetId) {
        void respondUi({
          sessionId: event.sessionId,
          requestId: targetId,
          response: { cancelled: true },
        });
      }
      void respondUi({
        sessionId: event.sessionId,
        requestId: cancelId,
        response: { cancelled: true },
      });
    }
  }, [cancels, respondUi]);

  // Orphan handling — exit: when the session's child is gone there is no one to
  // answer, so drop every pending request locally (the bridge already cleared
  // its pending map without writing a fail-closed frame). Read the queue from
  // the store so this depends on the exit transition, not on every dequeue.
  useEffect(() => {
    if (status !== "exited" || !activeSessionId) return;
    const queue =
      useChatStore.getState().openSessions[activeSessionId]?.uiRequests ?? [];
    for (const event of queue) {
      dismissUi(activeSessionId, event.request.id);
    }
  }, [status, activeSessionId, dismissUi]);

  // Orphan handling — timeout, across ALL sessions (not just the active modal).
  // Each response-required request fail-closes on the bridge after its timeout,
  // but the bridge writes only to the child; without this a background
  // session's request would leave a dangling modal on switch. We arm one timer
  // per request when first observed and clear it once the request resolves.
  // Subscribing imperatively (not via render) keeps this independent of which
  // session is active.
  useEffect(() => {
    const timers = timeoutTimersRef.current;
    const reconcile = () => {
      const pending = collectResponseRequiredTimeouts(
        useChatStore.getState().openSessions,
        DEFAULT_UI_REQUEST_TIMEOUT_MS,
      );
      const present = new Set<string>();
      for (const { sessionId, requestId, timeoutMs } of pending) {
        present.add(requestId);
        if (timers.has(requestId)) continue;
        const timer = setTimeout(() => {
          timers.delete(requestId);
          useChatStore.getState().dismissUiRequest(sessionId, requestId);
        }, timeoutMs);
        timers.set(requestId, timer);
      }
      for (const [id, timer] of timers) {
        if (present.has(id)) continue;
        clearTimeout(timer);
        timers.delete(id);
      }
    };
    reconcile();
    const unsubscribe = useChatStore.subscribe(reconcile);
    return () => {
      unsubscribe();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const renderModal = () => {
    if (!modal) return null;
    const resolve = (response: ExtensionUiResponse) =>
      void respondUi({
        sessionId: modal.sessionId,
        requestId: modal.request.id,
        response,
      });
    switch (modal.request.method) {
      case "confirm": {
        const key = approvalKey(modal.request);
        return (
          <ApprovalRequestDialog
            request={modal.request}
            onResolve={resolve}
            canAlwaysAllow={key !== null}
            onAlwaysAllow={() => {
              if (key && activeSessionId) {
                // A rule only exists when a tool key exists, so the label is
                // the tool identity (with its title as a readable suffix).
                const tool =
                  asString(modal.request.toolName) ??
                  asString(modal.request.tool) ??
                  "tool";
                const title = asString(modal.request.title);
                const label = title ? `${tool} — ${title}` : tool;
                addRule(activeSessionId, { key, label, createdAt: Date.now() });
              }
              resolve({ confirmed: true });
            }}
          />
        );
      }
      case "select":
        return (
          <SelectRequestDialog request={modal.request} onResolve={resolve} />
        );
      case "input":
        return (
          <InputRequestDialog request={modal.request} onResolve={resolve} />
        );
      case "editor":
        return (
          <EditorRequestDialog request={modal.request} onResolve={resolve} />
        );
      default:
        return null;
    }
  };

  const showModal = modal !== null && !suppressed && status !== "exited";

  return (
    <>
      {showModal && renderModal()}
      <UiHints
        hints={hints}
        openUrls={openUrls}
        onDismiss={(id) => {
          if (activeSessionId) dismissUi(activeSessionId, id);
        }}
        onOpenUrl={(url, id) => {
          void window.omp.openExternal(url);
          if (activeSessionId) dismissUi(activeSessionId, id);
        }}
      />
      {activeSessionId && status !== "exited" && (
        <ApprovalModeControl
          policy={policy}
          rules={rules}
          onRevoke={(key) => revokeRule(activeSessionId, key)}
        />
      )}
    </>
  );
}

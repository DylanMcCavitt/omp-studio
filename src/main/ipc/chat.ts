// Bridges the renderer's `window.omp.chat` surface to live `OmpRpcSession`
// instances held by the SessionRegistry. Every chat command is request/response
// over `ipcMain.handle`. Frame, lifecycle, and extension-UI-request streams are
// pushed to the renderer over `evt:rpc` / `evt:lifecycle` / `evt:ui-request`;
// the renderer answers UI requests back over `chat:uiRespond`.

import type {
  ChatCreateOptions,
  ChatCreateResult,
  ChatLifecycleEvent,
  ChatRpcEvent,
  ChatUiRequestEvent,
  ChatUiRespondPayload,
  OpenSessionDescriptor,
  PromptOptions,
} from "@shared/ipc";
import { CH } from "@shared/ipc";
import type {
  ExtensionUiRequest,
  RpcFrame,
  SubagentSubscriptionLevel,
  ThinkingLevel,
} from "@shared/rpc";
import type { BrowserWindow, IpcMain } from "electron";
import type { SessionRegistry } from "../omp/registry";
import type { OmpRpcSession } from "../omp/rpc-session";
import { containedSessionFile } from "../services/session-paths";
import { sendToWindow } from "./send";

export function registerChatIpc(
  ipcMain: IpcMain,
  registry: SessionRegistry,
  getWindow: () => BrowserWindow | null,
): void {
  const handle = <Args extends unknown[], Result>(
    channel: string,
    fn: (...args: Args) => Promise<Result> | Result,
  ): void => {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      try {
        return await fn(...(args as Args));
      } catch (error) {
        // Surface a clean message across the IPC boundary instead of "[object Object]".
        throw error instanceof Error ? error : new Error(String(error));
      }
    });
  };

  const lookup = (id: string) => {
    const session = registry.get(id);
    if (!session) throw new Error("unknown session");
    return session;
  };

  // Push a session's frame / lifecycle / extension-UI-request streams to the
  // renderer. Shared by create and resume so a resumed child streams exactly
  // like a freshly created one. All sends go through sendToWindow: these fire
  // from child stdio and can outlive the window (close/reload) — a destroyed
  // WebContents must drop the event, not throw.
  const forward = (id: string, session: OmpRpcSession) => {
    session.on("frame", (frame: RpcFrame) =>
      sendToWindow(getWindow, CH.evtRpc, {
        sessionId: id,
        frame,
      } satisfies ChatRpcEvent),
    );
    session.on(
      "lifecycle",
      (status: ChatLifecycleEvent["status"], detail?: string) =>
        sendToWindow(getWindow, CH.evtLifecycle, {
          sessionId: id,
          status,
          detail,
        } satisfies ChatLifecycleEvent),
    );
    // Forward every extension UI request (modal-required and passive hints
    // alike, incl. open_url) to the renderer; C3 owns the dialogs/hints and the
    // explicit open-url action. Matches the frame/lifecycle sender above.
    session.on(
      "ui-request",
      (payload: { request: ExtensionUiRequest; responseRequired: boolean }) =>
        sendToWindow(getWindow, CH.evtUiRequest, {
          sessionId: id,
          request: payload.request,
          responseRequired: payload.responseRequired,
        } satisfies ChatUiRequestEvent),
    );
  };

  handle(CH.chatCreate, async (opts: ChatCreateOptions) => {
    // Forward only the known create fields — never spread the raw renderer
    // payload, so an extra prop (e.g. a `binary` override) can't reach the
    // session spawn. registry.create has no other spawn-config sink.
    const { id, session, state } = await registry.create({
      cwd: opts.cwd,
      model: opts.model,
      thinkingLevel: opts.thinkingLevel,
      approvalPolicy: opts.approvalPolicy,
    });
    forward(id, session);
    return { sessionId: id, state } satisfies ChatCreateResult;
  });

  handle(CH.chatPrompt, (id: string, message: string, opts?: PromptOptions) =>
    lookup(id).prompt(message, opts),
  );
  handle(CH.chatSteer, (id: string, message: string) =>
    lookup(id).steer(message),
  );
  handle(CH.chatFollowUp, (id: string, message: string) =>
    lookup(id).followUp(message),
  );
  handle(CH.chatAbort, (id: string) => lookup(id).abort());
  handle(CH.chatSetModel, (id: string, provider: string, modelId: string) =>
    lookup(id).setModel(provider, modelId),
  );
  handle(CH.chatSetThinking, (id: string, level: ThinkingLevel) =>
    lookup(id).setThinking(level),
  );
  handle(CH.chatGetState, (id: string) => lookup(id).getState());
  handle(CH.chatGetMessages, (id: string) => lookup(id).getMessages());
  handle(CH.chatGetSubagents, (id: string) => lookup(id).getSubagents());
  // Feature 4: subagent drill-in transcript + optional per-session subscription
  // control. getSubagentMessages path-contains a renderer-supplied sessionFile
  // under sessionsDir() before the child reads it; both degrade on an older omp
  // build (the session methods swallow Unknown-command failures).
  handle(
    CH.chatGetSubagentMessages,
    (
      id: string,
      sel: { subagentId?: string; sessionFile?: string; fromByte?: number },
    ) => {
      const session = lookup(id);
      if (sel.sessionFile === undefined)
        return session.getSubagentMessages(sel);
      return session.getSubagentMessages({
        ...sel,
        sessionFile: containedSessionFile(sel.sessionFile),
      });
    },
  );
  handle(
    CH.chatSetSubagentSubscription,
    (id: string, level: SubagentSubscriptionLevel) =>
      lookup(id).setSubagentSubscription(level),
  );
  // Feature 6b: per-session slash-command palette snapshot. Live updates arrive
  // as forwarded available_commands_update frames; this is the on-demand read at
  // view open / resume. Degrades to [] on an older omp build (the session method
  // swallows the Unknown-command failure). Per-session only — no global channel.
  handle(CH.chatGetAvailableCommands, (id: string) =>
    lookup(id).getAvailableCommands(),
  );
  // E2: session stats + compaction. getSessionStats degrades to empty stats on
  // an omp build without the command; compact resolves when compaction finishes
  // while live auto-compaction progress streams via the session's frames.
  handle(CH.chatGetSessionStats, (id: string) => lookup(id).getSessionStats());
  handle(CH.chatCompact, (id: string, instructions?: string) =>
    lookup(id).compact(instructions),
  );
  handle(CH.chatDispose, (id: string) => registry.dispose(id));
  // E1: list persisted/open descriptors, resume a hibernated chat, and close
  // (hibernate) a live chat. These sit alongside C2's ui-request handlers.
  handle(CH.chatList, () => registry.descriptors());
  handle(CH.chatResume, async (raw: OpenSessionDescriptor) => {
    const { id, session, state } = await registry.resume(
      sanitizeResumeDescriptor(raw),
    );
    forward(id, session);
    return { sessionId: id, state } satisfies ChatCreateResult;
  });
  handle(CH.chatClose, (id: string) => registry.hibernate(id));
  // Route a renderer UI-request response back to the originating child. Safe
  // no-op when the session is gone (disposed/exited) so a late or orphaned
  // reply never throws across IPC.
  handle(CH.chatRespondUi, (payload: ChatUiRespondPayload) => {
    registry
      .get(payload.sessionId)
      ?.respondUi(payload.requestId, payload.response);
  });
}

// Rebuild a renderer-supplied resume descriptor from KNOWN fields only (the
// chat:create pattern: never spread the raw payload, so junk keys neither reach
// the spawn config nor get persisted back into settings) and contain its
// sessionFile under sessionsDir() BEFORE it can drive an `omp --resume` spawn.
// A descriptor whose transcript path escapes the sessions root is hostile or
// corrupt — rejected here, at the IPC boundary.
function sanitizeResumeDescriptor(
  raw: OpenSessionDescriptor,
): OpenSessionDescriptor {
  const descriptor: OpenSessionDescriptor = {
    studioSessionId: raw.studioSessionId,
    cwd: raw.cwd,
    createdAt: raw.createdAt,
    lastActiveAt: raw.lastActiveAt,
    title: raw.title,
    approvalPolicy: {
      mode: raw.approvalPolicy.mode,
      autoApprove: raw.approvalPolicy.autoApprove,
    },
    status: raw.status,
  };
  if (raw.model !== undefined) descriptor.model = raw.model;
  if (raw.thinkingLevel !== undefined)
    descriptor.thinkingLevel = raw.thinkingLevel;
  if (raw.ompSessionId !== undefined) {
    // `omp --resume` accepts a transcript PATH or a session id. The path arm
    // is contained below, so the id arm must never be path-shaped — otherwise
    // a hostile descriptor could smuggle an arbitrary file to the child
    // through the id field. omp ids are opaque tokens; allow only a strict
    // token alphabet (no separators, no dots-only forms).
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(raw.ompSessionId)) {
      throw new Error("ompSessionId is not a valid omp session id");
    }
    descriptor.ompSessionId = raw.ompSessionId;
  }
  if (raw.sessionFile !== undefined) {
    descriptor.sessionFile = containedSessionFile(raw.sessionFile);
  }
  return descriptor;
}

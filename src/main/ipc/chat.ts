// Bridges the renderer's `window.omp.chat` surface to live `OmpRpcSession`
// instances held by the SessionRegistry. Every chat command is request/response
// over `ipcMain.handle`. Frame, lifecycle, and extension-UI-request streams are
// pushed to the renderer over `evt:rpc` / `evt:lifecycle` / `evt:ui-request`;
// the renderer answers UI requests back over `chat:uiRespond`.

import { realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
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
import { sessionsDir } from "../paths";

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
  // like a freshly created one.
  const forward = (id: string, session: OmpRpcSession) => {
    session.on("frame", (frame: RpcFrame) =>
      getWindow()?.webContents.send(CH.evtRpc, {
        sessionId: id,
        frame,
      } satisfies ChatRpcEvent),
    );
    session.on(
      "lifecycle",
      (status: ChatLifecycleEvent["status"], detail?: string) =>
        getWindow()?.webContents.send(CH.evtLifecycle, {
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
        getWindow()?.webContents.send(CH.evtUiRequest, {
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
  handle(CH.chatResume, async (descriptor: OpenSessionDescriptor) => {
    const { id, session, state } = await registry.resume(descriptor);
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

// Reject a renderer-supplied sessionFile that resolves outside sessionsDir().
// A live drill-in transcript path always lives under the sessions root (it
// comes from get_subagents / subagent lifecycle frames), so anything escaping
// it is a malformed or hostile request and must never reach the child reader.
//
// The check is on the CANONICAL (symlink-resolved) paths, not the lexical ones:
// a symlink planted under the sessions root that points outside it would slip
// past a plain resolve()+relative() check, so both the root and the candidate
// are realpath'd first. Returns the contained real path; throws otherwise.
function containedSessionFile(sessionFile: string): string {
  const root = canonicalize(sessionsDir());
  const real = canonicalize(sessionFile);
  const rel = relative(root, real);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("sessionFile escapes the sessions directory");
  }
  return real;
}

// Resolve a path to its real, symlink-free absolute form. When the target does
// not exist yet, canonicalize the nearest existing ancestor and re-append the
// remainder — so a symlinked ANCESTOR still cannot smuggle the path out of tree
// (realpathSync resolves the ancestor link). A dangling leaf symlink falls back
// to the lexical path, but reading through it just fails ENOENT — no data leak.
function canonicalize(path: string): string {
  let current = resolve(path);
  const tail: string[] = [];
  for (;;) {
    try {
      return tail.length === 0
        ? realpathSync(current)
        : join(realpathSync(current), ...tail);
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

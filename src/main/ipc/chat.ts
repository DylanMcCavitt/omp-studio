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
  PromptOptions,
} from "@shared/ipc";
import { CH } from "@shared/ipc";
import type { ExtensionUiRequest, RpcFrame, ThinkingLevel } from "@shared/rpc";
import type { BrowserWindow, IpcMain } from "electron";
import type { SessionRegistry } from "../omp/registry";

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
  handle(CH.chatDispose, (id: string) => registry.dispose(id));
  // Route a renderer UI-request response back to the originating child. Safe
  // no-op when the session is gone (disposed/exited) so a late or orphaned
  // reply never throws across IPC.
  handle(CH.chatRespondUi, (payload: ChatUiRespondPayload) => {
    registry
      .get(payload.sessionId)
      ?.respondUi(payload.requestId, payload.response);
  });
}

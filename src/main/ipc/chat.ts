// Bridges the renderer's `window.omp.chat` surface to live `OmpRpcSession`
// instances held by the SessionRegistry. Every chat command is request/response
// over `ipcMain.handle`; frame + lifecycle streams are pushed to the renderer's
// window over `evt:rpc` / `evt:lifecycle`.

import type {
  ChatCreateOptions,
  ChatCreateResult,
  ChatLifecycleEvent,
  ChatRpcEvent,
  PromptOptions,
} from "@shared/ipc";
import { CH } from "@shared/ipc";
import type { RpcFrame, ThinkingLevel } from "@shared/rpc";
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
    const { id, session, state } = await registry.create(opts);
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
}

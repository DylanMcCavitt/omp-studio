// Bridges the renderer's `window.omp.terminal` surface to the main-process
// TerminalRegistry. create/write/resize/kill/list are request/response over
// ipcMain.handle; each live pty's coalesced output and exit are pushed to the
// renderer over evt:terminal-data / evt:terminal-exit (mirrors chat.ts's
// per-session forward()).
//
// A pty is a real shell with full user privileges — the single largest
// capability jump vs the read-only data services. Input therefore only ever
// originates from the local terminal view via terminal:write; it is NEVER
// auto-fed from agent output, evt:rpc frames, or remote content.

import { CH, type ExternalTerminalProfile } from "@shared/ipc";
import type { BrowserWindow, IpcMain } from "electron";
import type { ExternalTerminalLaunchers } from "../terminal/external-launchers";
import type { PtySession } from "../terminal/pty-session";
import type { TerminalRegistry } from "../terminal/registry";

export function registerTerminalIpc(
  ipcMain: IpcMain,
  registry: TerminalRegistry,
  externalTerminals: ExternalTerminalLaunchers,
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
        // Surface a clean message across IPC instead of "[object Object]".
        throw error instanceof Error ? error : new Error(String(error));
      }
    });
  };

  // Push one pty's data/exit streams to the renderer. Called when a terminal is
  // created so a freshly spawned pty streams immediately. The registry already
  // drops the session from its map on "exit"; this only forwards the events.
  const forward = (session: PtySession): void => {
    session.on("data", (data: string) =>
      getWindow()?.webContents.send(CH.evtTerminalData, {
        id: session.id,
        data,
      }),
    );
    session.on("exit", (code: number | null) =>
      getWindow()?.webContents.send(CH.evtTerminalExit, {
        id: session.id,
        code,
      }),
    );
  };

  handle(
    CH.terminalCreate,
    async (opts: { cwd: string; cols: number; rows: number }) => {
      const session = await registry.create(opts);
      forward(session);
      return session.info;
    },
  );
  // resize/kill no-op on an unknown id: the renderer may race a call against
  // an exit it has not processed yet, so a late call must never throw. write
  // goes through the registry's gated path: capability re-checked in main on
  // EVERY write and the payload shape/size-validated before any pty sees it.
  handle(CH.terminalWrite, (id: string, data: string) =>
    registry.write(id, data),
  );
  handle(CH.terminalResize, (id: string, cols: number, rows: number) => {
    registry.get(id)?.resize(cols, rows);
  });
  handle(CH.terminalKill, (id: string) => {
    registry.get(id)?.kill();
  });
  handle(CH.terminalList, () => registry.list());
  handle(CH.terminalExternalLaunchers, () => externalTerminals.list());
  handle(
    CH.terminalOpenExternal,
    (opts: { cwd: string; profile?: ExternalTerminalProfile }) =>
      externalTerminals.open(opts),
  );
}

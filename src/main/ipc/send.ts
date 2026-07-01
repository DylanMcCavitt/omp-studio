// The one safe path for pushing a main-process event to the renderer.
//
// Every event forwarder (chat frames/lifecycle/ui-requests, terminal
// data/exit, browser view state) fires from async sources — child process
// output, pty callbacks, WebContents events — that can outlive the window.
// Sending to a destroyed WebContents throws ("Object has been destroyed"),
// so every forwarder funnels through this guard instead of calling
// `webContents.send` directly.

import type { BrowserWindow } from "electron";

/**
 * Send `payload` on `channel` iff the window and its WebContents are still
 * alive. A missing or destroyed target drops the event silently — the
 * renderer that would have consumed it is gone (closing/reloading), and every
 * consumer surface re-hydrates from main-owned state on mount.
 */
export function sendToWindow(
  getWindow: () => BrowserWindow | null,
  channel: string,
  payload: unknown,
): void {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  const contents = win.webContents;
  if (!contents || contents.isDestroyed()) return;
  contents.send(channel, payload);
}

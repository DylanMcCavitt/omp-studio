import { expect, test } from "bun:test";
import type { BrowserWindow } from "electron";
import { sendToWindow } from "../src/main/ipc/send";
import { CH } from "../src/shared/ipc";

// sendToWindow is the shared safe event egress for async main-process sources.
// Its contract is deliberately small: deliver the exact event payload to a live
// window, and silently drop it once the window/webContents is gone.

type SentEvent = { channel: string; payload: unknown };

function makeWindow(events: SentEvent[]): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        events.push({ channel, payload });
      },
    },
  } as unknown as BrowserWindow;
}

test("sends the exact channel and payload to a live BrowserWindow", () => {
  const events: SentEvent[] = [];
  const payload = { id: "term-age-829", data: "sentinel bytes" };

  sendToWindow(() => makeWindow(events), CH.evtTerminalData, payload);

  expect(events).toEqual([{ channel: CH.evtTerminalData, payload }]);
});

test("drops events when the BrowserWindow is already gone", () => {
  const events: SentEvent[] = [];
  const destroyedWindow = {
    isDestroyed: () => true,
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        events.push({ channel, payload });
      },
    },
  } as unknown as BrowserWindow;

  sendToWindow(() => null, CH.evtTerminalExit, { id: "term-age-829", code: 0 });
  sendToWindow(() => destroyedWindow, CH.evtTerminalExit, {
    id: "term-age-829",
    code: 0,
  });

  expect(events).toEqual([]);
});

test("drops events when WebContents is missing or destroyed", () => {
  const events: SentEvent[] = [];
  const missingContents = {
    isDestroyed: () => false,
    webContents: null,
  } as unknown as BrowserWindow;
  const destroyedContents = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => true,
      send: (channel: string, payload: unknown) => {
        events.push({ channel, payload });
      },
    },
  } as unknown as BrowserWindow;

  sendToWindow(() => missingContents, CH.evtTerminalData, {
    id: "term-age-829",
    data: "dropped missing contents",
  });
  sendToWindow(() => destroyedContents, CH.evtTerminalData, {
    id: "term-age-829",
    data: "dropped destroyed contents",
  });

  expect(events).toEqual([]);
});

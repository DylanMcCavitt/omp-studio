// The live terminal surface (feature 7): an xterm.js Terminal wired to a single
// main-process pty. On mount it spawns a pty in `cwd` (via the terminal store),
// streams the pty's output into the buffer, forwards keystrokes back, and keeps
// the pty sized to the viewport with the fit addon + a ResizeObserver. On
// unmount it kills the pty and disposes the xterm instance — scrollback is
// ephemeral by design.
//
// The pty is a REAL shell at the user's full privilege; nothing here makes it
// "safe". Output is written straight to the xterm buffer (never reduced into
// React state — a byte stream is far too hot to re-render on), and input is
// forwarded ONLY from genuine keystrokes in this view, never from agent output.

import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { useTerminalStore } from "@/store/terminal";

export interface XtermViewProps {
  /** Working directory the pty is spawned in (the active workspace). */
  cwd: string;
  /** Notified when this terminal's pty exits, so the view can offer a restart. */
  onExit?: (code: number | null) => void;
}

/** Read a `--c-*` theme channel triple ("R G B") as an xterm-parseable rgb(). */
function cssRgb(name: string): string | undefined {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!raw) return undefined;
  const parts = raw.split(/\s+/);
  if (parts.length !== 3) return undefined;
  return `rgb(${parts.join(", ")})`;
}

/** Build an xterm theme from the app's live CSS variables (light or dark). */
function readXtermTheme(): ITheme {
  return {
    background: cssRgb("--c-bg-raised"),
    foreground: cssRgb("--c-ink"),
    cursor: cssRgb("--c-accent"),
    cursorAccent: cssRgb("--c-bg-raised"),
    selectionBackground: cssRgb("--c-accent-soft"),
  };
}

export function XtermView({ cwd, onExit }: XtermViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Hold the latest onExit in a ref so the mount effect can stay keyed on `cwd`
  // alone without re-spawning the pty when the parent re-renders.
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const store = useTerminalStore.getState();
    store.ensureSubscribed();

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", "Liberation Mono", monospace',
      scrollback: 5000,
      theme: readXtermTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try {
      fit.fit();
    } catch {
      // fit can throw if the container has no layout yet; the ResizeObserver
      // below re-fits once it does.
    }

    // Track-and-tear-down state for the async spawn (StrictMode mounts twice).
    let disposed = false;
    let termId: string | null = null;
    let offData: (() => void) | undefined;
    let offExit: (() => void) | undefined;

    const inputDisposable = term.onData((data) => {
      if (termId) store.write(termId, data);
    });
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (termId) store.resize(termId, cols, rows);
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // ignore transient zero-size measurements during layout
      }
    });
    resizeObserver.observe(container);

    // Re-theme the buffer when the app toggles light/dark.
    const themeObserver = new MutationObserver(() => {
      term.options.theme = readXtermTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    void (async () => {
      try {
        const info = await store.create(cwd, term.cols, term.rows);
        if (disposed) {
          // Unmounted before the spawn resolved — kill the orphaned pty.
          void store.dispose(info.id);
          return;
        }
        termId = info.id;
        offData = store.subscribeData(info.id, (chunk) => term.write(chunk));
        offExit = store.subscribeExit(info.id, (code) => {
          const suffix = code != null ? ` (${code})` : "";
          term.write(`\r\n\x1b[2m[process exited${suffix}]\x1b[0m\r\n`);
          onExitRef.current?.(code);
        });
        term.focus();
      } catch (error) {
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        term.write(
          `\r\n\x1b[31mFailed to start terminal: ${message}\x1b[0m\r\n`,
        );
      }
    })();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      themeObserver.disconnect();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      offData?.();
      offExit?.();
      if (termId) void store.dispose(termId);
      term.dispose();
    };
  }, [cwd]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}

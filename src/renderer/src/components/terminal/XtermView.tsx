// The live terminal surface (feature 7): an xterm.js Terminal attached to one
// main-process pty id. The pty is created by the Terminal view/store before this
// component mounts; this component streams output into xterm, forwards genuine
// xterm keystrokes back to that pty, and resizes it with the fit addon. Unmounting
// disposes only the xterm instance/subscriptions — it does NOT kill the pty.
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
  /** Main-process terminal id this xterm instance is attached to. */
  id: string;
  /** Working directory label for this terminal. */
  cwd: string;
  /** True when this terminal is the selected visible tab. */
  active?: boolean;
  /** Notified when this terminal's pty exits, so parent chrome can update. */
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
  const bg = cssRgb("--c-terminal-bg");
  const t1 = cssRgb("--c-ink");
  const t2 = cssRgb("--c-ink-muted");
  const t3 = cssRgb("--c-ink-faint");
  return {
    background: bg,
    foreground: t1,
    cursor: t1,
    cursorAccent: bg,
    selectionBackground: cssRgb("--c-accent-soft"),
    selectionForeground: t1,
    black: bg,
    red: cssRgb("--c-danger"),
    green: cssRgb("--c-success"),
    yellow: cssRgb("--c-warn"),
    blue: t2,
    magenta: t2,
    cyan: t2,
    white: t1,
    brightBlack: t3,
    brightRed: cssRgb("--c-danger"),
    brightGreen: cssRgb("--c-success"),
    brightYellow: cssRgb("--c-warn"),
    brightBlue: t1,
    brightMagenta: t1,
    brightCyan: t1,
    brightWhite: cssRgb("--c-ink-clear"),
  };
}

export function XtermView({ id, cwd, active = false, onExit }: XtermViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  // Hold the latest onExit in a ref so the mount effect can stay keyed on the
  // pty id without re-subscribing when the parent re-renders.
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);
  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const store = useTerminalStore.getState();
    store.ensureSubscribed();

    const term = new Terminal({
      cursorBlink: false,
      fontSize: 13,
      fontFamily:
        '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
      scrollback: 5000,
      theme: readXtermTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    try {
      fit.fit();
    } catch {
      // fit can throw if the container has no layout yet; the ResizeObserver
      // below re-fits once it does.
    }

    // Track-and-tear-down state for this xterm attachment. The pty itself
    // outlives this component unless the parent explicitly closes the tab.
    let disposed = false;
    let offData: (() => void) | undefined;
    let offExit: (() => void) | undefined;

    const inputDisposable = term.onData((data) => {
      store.write(id, data);
    });
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      store.resize(id, cols, rows);
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

    offData = store.subscribeData(id, (chunk) => term.write(chunk));
    offExit = store.subscribeExit(id, (code) => {
      const suffix = code != null ? ` (${code})` : "";
      term.write(`\r\n\x1b[2m[process exited${suffix}]\x1b[0m\r\n`);
      onExitRef.current?.(code);
    });
    store.resize(id, term.cols, term.rows);
    if (!disposed) term.focus();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      themeObserver.disconnect();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      offData?.();
      offExit?.();
      termRef.current = null;
      term.dispose();
    };
  }, [id]);

  return (
    <div
      ref={containerRef}
      data-cwd={cwd}
      data-testid="xterm-surface"
      className="terminal-xterm h-full w-full overflow-hidden bg-bg-terminal font-mono"
    />
  );
}

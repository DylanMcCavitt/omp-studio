// G2 — the global shortcut manager. Verifies each documented chord dispatches to
// the right store action (we mock the handlers via vi.spyOn so we assert intent,
// not downstream effects), that overlay chords are reflected in the ui store, and
// that a blocking modal suppresses the session-mutating chords. Keydown is fired
// straight at window (where the single listener lives) so there is no double-fire.

import { render, screen } from "@testing-library/react";
import { useShortcuts } from "@/lib/useShortcuts";
import { useAppStore } from "@/store/app";
import { useChatStore } from "@/store/chat";
import { createSession } from "@/store/session-reducer";
import { useSettingsStore } from "@/store/settings";
import { useShellStore } from "@/store/shell";
import { useUiStore } from "@/store/ui";

function Harness() {
  useShortcuts();
  return null;
}

function press(key: string, opts: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...opts,
    }),
  );
}

beforeEach(() => {
  useChatStore.setState({
    openSessions: {},
    hibernatedSessions: {},
    activeSessionId: null,
  });
  useUiStore.setState({
    searchOpen: false,
    navPaletteOpen: false,
    slashPaletteToggle: 0,
  });
  useAppStore.setState({ route: "dashboard" });
  useSettingsStore.setState({ settings: null });
  useShellStore.getState().setSidebarToggleHandler(null);
});

describe("useShortcuts", () => {
  it("Cmd+T and Cmd+N start a new chat", () => {
    const newChat = vi.spyOn(useChatStore.getState(), "newChat");
    render(<Harness />);
    press("t", { metaKey: true });
    press("n", { ctrlKey: true });
    expect(newChat).toHaveBeenCalledTimes(2);
  });

  it("reads custom bindings from settings without reloading the listener", () => {
    useSettingsStore.setState({
      settings: {
        keybindings: { newChat: { key: "j", mod: true } },
      } as never,
    });
    const newChat = vi.spyOn(useChatStore.getState(), "newChat");
    render(<Harness />);

    press("t", { metaKey: true });
    expect(newChat).not.toHaveBeenCalled();
    press("j", { metaKey: true });
    expect(newChat).toHaveBeenCalledTimes(1);

    useSettingsStore.setState({
      settings: {
        keybindings: { newChat: { key: "l", mod: true } },
      } as never,
    });
    press("j", { metaKey: true });
    expect(newChat).toHaveBeenCalledTimes(1);
    press("l", { metaKey: true });
    expect(newChat).toHaveBeenCalledTimes(2);
  });

  it("Cmd+K toggles the navigation palette", () => {
    render(<Harness />);
    press("k", { metaKey: true });
    expect(useUiStore.getState().navPaletteOpen).toBe(true);
    press("k", { metaKey: true });
    expect(useUiStore.getState().navPaletteOpen).toBe(false);
  });

  it("Cmd+B toggles the left sidebar unless focus is editable", () => {
    const toggleSidebar = vi.fn();
    useShellStore.getState().setSidebarToggleHandler(toggleSidebar);
    render(
      <>
        <Harness />
        <input data-testid="field" />
      </>,
    );

    press("b", { metaKey: true });
    expect(toggleSidebar).toHaveBeenCalledTimes(1);

    screen.getByTestId("field").focus();
    press("b", { metaKey: true });
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it("Cmd+Shift+F toggles the global search overlay", () => {
    render(<Harness />);
    press("f", { metaKey: true, shiftKey: true });
    expect(useUiStore.getState().searchOpen).toBe(true);
    press("f", { metaKey: true, shiftKey: true });
    expect(useUiStore.getState().searchOpen).toBe(false);
  });

  it("Cmd+Shift+P requests the slash palette", () => {
    render(<Harness />);
    press("p", { metaKey: true, shiftKey: true });
    expect(useUiStore.getState().slashPaletteToggle).toBe(1);
  });

  it("Cmd+1 switches to the first open session", () => {
    useChatStore.setState({
      openSessions: { a: createSession("a"), b: createSession("b") },
    });
    const openChat = vi.spyOn(useChatStore.getState(), "openChat");
    render(<Harness />);
    press("1", { metaKey: true });
    expect(openChat).toHaveBeenCalledWith("a");
  });

  it("Cmd+W closes a non-streaming active session without confirming", () => {
    useChatStore.setState({
      openSessions: { a: createSession("a", { status: "idle" }) },
      activeSessionId: "a",
    });
    const closeSession = vi
      .spyOn(useChatStore.getState(), "closeSession")
      .mockResolvedValue();
    render(<Harness />);
    press("w", { metaKey: true });
    expect(closeSession).toHaveBeenCalledWith("a");
  });

  it("Cmd+W on a streaming session respects a cancelled confirm", () => {
    useChatStore.setState({
      openSessions: { a: createSession("a", { status: "streaming" }) },
      activeSessionId: "a",
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const closeSession = vi
      .spyOn(useChatStore.getState(), "closeSession")
      .mockResolvedValue();
    render(<Harness />);
    press("w", { metaKey: true });
    expect(confirm).toHaveBeenCalled();
    expect(closeSession).not.toHaveBeenCalled();
  });

  it("Esc closes the search overlay when it is open", () => {
    useUiStore.setState({ searchOpen: true });
    render(<Harness />);
    press("Escape");
    expect(useUiStore.getState().searchOpen).toBe(false);
  });

  it("Esc closes the navigation palette when it is open", () => {
    useUiStore.setState({ navPaletteOpen: true });
    render(<Harness />);
    press("Escape");
    expect(useUiStore.getState().navPaletteOpen).toBe(false);
  });

  it("suppresses session chords while a blocking modal is open", () => {
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    const newChat = vi.spyOn(useChatStore.getState(), "newChat");
    render(<Harness />);
    press("t", { metaKey: true });
    expect(newChat).not.toHaveBeenCalled();
    document.body.removeChild(modal);
  });

  it("suppresses chords while typing in a field but still allows Esc", () => {
    useUiStore.setState({ searchOpen: true });
    const newChat = vi.spyOn(useChatStore.getState(), "newChat");
    render(
      <>
        <Harness />
        <input data-testid="field" />
      </>,
    );
    screen.getByTestId("field").focus();
    press("t", { metaKey: true });
    expect(newChat).not.toHaveBeenCalled();
    // Esc still closes the topmost overlay even from a focused field.
    press("Escape");
    expect(useUiStore.getState().searchOpen).toBe(false);
  });
});

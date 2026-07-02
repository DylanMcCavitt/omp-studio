// AGE-703 — titlebar owns the app-shell Live Dot label, Cmd+K palette pill,
// and dark/light toggle. The heavy shell children are mocked so these tests stay
// focused on titlebar wiring instead of resizable-panel behavior.

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, type ReactNode, useEffect } from "react";
import { useAppStore } from "@/store/app";
import { useChatStore } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";
import { useShellStore } from "@/store/shell";
import { useUiStore } from "@/store/ui";
import { Layout } from "./Layout";

vi.mock("react-resizable-panels", () => ({
  PanelGroup: forwardRef<HTMLDivElement, { children: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>,
  ),
  Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/layout/ResizeHandle", () => ({
  ResizeHandle: () => <div data-testid="resize-handle" />,
}));
vi.mock("@/components/shell/RailPanelHost", () => ({
  RailPanelHost: () => <aside />,
}));
vi.mock("@/components/shell/RightRail", () => ({
  RightRail: () => <nav aria-label="Tools" />,
}));
vi.mock("@/lib/nav-registry", () => ({
  isRailRoute: (route: string) => route !== "chat",
}));
vi.mock("@/components/ui", () => ({
  Toaster: () => null,
}));
vi.mock("./Sidebar", () => ({
  Sidebar: () => <nav aria-label="Sidebar" />,
}));

const updateSettings = vi.fn();
let prefersDark = false;
let mediaListeners: Array<() => void> = [];

beforeEach(() => {
  updateSettings.mockResolvedValue(undefined);
  prefersDark = false;
  mediaListeners = [];
  window.matchMedia = vi.fn().mockReturnValue({
    get matches() {
      return prefersDark;
    },
    addEventListener: vi.fn((_event: string, listener: () => void) => {
      mediaListeners.push(listener);
    }),
    removeEventListener: vi.fn((_event: string, listener: () => void) => {
      mediaListeners = mediaListeners.filter((item) => item !== listener);
    }),
  }) as never;
  Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
    width: 1200,
    height: 800,
    top: 0,
    left: 0,
    bottom: 800,
    right: 1200,
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  useUiStore.setState({ navPaletteOpen: false });
  useAppStore.setState({ selectedProject: "/p/acme" } as never);
  useChatStore.setState({ activeSessionId: null, openSessions: {} as never });
  useShellStore.setState({ openPanelId: null });
  useSettingsStore.setState({
    settings: {
      version: 2,
      theme: "light",
      workspaces: [
        {
          id: "w1",
          cwd: "/p/acme",
          label: "Acme",
          pinned: true,
          lastUsedAt: "2026-01-01T00:00:00.000Z",
          color: "blue",
        },
      ],
      layout: {},
    } as never,
    update: updateSettings,
    setLayout: vi.fn(),
  });
});

it("opens the navigation palette from the titlebar Cmd+K pill", async () => {
  const user = userEvent.setup();
  render(<Layout>main</Layout>);

  await user.click(
    screen.getByRole("button", { name: "Open navigation palette" }),
  );

  expect(useUiStore.getState().navPaletteOpen).toBe(true);
});

it("toggles between explicit dark and light theme modes", async () => {
  const user = userEvent.setup();
  render(<Layout>main</Layout>);

  await user.click(
    screen.getByRole("button", { name: "Switch to dark theme" }),
  );

  expect(updateSettings).toHaveBeenCalledWith({ theme: "dark" });
});

it("keeps the system-mode theme action synced to OS appearance changes", () => {
  useSettingsStore.setState((state) => ({
    settings: state.settings ? { ...state.settings, theme: "system" } : null,
  }));
  render(<Layout>main</Layout>);

  expect(
    screen.getByRole("button", { name: "Switch to dark theme" }),
  ).toBeInTheDocument();

  act(() => {
    prefersDark = true;
    for (const listener of mediaListeners) listener();
  });

  expect(
    screen.getByRole("button", { name: "Switch to light theme" }),
  ).toBeInTheDocument();
});

it("renders the selected workspace label with the active session Live Dot status", () => {
  useChatStore.setState({
    activeSessionId: "s1",
    openSessions: {
      s1: {
        sessionId: "s1",
        cwd: "/p/acme",
        status: "streaming",
        availableCommands: [],
      },
    } as never,
  });

  const { container } = render(<Layout>main</Layout>);

  expect(screen.getByText("Acme")).toBeInTheDocument();
  expect(
    container.querySelector('[data-status="running"]'),
  ).toBeInTheDocument();
});

it("keeps titlebar controls out of the macOS traffic-light drag region", () => {
  const { container } = render(<Layout>main</Layout>);

  const header = container.querySelector("header.titlebar");
  expect(header?.className).toContain("pl-[72px]");
  expect(
    screen.getByRole("button", { name: "Open navigation palette" })
      .parentElement?.className,
  ).toContain("no-drag");
});

it("keeps the center subtree mounted when the rail panel opens and closes", () => {
  let unmounts = 0;
  function Probe() {
    useEffect(() => () => void unmounts++, []);
    return <div data-testid="center-probe">center</div>;
  }

  render(
    <Layout>
      <Probe />
    </Layout>,
  );
  const probe = screen.getByTestId("center-probe");

  act(() => useShellStore.setState({ openPanelId: "skills" }));
  expect(screen.getByTestId("center-probe")).toBe(probe);
  expect(unmounts).toBe(0);

  act(() => useShellStore.setState({ openPanelId: null }));
  expect(screen.getByTestId("center-probe")).toBe(probe);
  expect(unmounts).toBe(0);
});

it("renders a rail panel as a fixed-width overlay and persists left-edge drag width per route", () => {
  const setLayout = vi.fn();
  useSettingsStore.setState({ setLayout });
  useShellStore.setState({ openPanelId: "skills" });

  const { container } = render(<Layout>main</Layout>);
  const handle = screen.getByRole("separator", { name: "Resize tool panel" });
  const sheet = handle.parentElement;
  expect(sheet).toHaveStyle({ width: "460px" });
  expect(sheet?.className).toContain("absolute");
  expect(container.querySelectorAll('[data-testid="resize-handle"]')).toHaveLength(1);
  const pointerDown = new Event("pointerdown", { bubbles: true });
  Object.defineProperties(pointerDown, {
    pointerId: { value: 1 },
    clientX: { value: 700 },
  });
  const pointerMove = new Event("pointermove", { bubbles: true });
  Object.defineProperties(pointerMove, {
    pointerId: { value: 1 },
    clientX: { value: 660 },
  });
  const pointerUp = new Event("pointerup", { bubbles: true });
  Object.defineProperty(pointerUp, "pointerId", { value: 1 });
  fireEvent(handle, pointerDown);
  fireEvent(handle, pointerMove);
  fireEvent(handle, pointerUp);

  expect(setLayout).toHaveBeenLastCalledWith({
    rightPanelWidthsPx: { skills: 500 },
  });
});

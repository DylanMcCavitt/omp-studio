// AGE-630 — the right icon rail and its shell store. The rail lists every
// railable destination (NAV_ENTRIES minus the primary `chat` surface); clicking
// an icon toggles that destination's docked panel open/closed and highlights the
// active one. The store also persists the open-panel id through `setLayout` so it
// can be restored on the next launch. Assertions go through roles + store state,
// never styling.

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RAIL_ENTRIES } from "@/lib/nav-registry";
import { useSettingsStore } from "@/store/settings";
import { useShellStore } from "@/store/shell";
import { RightRail } from "./RightRail";

beforeEach(() => {
  useShellStore.setState({ openPanelId: null });
  // Stub the debounced persist so store actions assert intent without timers.
  useSettingsStore.setState({ setLayout: vi.fn() });
});

describe("shell store", () => {
  it("setOpenPanel opens a panel and persists its id", () => {
    const setLayout = vi.fn();
    useSettingsStore.setState({ setLayout });

    useShellStore.getState().setOpenPanel("skills");

    expect(useShellStore.getState().openPanelId).toBe("skills");
    expect(setLayout).toHaveBeenCalledWith({ rightPanelId: "skills" });
  });

  it("togglePanel opens, then closes the same panel (persisting each)", () => {
    const setLayout = vi.fn();
    useSettingsStore.setState({ setLayout });
    const { togglePanel } = useShellStore.getState();

    togglePanel("mcp");
    expect(useShellStore.getState().openPanelId).toBe("mcp");
    expect(setLayout).toHaveBeenLastCalledWith({ rightPanelId: "mcp" });

    togglePanel("mcp");
    expect(useShellStore.getState().openPanelId).toBeNull();
    expect(setLayout).toHaveBeenLastCalledWith({ rightPanelId: null });
  });

  it("togglePanel switches directly from one panel to another", () => {
    const { togglePanel } = useShellStore.getState();
    togglePanel("skills");
    togglePanel("agents");
    expect(useShellStore.getState().openPanelId).toBe("agents");
  });

  it("closePanel collapses the rail and persists null", () => {
    const setLayout = vi.fn();
    useSettingsStore.setState({ setLayout });
    useShellStore.setState({ openPanelId: "github" });

    useShellStore.getState().closePanel();

    expect(useShellStore.getState().openPanelId).toBeNull();
    expect(setLayout).toHaveBeenCalledWith({ rightPanelId: null });
  });

  it("hydrate adopts a persisted id WITHOUT re-persisting it", () => {
    const setLayout = vi.fn();
    useSettingsStore.setState({ setLayout });

    useShellStore.getState().hydrate("linear");

    expect(useShellStore.getState().openPanelId).toBe("linear");
    expect(setLayout).not.toHaveBeenCalled();
  });
});

describe("RightRail", () => {
  it("renders one icon per railable destination and never chat", () => {
    render(<RightRail />);

    const rail = screen.getByRole("navigation", { name: "Tools" });
    expect(within(rail).getAllByRole("button")).toHaveLength(
      RAIL_ENTRIES.length,
    );
    expect(
      screen.queryByRole("button", { name: "Chat" }),
    ).not.toBeInTheDocument();
    // The destinations the old sidebar nav owned are still reachable here.
    expect(
      screen.getByRole("button", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Settings" }),
    ).toBeInTheDocument();
  });

  it("clicking an icon opens its panel and marks it active", async () => {
    const user = userEvent.setup();
    render(<RightRail />);

    const skills = screen.getByRole("button", { name: "Skills" });
    expect(skills).toHaveAttribute("aria-pressed", "false");

    await user.click(skills);

    expect(useShellStore.getState().openPanelId).toBe("skills");
    expect(screen.getByRole("button", { name: "Skills" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("clicking the active icon again collapses the panel", async () => {
    const user = userEvent.setup();
    useShellStore.setState({ openPanelId: "agents" });
    render(<RightRail />);

    const agents = screen.getByRole("button", { name: "Agents" });
    expect(agents).toHaveAttribute("aria-pressed", "true");

    await user.click(agents);

    expect(useShellStore.getState().openPanelId).toBeNull();
    expect(screen.getByRole("button", { name: "Agents" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

import type { OmpApi, StudioSettings } from "@shared/ipc";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSettingsStore } from "@/store/settings";
import Settings from "./Settings";

const BASE: StudioSettings = {
  version: 2,
  theme: "system",
  defaultProject: null,
  defaultModel: null,
  defaultThinkingLevel: "medium",
  defaultApprovalMode: "always-ask",
  defaultAutoApprove: false,
  liveSessionLimit: 4,
  recentProjects: [],
  openSessions: [],
  linear: { writesEnabled: false },
  terminal: {
    enabled: false,
    maxConcurrent: 4,
    defaultTarget: "built-in",
    externalProfile: "system",
  },
  browser: { enabled: false },
};

function seedSettings(settings: StudioSettings = BASE) {
  const update = vi.fn(async (patch: Partial<StudioSettings>) => {
    const current = useSettingsStore.getState().settings ?? settings;
    useSettingsStore.setState({ settings: { ...current, ...patch } });
  });
  useSettingsStore.setState({
    settings,
    loading: false,
    error: undefined,
    update,
  });
  Object.assign(window.omp, {
    listModels: vi.fn(async () => []),
    listProviders: vi.fn(async () => []),
  } as unknown as Partial<OmpApi>);
  return update;
}

beforeEach(() => {
  useSettingsStore.setState(useSettingsStore.getInitialState());
});

it("renders terminal default target and external profile settings", async () => {
  seedSettings();

  render(<Settings />);

  expect(
    await screen.findByRole("heading", { name: "Settings" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Default terminal target")).toHaveValue(
    "built-in",
  );
  expect(screen.getByLabelText("External terminal profile")).toHaveValue(
    "system",
  );
  expect(screen.getByLabelText("Maximum built-in terminal tabs")).toHaveValue(
    4,
  );
  expect(
    screen.getByText(
      "Built-in opens Studio's xterm shell; External opens Ghostty/Kitty/etc. as separate apps.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      "Preference only; OMP Studio launches the selected app externally and does not embed or control its renderer.",
    ),
  ).toBeInTheDocument();
});

it("persists terminal target/profile without enabling the shell", async () => {
  const user = userEvent.setup();
  const update = seedSettings();

  render(<Settings />);

  await user.selectOptions(
    screen.getByLabelText("Default terminal target"),
    "external",
  );
  await user.selectOptions(
    screen.getByLabelText("External terminal profile"),
    "ghostty",
  );

  expect(update).toHaveBeenNthCalledWith(1, {
    terminal: {
      enabled: false,
      maxConcurrent: 4,
      defaultTarget: "external",
      externalProfile: "system",
    },
  });
  expect(update).toHaveBeenNthCalledWith(2, {
    terminal: {
      enabled: false,
      maxConcurrent: 4,
      defaultTarget: "external",
      externalProfile: "ghostty",
    },
  });
});

it("gates enabling the built-in shell and preserves target/profile", async () => {
  const user = userEvent.setup();
  const update = seedSettings({
    ...BASE,
    terminal: {
      enabled: false,
      maxConcurrent: 6,
      defaultTarget: "external",
      externalProfile: "wezterm",
    },
  });

  render(<Settings />);

  await user.click(
    screen.getByRole("switch", { name: "Enable built-in terminal" }),
  );
  expect(
    screen.getByText(
      /runs a real shell with your full user-account privileges/i,
    ),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Enable terminal" }));

  await waitFor(() =>
    expect(update).toHaveBeenCalledWith({
      terminal: {
        enabled: true,
        maxConcurrent: 6,
        defaultTarget: "external",
        externalProfile: "wezterm",
      },
    }),
  );
});

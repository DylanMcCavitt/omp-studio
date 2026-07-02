import type { ModelInfo } from "@shared/domain";
import type { OmpApi, StudioSettings } from "@shared/ipc";
import { render, screen, waitFor, within } from "@testing-library/react";
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

function seedSettings(
  settings: StudioSettings = BASE,
  models: ModelInfo[] = [],
) {
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
    listModels: vi.fn(async () => models),
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

const MODEL_CATALOG: ModelInfo[] = [
  {
    provider: "anthropic",
    id: "claude-opus-4",
    selector: "anthropic/claude-opus-4",
    name: "Claude Opus 4",
    reasoning: true,
    contextWindow: 200000,
    cost: { input: 3, output: 15 },
  },
  {
    provider: "anthropic",
    id: "claude-3-5-haiku",
    selector: "anthropic/claude-3-5-haiku",
    name: "Claude Haiku 3.5",
    contextWindow: 200000,
    cost: { input: 0.8, output: 4 },
  },
  {
    provider: "openai",
    id: "gpt-5",
    selector: "openai/gpt-5",
    name: "GPT-5",
    reasoning: true,
    contextWindow: 400000,
    cost: { input: 5, output: 20 },
  },
];

function mockModelLoad(result: Promise<ModelInfo[]>) {
  Object.assign(window.omp, {
    listModels: vi.fn(() => result),
    listProviders: vi.fn(async () => []),
  } as unknown as Partial<OmpApi>);
}

it("filters the Settings model catalog by name provider id and selector", async () => {
  const user = userEvent.setup();
  seedSettings(BASE, MODEL_CATALOG);

  render(<Settings />);

  expect(await screen.findByText("Claude Opus 4")).toBeInTheDocument();
  expect(screen.getByText("Claude Haiku 3.5")).toBeInTheDocument();
  expect(screen.getByText("GPT-5")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /anthropic/i })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(
    within(
      screen.getByRole("button", { name: /anthropic/i }).parentElement!,
    ).getByText("2"),
  ).toBeInTheDocument();
  expect(
    within(
      screen.getByRole("button", { name: /openai/i }).parentElement!,
    ).getByText("1"),
  ).toBeInTheDocument();
  expect(screen.getAllByText("200,000 ctx")).toHaveLength(2);
  expect(screen.getByText("400,000 ctx")).toBeInTheDocument();
  expect(screen.getAllByText("reasoning")).toHaveLength(2);
  expect(screen.getByText("$3/M in")).toBeInTheDocument();
  expect(screen.getByText("$15/M out")).toBeInTheDocument();

  const search = screen.getByLabelText("Search models");
  await user.type(search, "claude-3-5-haiku");

  expect(screen.getByText("Claude Haiku 3.5")).toBeInTheDocument();
  expect(screen.queryByText("Claude Opus 4")).not.toBeInTheDocument();
  expect(screen.queryByText("GPT-5")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Clear model search" }));
  await user.type(screen.getByLabelText("Search models"), "anthropic");

  expect(screen.getByText("Claude Opus 4")).toBeInTheDocument();
  expect(screen.getByText("Claude Haiku 3.5")).toBeInTheDocument();
  expect(screen.queryByText("GPT-5")).not.toBeInTheDocument();
  expect(
    within(
      screen.getByRole("button", { name: /anthropic/i }).parentElement!,
    ).getByText("2"),
  ).toBeInTheDocument();

  await user.clear(screen.getByLabelText("Search models"));
  await user.type(screen.getByLabelText("Search models"), "openai/gpt-5");

  expect(screen.getByText("GPT-5")).toBeInTheDocument();
  expect(screen.queryByText("Claude Opus 4")).not.toBeInTheDocument();
  expect(screen.getByText("400,000 ctx")).toBeInTheDocument();
  expect(screen.getByText("reasoning")).toBeInTheDocument();
  expect(screen.getByText("$5/M in")).toBeInTheDocument();
  expect(screen.getByText("$20/M out")).toBeInTheDocument();
});

it("collapses providers but opens matching groups while searching", async () => {
  const user = userEvent.setup();
  seedSettings(BASE, MODEL_CATALOG);

  render(<Settings />);

  await screen.findByText("Claude Opus 4");
  await user.click(screen.getByRole("button", { name: /anthropic/i }));

  expect(screen.queryByText("Claude Opus 4")).not.toBeInTheDocument();
  expect(screen.getByText("GPT-5")).toBeInTheDocument();

  await user.type(screen.getByLabelText("Search models"), "haiku");

  expect(await screen.findByText("Claude Haiku 3.5")).toBeInTheDocument();
  expect(screen.queryByText("GPT-5")).not.toBeInTheDocument();
});

it("shows an empty fallback for model searches with no matches", async () => {
  const user = userEvent.setup();
  seedSettings(BASE, MODEL_CATALOG);

  render(<Settings />);

  await screen.findByText("Claude Opus 4");
  await user.type(screen.getByLabelText("Search models"), "no-such-model");

  expect(screen.getByText("No matching models")).toBeInTheDocument();
  expect(
    screen.getByText("Try a model name, provider, id, or selector."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Claude Opus 4")).not.toBeInTheDocument();
});

it("keeps the model loading state until the catalog resolves", async () => {
  let resolveModels!: (models: ModelInfo[]) => void;
  seedSettings();
  mockModelLoad(
    new Promise<ModelInfo[]>((resolve) => {
      resolveModels = resolve;
    }),
  );

  render(<Settings />);

  expect(screen.queryByLabelText("Search models")).not.toBeInTheDocument();

  resolveModels(MODEL_CATALOG);

  expect(await screen.findByLabelText("Search models")).toBeInTheDocument();
  expect(screen.getByText("Claude Opus 4")).toBeInTheDocument();
});

it("keeps the model error state visible when the catalog fails", async () => {
  seedSettings();
  mockModelLoad(Promise.reject(new Error("catalog unavailable")));

  render(<Settings />);

  expect(await screen.findByText("Failed to load models")).toBeInTheDocument();
  expect(screen.getByText("catalog unavailable")).toBeInTheDocument();
  expect(screen.queryByLabelText("Search models")).not.toBeInTheDocument();
});

it("renders reduced-safety defaults with warn styling while keeping risk confirmation behavior", async () => {
  const user = userEvent.setup();
  const update = seedSettings({
    ...BASE,
    defaultApprovalMode: "yolo",
    defaultAutoApprove: true,
  });

  render(<Settings />);

  const approvalMode = (await screen.findByDisplayValue(
    "yolo",
  )) as HTMLSelectElement;
  expect(approvalMode.className).toContain("border-warn/50");
  expect(screen.getByText("dangerous").className).toContain("text-warn");
  const reducedSafety = screen.getByText(
    /reduced safety prompts/i,
  ).parentElement;
  expect(reducedSafety?.className).toContain("border-warn/30");
  const autoApproveSwitch = screen.getByRole("switch", {
    name: "Auto-approve all requests by default",
  });
  expect(autoApproveSwitch.className).toContain("bg-warn/80");
  expect(autoApproveSwitch.firstElementChild?.className).toContain("bg-ink");

  await user.selectOptions(approvalMode, "always-ask");
  expect(update).toHaveBeenCalledWith({ defaultApprovalMode: "always-ask" });
});

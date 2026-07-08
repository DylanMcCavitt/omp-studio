import type { ModelInfo } from "@shared/domain";
import type { OmpApi, StudioSettings } from "@shared/ipc";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useSettingsStore } from "@/store/settings";
import { SettingsDialog } from "./SettingsDialog";

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

function seedSettings(models: ModelInfo[] = []) {
  useSettingsStore.setState({
    settings: BASE,
    loading: false,
    error: undefined,
    update: vi.fn(),
    load: vi.fn(),
  });
  Object.assign(window.omp, {
    listModels: vi.fn(async () => models),
    listProviders: vi.fn(async () => []),
  } as unknown as Partial<OmpApi>);
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open settings
      </button>
      <button type="button">Outside focus</button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

beforeEach(() => {
  useSettingsStore.setState(useSettingsStore.getInitialState());
  seedSettings();
});

it("opens Settings as a dialog and renders existing sections inside it", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  await user.click(screen.getByRole("button", { name: "Open settings" }));

  const dialog = await screen.findByRole("dialog", { name: "Settings" });
  expect(dialog).toBeInTheDocument();
  expect(
    within(dialog).getByRole("heading", { name: "Settings" }),
  ).toBeInTheDocument();
  expect(within(dialog).getByText("Defaults")).toBeInTheDocument();
  expect(within(dialog).getByText("Appearance")).toBeInTheDocument();
  expect(within(dialog).getByText("Workspaces")).toBeInTheDocument();
});

it("dismisses on Escape and click-away", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<Harness />);

  await user.click(screen.getByRole("button", { name: "Open settings" }));
  expect(await screen.findByRole("dialog", { name: "Settings" })).toBeVisible();

  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Settings" }),
    ).not.toBeInTheDocument(),
  );

  rerender(<Harness />);
  await user.click(screen.getByRole("button", { name: "Open settings" }));
  expect(await screen.findByRole("dialog", { name: "Settings" })).toBeVisible();

  await user.pointer({
    keys: "[MouseLeft]",
    target: screen.getByTestId("settings-modal-backdrop"),
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Settings" }),
    ).not.toBeInTheDocument(),
  );
});

it("lets an open Settings combobox consume Escape without closing the modal", async () => {
  const user = userEvent.setup();
  seedSettings([
    {
      provider: "openai",
      id: "gpt-5",
      selector: "openai/gpt-5",
      name: "GPT-5",
    },
  ]);
  render(<Harness />);

  await user.click(screen.getByRole("button", { name: "Open settings" }));
  const dialog = await screen.findByRole("dialog", { name: "Settings" });
  await user.click(
    within(dialog).getByRole("combobox", { name: "Default model" }),
  );
  expect(
    await screen.findByRole("combobox", { name: "Search models…" }),
  ).toBeInTheDocument();

  await user.keyboard("{Escape}");

  expect(screen.queryByRole("combobox", { name: "Search models…" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
});

it("dismisses a nested danger confirmation on Escape before the Settings modal", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  await user.click(screen.getByRole("button", { name: "Open settings" }));
  const settingsDialog = await screen.findByRole("dialog", {
    name: "Settings",
  });
  await user.click(
    within(settingsDialog).getByRole("switch", {
      name: "Enable built-in terminal",
    }),
  );
  expect(
    await screen.findByRole("dialog", {
      name: "Enable the built-in terminal?",
    }),
  ).toBeInTheDocument();

  await user.keyboard("{Escape}");

  expect(
    screen.queryByRole("dialog", { name: "Enable the built-in terminal?" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
});

it("dismisses from a document Escape fallback when focus leaves the dialog", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  await user.click(screen.getByRole("button", { name: "Open settings" }));
  expect(await screen.findByRole("dialog", { name: "Settings" })).toBeVisible();
  screen.getByRole("button", { name: "Close Settings" }).blur();

  fireEvent.keyDown(document, { key: "Escape" });

  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Settings" }),
    ).not.toBeInTheDocument(),
  );
});

it("traps focus inside the Settings dialog and restores focus on close", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  const trigger = screen.getByRole("button", { name: "Open settings" });
  trigger.focus();
  await user.click(trigger);

  const dialog = await screen.findByRole("dialog", { name: "Settings" });
  expect(screen.getByRole("button", { name: "Close Settings" })).toHaveFocus();

  await user.tab({ shift: true });
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
  expect(
    screen.getByRole("button", { name: "Outside focus" }),
  ).not.toHaveFocus();

  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Settings" }),
    ).not.toBeInTheDocument(),
  );
  expect(trigger).toHaveFocus();
});

// F4 — the composer slash-command palette. Verifies it lists the session's
// advertised commands, filters as you type, navigates with the arrows, inserts
// `/<name> ` (always trailing-spaced, never inferring a no-arg command) on
// Enter/click, and closes on Esc. A final integration check confirms the
// composer opens it on `/` at an empty input. Behaviour + roles only.

import type { AvailableCommand } from "@shared/rpc";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromptComposer } from "./PromptComposer";
import { SlashCommandPalette } from "./SlashCommandPalette";

const COMMANDS: AvailableCommand[] = [
  { name: "compact", description: "Compact the context" },
  { name: "model", description: "Switch the model" },
  { name: "clear", description: "Clear the transcript" },
];

function renderPalette(
  overrides: Partial<{
    setText: (t: string) => void;
    close: () => void;
    commands: AvailableCommand[];
  }> = {},
) {
  const setText = overrides.setText ?? vi.fn();
  const close = overrides.close ?? vi.fn();
  render(
    <SlashCommandPalette
      open
      commands={overrides.commands ?? COMMANDS}
      setText={setText}
      close={close}
    />,
  );
  return { setText, close };
}

it("lists every advertised command and focuses the filter input", () => {
  renderPalette();
  expect(
    screen.getByRole("combobox", { name: /filter slash commands/i }),
  ).toHaveFocus();
  expect(screen.getAllByRole("option")).toHaveLength(3);
  expect(screen.getByRole("option", { name: /compact/ })).toBeInTheDocument();
});

it("filters the list as the query is typed", async () => {
  const user = userEvent.setup();
  renderPalette();
  await user.type(screen.getByRole("combobox"), "mod");
  const options = screen.getAllByRole("option");
  expect(options).toHaveLength(1);
  expect(options[0]).toHaveTextContent("/model");
});

it("inserts '/<name> ' and closes when a row is selected by arrow + Enter", async () => {
  const user = userEvent.setup();
  const { setText, close } = renderPalette();
  // Down once moves from "compact" to "model", Enter selects it.
  await user.keyboard("{ArrowDown}{Enter}");
  expect(setText).toHaveBeenCalledTimes(1);
  expect(setText).toHaveBeenCalledWith("/model ");
  expect(close).toHaveBeenCalledTimes(1);
});

it("inserts the filtered command on Enter", async () => {
  const user = userEvent.setup();
  const { setText } = renderPalette();
  await user.type(screen.getByRole("combobox"), "clear");
  await user.keyboard("{Enter}");
  expect(setText).toHaveBeenCalledWith("/clear ");
});

it("inserts '/<name> ' when a row is clicked", async () => {
  const user = userEvent.setup();
  const { setText, close } = renderPalette();
  await user.click(screen.getByRole("option", { name: /compact/ }));
  expect(setText).toHaveBeenCalledWith("/compact ");
  expect(close).toHaveBeenCalledTimes(1);
});

it("closes on Escape without inserting anything", async () => {
  const user = userEvent.setup();
  const { setText, close } = renderPalette();
  await user.keyboard("{Escape}");
  expect(close).toHaveBeenCalledTimes(1);
  expect(setText).not.toHaveBeenCalled();
});

it("shows an empty-state when no commands are available", () => {
  renderPalette({ commands: [] });
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  expect(screen.getByText(/no commands available/i)).toBeInTheDocument();
});

it("opens from the composer when '/' is typed at an empty input", async () => {
  const user = userEvent.setup();
  render(
    <PromptComposer
      onSubmit={vi.fn().mockResolvedValue(true)}
      placeholder="Message"
      renderActions={() => null}
      renderOverlay={(ctx) => (
        <SlashCommandPalette
          open={ctx.open}
          commands={COMMANDS}
          setText={ctx.setText}
          close={ctx.close}
        />
      )}
    />,
  );
  // Palette is closed initially.
  expect(
    screen.queryByRole("combobox", { name: /filter slash commands/i }),
  ).not.toBeInTheDocument();

  await user.type(screen.getByPlaceholderText("Message"), "/");

  expect(
    screen.getByRole("combobox", { name: /filter slash commands/i }),
  ).toBeInTheDocument();
});

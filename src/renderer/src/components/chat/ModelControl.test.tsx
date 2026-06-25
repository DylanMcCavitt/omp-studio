// AGE-666 / AGE-705 — the compact model picker chip. The behaviours that
// matter: the trigger shows the active model's name (sourced from the `model`
// prop, so it renders before `listModels` resolves), opening reveals the
// available models, choosing a different one reports its `(provider, id)`, and
// (AGE-705) the chip is led by a workspace Live Dot. Verified through roles, the
// onChange callback, and the rendered dot; `window.omp.listModels` is stubbed.

import type { ModelInfo } from "@shared/domain";
import type { RpcModel } from "@shared/rpc";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelControl } from "./ModelControl";

const MODELS: ModelInfo[] = [
  {
    provider: "anthropic",
    id: "claude-opus-4",
    selector: "anthropic/claude-opus-4",
    name: "Claude Opus 4",
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-4",
    selector: "anthropic/claude-sonnet-4",
    name: "Claude Sonnet 4",
  },
  {
    provider: "openai",
    id: "gpt-5",
    selector: "openai/gpt-5",
    name: "GPT-5",
  },
];

const CURRENT: RpcModel = {
  provider: "anthropic",
  id: "claude-opus-4",
  name: "Claude Opus 4",
};

function stubModels(models: ModelInfo[] = MODELS) {
  Object.assign(window.omp, { listModels: vi.fn(async () => models) });
}

it("shows the active model's name on the trigger", () => {
  stubModels();
  render(<ModelControl model={CURRENT} onChange={vi.fn()} />);
  expect(
    screen.getByRole("button", { name: "Claude Opus 4" }),
  ).toBeInTheDocument();
});

it("falls back to provider/id, then a prompt, when no name is available", () => {
  stubModels();
  const { rerender } = render(
    <ModelControl model={{ provider: "x", id: "y" }} onChange={vi.fn()} />,
  );
  expect(screen.getByRole("button", { name: "x/y" })).toBeInTheDocument();

  rerender(<ModelControl model={null} onChange={vi.fn()} />);
  expect(
    screen.getByRole("button", { name: "Select model" }),
  ).toBeInTheDocument();
});

it("opens the list and reports the chosen model's provider + id", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  stubModels();
  render(<ModelControl model={CURRENT} onChange={onChange} />);

  await user.click(screen.getByRole("button", { name: "Claude Opus 4" }));

  // The list fills once `listModels` resolves; findBy waits for the re-render.
  await user.click(await screen.findByRole("option", { name: "GPT-5" }));

  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith("openai", "gpt-5");
});

it("filters the list as the query is typed", async () => {
  const user = userEvent.setup();
  stubModels();
  render(<ModelControl model={CURRENT} onChange={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Claude Opus 4" }));
  // Wait for the list to populate before filtering.
  await screen.findByRole("option", { name: "GPT-5" });

  await user.type(
    screen.getByRole("combobox", { name: "Search models" }),
    "gpt",
  );

  expect(screen.getByRole("option", { name: "GPT-5" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Claude Opus 4" })).toBeNull();
});

it("disables the trigger when no models are available", async () => {
  stubModels([]);
  render(<ModelControl model={CURRENT} onChange={vi.fn()} />);

  // Once the empty list resolves the trigger becomes disabled.
  const trigger = await screen.findByRole("button", { name: "Claude Opus 4" });
  await waitFor(() => expect(trigger).toBeDisabled());
});

it("renders the chip with a Live Dot (workspace color), model name, and chevron", () => {
  stubModels();
  render(
    <ModelControl
      model={CURRENT}
      onChange={vi.fn()}
      color="blue"
      status="running"
    />,
  );

  const trigger = screen.getByRole("button", { name: "Claude Opus 4" });
  // Model name is the chip's label.
  expect(trigger).toHaveTextContent("Claude Opus 4");
  // A running Live Dot carries the active workspace color as its fill — blue is
  // #3b82f6, which jsdom normalizes to rgb(59, 130, 246).
  const dot = trigger.querySelector<HTMLElement>('[data-status="running"]');
  expect(dot).not.toBeNull();
  expect(dot?.style.backgroundColor).toBe("rgb(59, 130, 246)");
  // The trigger's lone svg is the trailing chevron.
  expect(trigger.querySelector("svg")).not.toBeNull();
});

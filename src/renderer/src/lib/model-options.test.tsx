// AGE-691 — the Settings default-model picker has been a searchable ui/Combobox
// since AGE-612; this proves the options it feeds now surface each model's
// identity AND its context/price (the secondary line the Models catalog shows),
// and that the enriched text is searchable through the Combobox's filterOptions.

import type { ModelInfo } from "@shared/domain";
import { filterOptions } from "@/components/ui/Combobox";
import {
  FIRST_AVAILABLE_OPTION,
  modelComboboxOptions,
  modelOptionDescription,
} from "./model-options";

const full: ModelInfo = {
  provider: "anthropic",
  id: "claude-opus-4",
  selector: "anthropic/claude-opus-4",
  name: "Claude Opus 4",
  contextWindow: 200000,
  reasoning: true,
  cost: { input: 15, output: 75 },
};
const ctxOnly: ModelInfo = {
  provider: "x",
  id: "m",
  selector: "x/m",
  name: "M",
  contextWindow: 8000,
};
const bare: ModelInfo = {
  provider: "local",
  id: "tiny",
  selector: "local/tiny",
  name: "Tiny",
};

describe("modelOptionDescription (AGE-691)", () => {
  it("lists reasoning, context window, then input/output price in order", () => {
    expect(modelOptionDescription(full)).toBe(
      "reasoning · 200,000 ctx · $15/M in · $75/M out",
    );
  });

  it("omits fields the model does not carry", () => {
    expect(modelOptionDescription(ctxOnly)).toBe("8,000 ctx");
  });

  it("is undefined when no context/price/reasoning is known", () => {
    expect(modelOptionDescription(bare)).toBeUndefined();
  });
});

describe("modelComboboxOptions (AGE-691)", () => {
  it('prepends the "First available" sentinel with an empty value', () => {
    const opts = modelComboboxOptions([full]);
    expect(opts[0]).toEqual(FIRST_AVAILABLE_OPTION);
    expect(opts[0]).toEqual({ value: "", label: "First available" });
  });

  it("maps each model to value=selector, label=name, context/price description", () => {
    const opts = modelComboboxOptions([full, bare]);
    expect(opts).toHaveLength(3);
    expect(opts[1]).toEqual({
      value: "anthropic/claude-opus-4",
      label: "Claude Opus 4",
      description: "reasoning · 200,000 ctx · $15/M in · $75/M out",
    });
    // bare model: toEqual ignores the undefined `description`, so this also
    // pins that no context/price line is fabricated for it.
    expect(opts[2]).toEqual({ value: "local/tiny", label: "Tiny" });
  });

  it("surfaces context/price to the Combobox filter (type-to-filter by price)", () => {
    const opts = modelComboboxOptions([full, ctxOnly, bare]);
    // "$75/M out" lives only in the full model's description.
    expect(filterOptions(opts, "75/M").map((o) => o.value)).toEqual([
      "anthropic/claude-opus-4",
    ]);
    // "reasoning" likewise narrows to the reasoning-capable model.
    expect(filterOptions(opts, "reasoning").map((o) => o.value)).toEqual([
      "anthropic/claude-opus-4",
    ]);
  });
});

// AGE-691 — options for the Settings default-model Combobox. The picker itself
// has been a searchable `ui/Combobox` since AGE-612; this surfaces the same
// context-window + per-million token prices the Models catalog shows on each
// option's secondary line, so the dropdown is self-describing and the price/ctx
// text is searchable via the Combobox's `filterOptions` (matches description).

import type { ModelInfo } from "@shared/domain";
import type { ComboboxOption } from "@/components/ui/Combobox";
import { formatNumber } from "@/lib/format";

/** Sentinel option: empty value clears `settings.defaultModel` → "first available". */
export const FIRST_AVAILABLE_OPTION: ComboboxOption = {
  value: "",
  label: "First available",
};

/**
 * Secondary line for a model's option — `reasoning`, context window, and input /
 * output prices, in that order, joined by " · ". Mirrors the Models catalog and
 * omits any field the model does not carry; returns undefined when none apply.
 */
export function modelOptionDescription(model: ModelInfo): string | undefined {
  const parts: string[] = [];
  if (model.reasoning) parts.push("reasoning");
  if (typeof model.contextWindow === "number") {
    parts.push(`${formatNumber(model.contextWindow)} ctx`);
  }
  if (model.cost?.input != null) parts.push(`$${model.cost.input}/M in`);
  if (model.cost?.output != null) parts.push(`$${model.cost.output}/M out`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Options for the default-model picker: the "First available" sentinel followed
 * by every model, each labelled by name with a context/price description.
 */
export function modelComboboxOptions(models: ModelInfo[]): ComboboxOption[] {
  return [
    FIRST_AVAILABLE_OPTION,
    ...models.map((model) => ({
      value: model.selector,
      label: model.name,
      description: modelOptionDescription(model),
    })),
  ];
}

export interface ModelOptionGroup {
  provider: string;
  models: ModelInfo[];
}

/** Group models by provider id, sorted alphabetically by provider. */
export function groupModelsByProvider(models: ModelInfo[]): ModelOptionGroup[] {
  const byProvider = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const arr = byProvider.get(model.provider);
    if (arr) arr.push(model);
    else byProvider.set(model.provider, [model]);
  }
  return Array.from(byProvider, ([provider, items]) => ({
    provider,
    models: items,
  })).sort((a, b) => a.provider.localeCompare(b.provider));
}

/** Case-insensitive match over model name, provider, id, and selector. */
export function filterModels(models: ModelInfo[], query: string): ModelInfo[] {
  const q = query.trim().toLowerCase();
  if (q === "") return models;
  return models.filter(
    (model) =>
      model.name.toLowerCase().includes(q) ||
      model.provider.toLowerCase().includes(q) ||
      model.id.toLowerCase().includes(q) ||
      model.selector.toLowerCase().includes(q),
  );
}

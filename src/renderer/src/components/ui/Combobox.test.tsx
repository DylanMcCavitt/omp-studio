// AGE-612 §3 — the Combobox primitive (the sanctioned replacement for the model
// `<select>`). Verifies it shows the selected/placeholder label, opens a
// filterable list, narrows by the typed query, and selects by click or keyboard
// (Enter) — closing and reporting the chosen value. Plus the pure filter helper.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Combobox, type ComboboxOption, filterOptions } from "./Combobox";

const OPTIONS: ComboboxOption[] = [
  { value: "a", label: "Apple" },
  { value: "b", label: "Banana" },
  { value: "c", label: "Cherry" },
];

function Harness({
  value = "",
  onChange = () => {},
}: {
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <Combobox
      aria-label="Fruit"
      value={value}
      onChange={onChange}
      options={OPTIONS}
      placeholder="Pick a fruit"
    />
  );
}

it("shows the placeholder and opens the full list", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  const trigger = screen.getByRole("combobox", { name: "Fruit" });
  expect(trigger).toHaveTextContent("Pick a fruit");

  await user.click(trigger);
  expect(screen.getByRole("option", { name: /Apple/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Banana/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Cherry/ })).toBeInTheDocument();
});

it("shows the selected option's label on the trigger", () => {
  render(<Harness value="b" />);
  const trigger = screen.getByRole("combobox", { name: "Fruit" });
  expect(trigger).toHaveTextContent("Banana");
  expect(screen.getByText("Banana")).toHaveClass("min-w-0", "flex-1", "truncate");
  expect(screen.getByText("Banana")).toHaveAttribute("title", "Banana");
});

it("filters the list as the query is typed", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  await user.click(screen.getByRole("combobox", { name: "Fruit" }));
  await user.type(screen.getByRole("combobox", { name: "Search…" }), "ban");

  expect(
    screen.queryByRole("option", { name: /Apple/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Banana/ })).toBeInTheDocument();
});

it("selects an option by click, reporting its value and closing", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<Harness onChange={onChange} />);

  await user.click(screen.getByRole("combobox", { name: "Fruit" }));
  await user.click(screen.getByRole("option", { name: /Banana/ }));

  expect(onChange).toHaveBeenCalledWith("b");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("selects the filtered option on Enter", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<Harness onChange={onChange} />);

  await user.click(screen.getByRole("combobox", { name: "Fruit" }));
  await user.type(
    screen.getByRole("combobox", { name: "Search…" }),
    "cher{Enter}",
  );

  expect(onChange).toHaveBeenCalledWith("c");
});

it("filterOptions matches label/description/value, case-insensitively", () => {
  expect(filterOptions(OPTIONS, "AP").map((o) => o.value)).toEqual(["a"]);
  expect(filterOptions(OPTIONS, "")).toHaveLength(3);
  expect(
    filterOptions(
      [{ value: "x", label: "Other", description: "a yellow fruit" }],
      "yellow",
    ),
  ).toHaveLength(1);
});

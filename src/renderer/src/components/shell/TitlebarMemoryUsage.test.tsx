import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TitlebarMemoryUsage } from "./TitlebarMemoryUsage";

const snapshot = {
  totalBytes: 1_610_612_736,
  appBytes: 268_435_456,
  ompBytes: 1_342_177_280,
  ompInstanceCount: 2,
  generatedAt: "2026-07-05T00:00:00.000Z",
};

beforeEach(() => {
  window.omp = {
    ...window.omp,
    getMemoryUsage: vi.fn().mockResolvedValue(snapshot),
  } as typeof window.omp;
});

it("shows total memory in the titlebar pill", async () => {
  render(<TitlebarMemoryUsage />);
  expect(
    await screen.findByRole("button", { name: "Memory usage 1.5 GB" }),
  ).toHaveTextContent("1.5 GB");
});

it("reveals an App / OMP breakdown tooltip on hover", async () => {
  const user = userEvent.setup();
  render(<TitlebarMemoryUsage />);

  const pill = await screen.findByRole("button", {
    name: "Memory usage 1.5 GB",
  });
  await user.hover(pill);

  expect(await screen.findByText("OMP (2)")).toBeInTheDocument();
  expect(screen.getByText("256.0 MB")).toBeInTheDocument();
  expect(screen.getByText("1.3 GB")).toBeInTheDocument();
  expect(screen.getAllByText("1.5 GB").length).toBeGreaterThanOrEqual(2);
});

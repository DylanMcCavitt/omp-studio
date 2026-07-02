import type { OmpApi } from "@shared/ipc";
import { fireEvent, render, screen } from "@testing-library/react";
import { AGENT_DRAG_MIME } from "@/lib/agentDrag";
import Agents from "./Agents";

function stubAgents(agents: unknown[]): void {
  Object.assign(window.omp, {
    listAgents: vi.fn().mockResolvedValue(agents),
  } as unknown as Partial<OmpApi>);
}

it("serializes agent cards as drag payloads for the chat composer", async () => {
  stubAgents([
    {
      name: "planner",
      description: "Plans the slice",
      source: "project",
      model: "pi/test",
      spawns: "reviewer,tester",
      readOnly: true,
    },
  ]);
  const setData = vi.fn();

  render(<Agents />);
  fireEvent.dragStart(
    await screen.findByLabelText("Drag planner agent into chat"),
    {
      dataTransfer: { setData, effectAllowed: "" },
    },
  );

  expect(setData).toHaveBeenCalledWith(AGENT_DRAG_MIME, expect.any(String));
  const payload = JSON.parse(setData.mock.calls[0]?.[1] as string);
  expect(payload).toMatchObject({
    name: "planner",
    source: "project",
    description: "Plans the slice",
    model: "pi/test",
    spawns: "reviewer,tester",
    readOnly: true,
  });
  expect(setData).toHaveBeenCalledWith("text/plain", "planner");
});

it("renders the two-column card content from existing agent data", async () => {
  stubAgents([
    {
      name: "builder",
      description: "Plans slices and ships focused renderer changes.",
      source: "builtin",
      model: "pi/test",
      readOnly: true,
    },
    {
      name: "reviewer",
      description: "Reviews the diff.",
      source: "user",
    },
  ]);

  render(<Agents />);

  expect(await screen.findByTestId("agents-card-grid")).toHaveClass(
    "sm:grid-cols-[repeat(2,minmax(0,1fr))]",
  );
  expect(screen.getByText("B")).toBeInTheDocument();
  expect(screen.getByText("builder")).toBeInTheDocument();
  expect(screen.getByText("pi/test")).toBeInTheDocument();
  expect(screen.getByText(/Plans slices/)).toHaveClass("line-clamp-3");
  expect(screen.getByText("builtin")).toBeInTheDocument();
  expect(screen.getByText("read-only")).toBeInTheDocument();
});

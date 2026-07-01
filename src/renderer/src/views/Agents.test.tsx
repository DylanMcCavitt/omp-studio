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

import type { McpServerInfo } from "@shared/domain";
import type { OmpApi } from "@shared/ipc";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Mcp from "./Mcp";

function server(overrides: Partial<McpServerInfo> = {}): McpServerInfo {
  return {
    name: overrides.name ?? "filesystem",
    type: overrides.type ?? "stdio",
    enabled: overrides.enabled ?? true,
    source: overrides.source ?? "user",
    command: overrides.command ?? "npx",
    args: overrides.args ?? [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/repo",
    ],
    url: overrides.url,
    authType: overrides.authType,
    toolCount: overrides.toolCount ?? 12,
  };
}

function installListMcpServers(results: McpServerInfo[][] = [[]]) {
  const listMcpServers = vi.fn(
    async () =>
      results[
        Math.min(listMcpServers.mock.calls.length - 1, results.length - 1)
      ],
  );
  Object.assign(window.omp, { listMcpServers } as Partial<OmpApi>);
  return listMcpServers;
}

beforeEach(() => {
  installListMcpServers();
});

it("renders configured MCP servers with their launch target and tool count", async () => {
  installListMcpServers([
    [
      server(),
      server({
        name: "linear",
        type: "sse",
        enabled: false,
        source: "project",
        command: "",
        args: [],
        url: "https://mcp.example.test/sse",
        authType: "oauth",
        toolCount: 3,
      }),
    ],
  ]);

  render(<Mcp />);

  expect(await screen.findByText("filesystem")).toBeInTheDocument();
  expect(
    screen.getByText("npx -y @modelcontextprotocol/server-filesystem /repo"),
  ).toBeInTheDocument();
  expect(screen.getByText("12 tools")).toBeInTheDocument();
  expect(screen.getByText("linear")).toBeInTheDocument();
  expect(screen.getByText("https://mcp.example.test/sse")).toBeInTheDocument();
  expect(screen.getByText("oauth")).toBeInTheDocument();
  expect(screen.getByText("3 tools")).toBeInTheDocument();
});

it("shows the empty state and reloads the read-only bridge on demand", async () => {
  const listMcpServers = installListMcpServers([
    [],
    [server({ name: "github" })],
  ]);
  const user = userEvent.setup();

  render(<Mcp />);

  expect(
    await screen.findByText("No MCP servers configured"),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reload" }));

  expect(await screen.findByText("github")).toBeInTheDocument();
  expect(listMcpServers).toHaveBeenCalledTimes(2);
});

it("surfaces load failures with a retry action", async () => {
  const listMcpServers = vi
    .fn()
    .mockRejectedValueOnce(new Error("mcp config unreadable"))
    .mockResolvedValueOnce([server({ name: "recovered" })]);
  Object.assign(window.omp, { listMcpServers } as Partial<OmpApi>);
  const user = userEvent.setup();

  render(<Mcp />);

  expect(
    await screen.findByText("Failed to load MCP servers"),
  ).toBeInTheDocument();
  expect(screen.getByText("mcp config unreadable")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));

  await waitFor(() => expect(listMcpServers).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("recovered")).toBeInTheDocument();
});

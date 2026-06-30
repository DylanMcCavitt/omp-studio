import type { DashboardData, OmpStatsSnapshot } from "@shared/domain";
import type { OmpApi } from "@shared/ipc";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLinearStore } from "@/store/linear";
import Dashboard from "./Dashboard";

const DASHBOARD: DashboardData = {
  sessions: {
    total: 2,
    recent: [],
    byProject: [
      {
        project: "port-omp",
        cwd: "/Users/dylanmccavitt/projects/port-omp",
        count: 2,
        lastActive: "2026-06-30T12:00:00.000Z",
      },
    ],
  },
  models: { total: 3, providers: 2, default: "openai/gpt-5.5" },
  mcp: [],
  skills: 4,
  agents: 5,
  github: { repo: null, openIssues: 0, openPrs: 0 },
  generatedAt: "2026-06-30T12:00:00.000Z",
};

const STATS: OmpStatsSnapshot = {
  generatedAt: "2026-06-30T12:01:00.000Z",
  overall: {
    totalRequests: 42,
    failedRequests: 2,
    errorRate: 0.0476,
    totalInputTokens: 100,
    totalOutputTokens: 50,
    totalCacheReadTokens: 200,
    totalCacheWriteTokens: 0,
    cacheRate: 0.57,
    totalCost: 1.234,
    avgTtft: 850,
    avgDuration: 1900,
    avgTokensPerSecond: 33.3,
    lastTimestamp: Date.UTC(2026, 5, 30, 12, 0, 0),
  },
  byModel: [
    {
      provider: "openai",
      model: "gpt-5.5",
      totalRequests: 30,
      totalCost: 1.1,
    },
  ],
  byFolder: [{ folder: "port-omp", totalRequests: 42, totalCost: 1.234 }],
  byAgentType: [
    { agentType: "main", totalRequests: 20, totalCost: 0.7 },
    { agentType: "subagent", totalRequests: 22, totalCost: 0.534 },
  ],
  timeSeries: [{ timestamp: Date.UTC(2026, 5, 30), totalRequests: 42 }],
};

function stubBridge(overrides: Partial<OmpApi> = {}) {
  Object.assign(window.omp, {
    getDashboard: vi.fn(async () => DASHBOARD),
    getOmpStats: vi.fn(async () => STATS),
    linear: {
      status: vi.fn(async () => ({
        status: "unauthenticated",
        writesEnabled: false,
      })),
      listIssues: vi.fn(async () => []),
    },
    ...overrides,
  } as unknown as Partial<OmpApi>);
}

beforeEach(() => {
  useLinearStore.setState(useLinearStore.getInitialState());
  stubBridge();
});

it("renders local OMP stats without replacing existing dashboard cards", async () => {
  render(<Dashboard />);

  expect(await screen.findByText("OMP stats")).toBeInTheDocument();
  expect(screen.getByText("Sessions")).toBeInTheDocument();
  expect(screen.getByText("Requests")).toBeInTheDocument();
  expect(screen.getByText("42")).toBeInTheDocument();
  expect(screen.getByText("Est. cost")).toBeInTheDocument();
  expect(screen.getByText("$1.23")).toBeInTheDocument();
  expect(screen.getByText("57.0% cache hit")).toBeInTheDocument();
  expect(screen.getByText("openai/gpt-5.5")).toBeInTheDocument();
  expect(screen.getAllByText("port-omp").length).toBeGreaterThan(0);
  expect(screen.getByText("subagent")).toBeInTheDocument();
});

it("keeps the dashboard usable when OMP stats are unavailable", async () => {
  stubBridge({ getOmpStats: vi.fn(async () => null) });

  render(<Dashboard />);

  expect(await screen.findByText("Sessions")).toBeInTheDocument();
  expect(await screen.findByText("OMP stats unavailable")).toBeInTheDocument();
  expect(
    screen.getByText(/stats appear when `omp stats --json`/i),
  ).toBeInTheDocument();
});

it("refreshes dashboard data and stats from the same reload button", async () => {
  const user = userEvent.setup();
  render(<Dashboard />);

  await screen.findByText("OMP stats");
  await user.click(screen.getByLabelText("Reload dashboard"));

  await waitFor(() => expect(window.omp.getDashboard).toHaveBeenCalledTimes(2));
  expect(window.omp.getOmpStats).toHaveBeenCalledTimes(2);
});

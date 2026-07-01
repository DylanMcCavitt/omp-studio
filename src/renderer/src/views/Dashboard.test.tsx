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

  expect(
    await screen.findByRole("heading", { name: "Overview" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Sessions")).toBeInTheDocument();
  expect(screen.getByText("Total cost")).toBeInTheDocument();
  expect(screen.getByText("Requests")).toBeInTheDocument();
  expect(screen.getByText("42")).toBeInTheDocument();
  expect(screen.getByText("$1.23")).toBeInTheDocument();
  expect(screen.getByText("Cache rate")).toBeInTheDocument();
  expect(screen.getByText("57.0%")).toBeInTheDocument();
  expect(screen.getByText("Token Usage by Agent")).toBeInTheDocument();
  expect(screen.getByText("System Throughput")).toBeInTheDocument();
  expect(screen.getByText("openai/gpt-5.5")).toBeInTheDocument();
  expect(screen.getAllByText("port-omp").length).toBeGreaterThan(0);
  expect(screen.getByText("subagent")).toBeInTheDocument();
});

it("updates visible OMP stats when a range control is selected", async () => {
  const user = userEvent.setup();
  const latest = Date.UTC(2026, 5, 30, 12, 0, 0);
  const twoHoursAgo = latest - 2 * 60 * 60 * 1000;
  const twoDaysAgo = latest - 2 * 24 * 60 * 60 * 1000;
  const rangeStats = {
    ...STATS,
    overall: {
      ...(STATS.overall ?? {}),
      totalRequests: 142,
      failedRequests: 4,
      totalCost: 11.224,
      lastTimestamp: latest,
    },
    timeSeries: [
      {
        timestamp: twoDaysAgo,
        totalRequests: 100,
        failedRequests: 2,
        totalCost: 9.99,
      },
      {
        timestamp: twoHoursAgo,
        totalRequests: 35,
        failedRequests: 1,
        totalCost: 1.084,
      },
      {
        timestamp: latest,
        totalRequests: 7,
        failedRequests: 1,
        totalCost: 0.15,
      },
    ],
    costSeries: [
      {
        provider: "anthropic",
        model: "claude-older",
        timestamp: twoHoursAgo,
        totalRequests: 35,
        totalCost: 1.084,
      },
      {
        provider: "openai",
        model: "gpt-latest",
        timestamp: latest,
        totalRequests: 7,
        totalCost: 0.15,
      },
    ],
    modelPerformanceSeries: [
      {
        provider: "anthropic",
        model: "claude-older",
        timestamp: twoHoursAgo,
        totalRequests: 35,
        avgTtft: 900,
        avgTokensPerSecond: 40,
      },
      {
        provider: "openai",
        model: "gpt-latest",
        timestamp: latest,
        totalRequests: 7,
        avgTtft: 700,
        avgTokensPerSecond: 50,
      },
    ],
  } satisfies OmpStatsSnapshot;
  stubBridge({ getOmpStats: vi.fn(async () => rangeStats) });

  render(<Dashboard />);

  const defaultRange = await screen.findByRole("button", { name: "24h" });
  expect(defaultRange).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText(/auto-refreshes every 30s/i)).toBeInTheDocument();
  expect(screen.getByText("42")).toBeInTheDocument();
  expect(screen.getByText("$1.23")).toBeInTheDocument();
  expect(
    screen.getByText(
      "Showing 24h request/cost data · 2 failed requests · 350 all-time tokens · 2 trend points",
    ),
  ).toBeInTheDocument();
  expect(screen.getAllByText("anthropic/claude-older").length).toBeGreaterThan(
    0,
  );

  const oneHourRange = screen.getByRole("button", { name: "1h" });
  await user.click(oneHourRange);

  expect(oneHourRange).toHaveAttribute("aria-pressed", "true");
  expect(defaultRange).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByText("7")).toBeInTheDocument();
  expect(screen.getByText("$0.1500")).toBeInTheDocument();
  expect(
    screen.getByText(
      "Showing 1h request/cost data · 1 failed requests · 350 all-time tokens · 1 trend points",
    ),
  ).toBeInTheDocument();
  expect(screen.getAllByText("openai/gpt-latest").length).toBeGreaterThan(0);
  expect(screen.queryByText("anthropic/claude-older")).not.toBeInTheDocument();
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

it("keeps raw folder labels when workspace basename matching is ambiguous", async () => {
  stubBridge({
    getDashboard: vi.fn(async () => ({
      ...DASHBOARD,
      sessions: {
        ...DASHBOARD.sessions,
        byProject: [
          {
            project: "alpha",
            cwd: "/tmp/app",
            count: 1,
            lastActive: "2026-06-30T12:00:00.000Z",
          },
          {
            project: "beta",
            cwd: "/work/app",
            count: 1,
            lastActive: "2026-06-30T12:00:00.000Z",
          },
        ],
      },
    })),
    getOmpStats: vi.fn(async () => ({
      ...STATS,
      byFolder: [{ folder: "app", totalRequests: 3, totalCost: 0.1 }],
    })),
  });

  render(<Dashboard />);

  expect(
    await screen.findByRole("heading", { name: "Overview" }),
  ).toBeInTheDocument();
  expect(screen.getByText("app")).toBeInTheDocument();
});

it("refreshes dashboard data and stats from the same reload button", async () => {
  const user = userEvent.setup();
  render(<Dashboard />);

  await screen.findByRole("heading", { name: "Overview" });
  await user.click(screen.getByLabelText("Reload dashboard"));

  await waitFor(() => expect(window.omp.getDashboard).toHaveBeenCalledTimes(2));
  expect(window.omp.getOmpStats).toHaveBeenCalledTimes(2);
});

// AGE-623 — the Linear connect/disconnect surface. The security-load-bearing
// behavior: the API key is forwarded to main exactly once, the input is CLEARED
// on submit, and no copy of the key is ever retained in the renderer store.
// Disconnect calls clearApiKey and drops back to the unauthenticated state.

import type { LinearStatusInfo } from "@shared/domain";
import type { OmpApi } from "@shared/ipc";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLinearStore } from "@/store/linear";
import { LinearConnectCard } from "./LinearConnectCard";

const UNAUTH: LinearStatusInfo = {
  status: "unauthenticated",
  writesEnabled: false,
  persisted: false,
};
const AUTHED: LinearStatusInfo = {
  status: "authenticated",
  writesEnabled: false,
  persisted: true,
  viewer: {
    id: "u1",
    name: "Ada Lovelace",
    organization: "Analytical Engines",
  },
};

function resetStore() {
  useLinearStore.setState({
    status: null,
    statusLoading: false,
    connecting: false,
    teams: [],
    projects: [],
    issues: [],
    loading: false,
    error: undefined,
  });
}

function stubLinear(over: Record<string, unknown>) {
  Object.assign(window.omp, {
    openExternal: vi.fn(),
    linear: {
      status: vi.fn().mockResolvedValue(UNAUTH),
      setApiKey: vi.fn().mockResolvedValue(AUTHED),
      clearApiKey: vi.fn().mockResolvedValue(undefined),
      listTeams: vi.fn().mockResolvedValue([]),
      listProjects: vi.fn().mockResolvedValue([]),
      listIssues: vi.fn().mockResolvedValue([]),
      getIssue: vi.fn().mockResolvedValue(null),
      ...over,
    },
  } as unknown as Partial<OmpApi>);
}

beforeEach(resetStore);

it("clears the key field on submit and never retains the key, even when rejected", async () => {
  const user = userEvent.setup();
  const setApiKey = vi.fn().mockResolvedValue(UNAUTH); // server rejects the key
  stubLinear({ setApiKey });
  useLinearStore.setState({ status: UNAUTH });

  render(<LinearConnectCard />);
  const input = screen.getByLabelText("Linear API key");
  const SECRET = "lin_api_topsecret_value_123";
  await user.type(input, SECRET);
  await user.click(screen.getByRole("button", { name: "Connect" }));

  // Forwarded exactly once, verbatim — then the field is wiped.
  expect(setApiKey).toHaveBeenCalledTimes(1);
  expect(setApiKey).toHaveBeenCalledWith(SECRET);
  await waitFor(() => expect(input).toHaveValue(""));

  // A rejected key keeps the form up with guidance, and the secret is nowhere
  // in the store snapshot.
  expect(screen.getByText(/could not be verified/i)).toBeInTheDocument();
  expect(JSON.stringify(useLinearStore.getState())).not.toContain(SECRET);
});

it("adopts the returned status on a valid key without storing the key", async () => {
  const user = userEvent.setup();
  const setApiKey = vi.fn().mockResolvedValue(AUTHED);
  stubLinear({ setApiKey });
  useLinearStore.setState({ status: UNAUTH });

  render(<LinearConnectCard />);
  const SECRET = "lin_api_valid_key_xyz";
  await user.type(screen.getByLabelText("Linear API key"), SECRET);
  await user.click(screen.getByRole("button", { name: "Connect" }));

  expect(setApiKey).toHaveBeenCalledWith(SECRET);
  // The card flips to the connected state…
  expect(await screen.findByText("Connected")).toBeInTheDocument();
  const disconnect = screen.getByRole("button", { name: /Disconnect/ });
  expect(disconnect).toBeInTheDocument();
  expect(disconnect.className).toContain("bg-warn/10");
  expect(disconnect.className).not.toContain("text-danger");
  // …status is adopted, and still no key is held anywhere in the store.
  expect(useLinearStore.getState().status?.status).toBe("authenticated");
  expect(JSON.stringify(useLinearStore.getState())).not.toContain(SECRET);
});

it("warns when the validated key is memory-only for this session", () => {
  stubLinear({});
  useLinearStore.setState({
    status: { ...AUTHED, persisted: false },
  });

  render(<LinearConnectCard />);

  expect(
    screen.getByText("Connected for this session only."),
  ).toBeInTheDocument();
  expect(screen.getByText(/will not survive restart/i)).toBeInTheDocument();
  expect(screen.getByText(/libsecret/i)).toBeInTheDocument();
  const warning = screen
    .getByText("Connected for this session only.")
    .closest("div")?.parentElement;
  expect(warning?.className).toContain("border-warn/40");
  expect(warning?.className).toContain("bg-warn/10");
});

it("disconnects via clearApiKey and resets to unauthenticated", async () => {
  const user = userEvent.setup();
  const clearApiKey = vi.fn().mockResolvedValue(undefined);
  stubLinear({ clearApiKey });
  useLinearStore.setState({
    status: AUTHED,
    teams: [{ id: "t1", key: "ENG", name: "Engineering" }],
    issues: [
      {
        id: "i1",
        identifier: "ENG-1",
        title: "x",
        url: "https://linear.app/x",
        state: { name: "Todo", type: "unstarted" },
        updatedAt: "2026-06-01T00:00:00.000Z",
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    ],
  });

  render(<LinearConnectCard />);
  expect(screen.getByText("Connected")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Disconnect/ }));

  expect(clearApiKey).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(useLinearStore.getState().status?.status).toBe("unauthenticated"),
  );
  // Disconnect detaches the renderer from every cached Linear shape.
  expect(useLinearStore.getState().issues).toEqual([]);
  expect(useLinearStore.getState().teams).toEqual([]);
});

it("surfaces a primary Connect CTA and a clear Get a personal API key link", async () => {
  const user = userEvent.setup();
  stubLinear({});
  useLinearStore.setState({ status: UNAUTH });

  render(<LinearConnectCard />);
  // The primary CTA is present and labeled.
  expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  // The key-minting link is surfaced (not buried) and opens Linear's API settings.
  const link = screen.getByRole("button", { name: /Get a personal API key/ });
  await user.click(link);
  expect(window.omp.openExternal).toHaveBeenCalledWith(
    "https://linear.app/settings/api",
  );
});

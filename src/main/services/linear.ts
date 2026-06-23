// Linear integration service (feature 2). ALL Linear HTTP happens here, in the
// MAIN process, over Node's global `fetch`. The renderer only ever invokes the
// `linear:*` IPC channels and sees the mapped domain shapes below — it never
// touches the network or the API key.
//
// CSP NOTE: because the renderer never talks to api.linear.app directly, the
// renderer CSP `connect-src 'self'` is already satisfied. DO NOT add
// api.linear.app to the CSP — that would only matter if the renderer fetched
// directly, which it must never do.
//
// Plain-node + electron-free (testability): the API key arrives via an injected
// `getApiKey: () => Promise<string | null>` (mirrors config-service's injectable
// runner). The electron-bound safeStorage secret store lives ONLY in the IPC
// layer (ipc/linear.ts); this module imports no electron, so `bun test` can
// exercise it by stubbing `fetch` + `getApiKey`.
//
// Graceful-degrade contract (mirrors github.ts / runJson): every method returns
// `null` / `[]` on ANY failure — missing key, network error, abort/timeout,
// non-2xx HTTP, GraphQL `errors`, or invalid JSON. Nothing throws across IPC.

import type {
  LinearIssue,
  LinearProjectInfo,
  LinearTeam,
  LinearViewer,
} from "@shared/domain";

const ENDPOINT = "https://api.linear.app/graphql";

/** Hard ceiling on a single Linear request (network can hang; we never retry). */
const REQUEST_TIMEOUT_MS = 10_000;

/** Default page size for list queries when the caller gives no limit. */
const DEFAULT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Raw wire shapes (everything optional — Linear may omit fields, and we never
// trust the payload). Mapped into the strict domain types before returning.
// ---------------------------------------------------------------------------

interface RawViewer {
  id?: string;
  name?: string;
  email?: string;
}

interface RawTeam {
  id?: string;
  key?: string;
  name?: string;
}

interface RawProject {
  id?: string;
  name?: string;
  state?: string;
  url?: string;
  progress?: number;
}

interface RawIssue {
  id?: string;
  identifier?: string;
  title?: string;
  url?: string;
  state?: { name?: string; type?: string } | null;
  priority?: number | null;
  assignee?: { name?: string } | null;
  team?: { key?: string } | null;
  project?: { name?: string } | null;
  updatedAt?: string;
  createdAt?: string;
}

interface Connection<T> {
  nodes?: T[];
}

// ---------------------------------------------------------------------------
// GraphQL documents. Issue fields are factored out so reads and mutations map
// through the same `mapIssue`.
// ---------------------------------------------------------------------------

const ISSUE_FIELDS = `
  id
  identifier
  title
  url
  state { name type }
  priority
  assignee { name }
  team { key }
  project { name }
  updatedAt
  createdAt
`;

const VIEWER_QUERY = `
  query Viewer {
    viewer { id name email }
    organization { name }
  }
`;

const TEAMS_QUERY = `
  query Teams { teams { nodes { id key name } } }
`;

const PROJECTS_QUERY = `
  query Projects($first: Int) {
    projects(first: $first) { nodes { id name state url progress } }
  }
`;

const TEAM_PROJECTS_QUERY = `
  query TeamProjects($teamId: String!, $first: Int) {
    team(id: $teamId) {
      projects(first: $first) { nodes { id name state url progress } }
    }
  }
`;

const ISSUES_QUERY = `
  query Issues($filter: IssueFilter, $first: Int) {
    issues(filter: $filter, first: $first) { nodes { ${ISSUE_FIELDS} } }
  }
`;

const ISSUE_QUERY = `
  query Issue($id: String!) {
    issue(id: $id) { ${ISSUE_FIELDS} }
  }
`;

const ISSUE_CREATE = `
  mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } }
  }
`;

const ISSUE_UPDATE = `
  mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } }
  }
`;

const COMMENT_CREATE = `
  mutation CommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) { success }
  }
`;

// ---------------------------------------------------------------------------
// Issue mapper (raw → domain), tolerant of missing fields. Shared by every
// read and mutation so they stay in lockstep. Projects/teams/viewer map inline
// at their single call sites.
// ---------------------------------------------------------------------------

function mapIssue(raw: RawIssue): LinearIssue {
  return {
    id: raw.id ?? "",
    identifier: raw.identifier ?? "",
    title: raw.title ?? "",
    url: raw.url ?? "",
    state: { name: raw.state?.name ?? "", type: raw.state?.type ?? "" },
    priority: raw.priority ?? undefined,
    assignee: raw.assignee ? { name: raw.assignee.name ?? "" } : null,
    team: raw.team ? { key: raw.team.key ?? "" } : null,
    project: raw.project ? { name: raw.project.name ?? "" } : null,
    updatedAt: raw.updatedAt ?? "",
    createdAt: raw.createdAt ?? "",
  };
}

// ---------------------------------------------------------------------------
// The injectable service
// ---------------------------------------------------------------------------

export interface LinearService {
  /** Validate auth + identity. `null` when unauthenticated or the probe fails. */
  viewer(): Promise<LinearViewer | null>;
  teams(): Promise<LinearTeam[]>;
  projects(teamId?: string): Promise<LinearProjectInfo[]>;
  issues(opts?: {
    teamId?: string;
    assignedToMe?: boolean;
    limit?: number;
  }): Promise<LinearIssue[]>;
  issue(id: string): Promise<LinearIssue | null>;
  // Write surface — callers (ipc/linear.ts) gate these behind writesEnabled.
  createIssue(input: {
    teamId: string;
    title: string;
    description?: string;
  }): Promise<LinearIssue | null>;
  updateIssue(
    id: string,
    patch: { stateId?: string; title?: string; description?: string },
  ): Promise<LinearIssue | null>;
  createComment(issueId: string, body: string): Promise<boolean>;
}

/**
 * Build a Linear service bound to a key getter. The getter is resolved on every
 * request (so a key set/cleared mid-session is picked up immediately) and is the
 * only injection point — the network uses the process-global `fetch`, which
 * tests override via `globalThis.fetch`.
 */
export function createLinearService(
  getApiKey: () => Promise<string | null>,
): LinearService {
  /**
   * Issue one GraphQL request and return its `data` payload, or `null` on ANY
   * failure. The Linear personal API key is sent RAW in `Authorization` — NOT
   * as a `Bearer` token (Linear rejects the `Bearer ` prefix for API keys).
   */
  async function query<T>(
    document: string,
    variables?: Record<string, unknown>,
  ): Promise<T | null> {
    let key: string | null;
    try {
      key = await getApiKey();
    } catch {
      return null;
    }
    if (!key) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          // Raw key — see note above; NOT `Bearer <key>`.
          Authorization: key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: document, variables }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        data?: T | null;
        errors?: unknown;
      };
      // Any GraphQL-level error invalidates the whole response.
      if (
        json.errors &&
        (!Array.isArray(json.errors) || json.errors.length > 0)
      ) {
        return null;
      }
      return json.data ?? null;
    } catch {
      // Network failure, abort/timeout, or invalid JSON — degrade to null.
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async viewer() {
      const data = await query<{
        viewer?: RawViewer | null;
        organization?: { name?: string } | null;
      }>(VIEWER_QUERY);
      if (!data?.viewer) return null;
      return {
        id: data.viewer.id ?? "",
        name: data.viewer.name ?? "",
        email: data.viewer.email ?? undefined,
        organization: data.organization?.name ?? undefined,
      };
    },

    async teams() {
      const data = await query<{ teams?: Connection<RawTeam> }>(TEAMS_QUERY);
      const nodes = data?.teams?.nodes ?? [];
      return nodes.map((t) => ({
        id: t.id ?? "",
        key: t.key ?? "",
        name: t.name ?? "",
      }));
    },

    async projects(teamId?: string) {
      let nodes: RawProject[];
      if (teamId) {
        const data = await query<{
          team?: { projects?: Connection<RawProject> } | null;
        }>(TEAM_PROJECTS_QUERY, { teamId, first: DEFAULT_PAGE_SIZE });
        nodes = data?.team?.projects?.nodes ?? [];
      } else {
        const data = await query<{ projects?: Connection<RawProject> }>(
          PROJECTS_QUERY,
          { first: DEFAULT_PAGE_SIZE },
        );
        nodes = data?.projects?.nodes ?? [];
      }
      return nodes.map((p) => ({
        id: p.id ?? "",
        name: p.name ?? "",
        state: p.state ?? undefined,
        url: p.url ?? undefined,
        progress: p.progress ?? undefined,
      }));
    },

    async issues(opts) {
      const filter: Record<string, unknown> = {};
      if (opts?.teamId) filter.team = { id: { eq: opts.teamId } };
      if (opts?.assignedToMe) filter.assignee = { isMe: { eq: true } };
      const data = await query<{ issues?: Connection<RawIssue> }>(
        ISSUES_QUERY,
        {
          filter: Object.keys(filter).length > 0 ? filter : undefined,
          first: opts?.limit ?? DEFAULT_PAGE_SIZE,
        },
      );
      return (data?.issues?.nodes ?? []).map(mapIssue);
    },

    async issue(id: string) {
      const data = await query<{ issue?: RawIssue | null }>(ISSUE_QUERY, {
        id,
      });
      return data?.issue ? mapIssue(data.issue) : null;
    },

    async createIssue(input) {
      const data = await query<{
        issueCreate?: { success?: boolean; issue?: RawIssue | null } | null;
      }>(ISSUE_CREATE, { input });
      const result = data?.issueCreate;
      return result?.success && result.issue ? mapIssue(result.issue) : null;
    },

    async updateIssue(id, patch) {
      const data = await query<{
        issueUpdate?: { success?: boolean; issue?: RawIssue | null } | null;
      }>(ISSUE_UPDATE, { id, input: patch });
      const result = data?.issueUpdate;
      return result?.success && result.issue ? mapIssue(result.issue) : null;
    },

    async createComment(issueId, body) {
      const data = await query<{
        commentCreate?: { success?: boolean } | null;
      }>(COMMENT_CREATE, { input: { issueId, body } });
      return data?.commentCreate?.success === true;
    },
  };
}

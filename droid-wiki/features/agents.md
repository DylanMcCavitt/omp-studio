# Bundled agents

The agents panel explores the task subagents available to the `omp` harness. Each agent is a markdown file with YAML frontmatter (`name`, `description`, `model`, `spawns`); the panel renders them as draggable cards so you can drop one into the chat composer to spawn that agent. Discovery merges three sources: the builtin agents materialized from `omp agents unpack`, the user agents under `~/.omp/agent/agents`, and the project agents under `<cwd>/.omp/agents`.

## Key abstractions

| Abstraction | File | Role |
| --- | --- | --- |
| `listAgents` | `src/main/services/config-service.ts` | Discovers agents from three sources, dedups by name (later sources overwrite earlier), and returns `AgentInfo[]`. |
| `AgentInfo` | `src/shared/domain.ts` | One agent: `name`, `description`, optional `model` / `spawns`, `source` (`builtin`, `user`, or `project`), `readOnly` flag, and `path`. |
| `collectAgents` | `src/main/services/config-service.ts` | Reads every `*.md` in a directory, parses frontmatter, and pushes `AgentInfo` entries into a name-keyed map. `readOnly` is inferred from the description (`/READ-ONLY/i`) or the name `explore`. |
| `parseFrontmatter` | `src/main/services/config-service.ts` | Shared `---`-delimited YAML frontmatter parser (column-0 scalar keys only, with block-list fallback). Used by both agents and skills. |

## How it works

`listAgents(cwd)` discovers agents in three steps, writing into a single name-keyed `Map` so later sources overwrite earlier ones on a name collision:

1. **Builtin**: `mkdtemp` creates a temp dir under `os.tmpdir()`, `runCli(ompBinary(), ["agents", "unpack", "--dir", tmp, "--json"])` materializes the bundled agents there, and `collectAgents(tmp, "builtin", …)` reads them. The temp dir is removed in a `finally` block (`rm(tmp, { recursive: true, force: true })`) whether or not unpack succeeded. An unpack failure is caught and swallowed, so the panel still shows user and project agents when the CLI is unavailable.
2. **User**: `collectAgents(join(agentDir(), "agents"), "user", …)`.
3. **Project**: `collectAgents(join(cwd ?? process.cwd(), ".omp", "agents"), "project", …)`.

The `name` falls back to the filename stem when frontmatter omits it; `description` defaults to empty. The `readOnly` flag is set when the description matches `/READ-ONLY/i` or the name is exactly `explore`, marking agents that have no edit/write/exec tools.

### Drag into chat

Each card is a `draggable` button. On `dragStart` it calls `serializeAgentDrag(agent)` (from `src/renderer/src/lib/agentDrag.ts`) and sets the `AGENT_DRAG_MIME` payload plus a `text/plain` fallback onto the `DataTransfer`. The chat composer's `AgentDropChooser` reads that payload to spawn the dropped agent. See [Session management](chat/session-management.md) for the drop target.

## Integration points

- **Backend and IPC wiring** are covered in [Data services](../systems/data-services.md); the domain type is documented in [Domain types](../primitives/domain-types.md).
- **The drop target** (AgentDropChooser in the composer) is covered in [Session management](chat/session-management.md).
- **Dashboard** shows the agent count as a stat card; see [Dashboard](dashboard.md).
- **Frontmatter parsing** is shared with the skills discovery in the same `config-service.ts` file.

## Key source files

| File | Purpose |
| --- | --- |
| `src/renderer/src/views/Agents.tsx` | The panel: draggable agent cards with monogram, model, source, read-only badge. |
| `src/main/services/config-service.ts` | `listAgents` (temp-dir unpack + user/project), `collectAgents`, `parseFrontmatter`. |
| `src/renderer/src/lib/agentDrag.ts` | `serializeAgentDrag` and `AGENT_DRAG_MIME` for the composer drop. |
| `src/shared/domain.ts` | `AgentInfo`. |
| `src/main/ipc/data.ts` | `CH.listAgents` handler with `resolveCwd`. |

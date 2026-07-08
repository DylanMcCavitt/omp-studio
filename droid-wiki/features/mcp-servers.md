# MCP servers

The MCP servers panel inspects the Model Context Protocol servers configured for the `omp` harness. It merges two sources: the user-level config at `~/.omp/agent/mcp.json` and the project-level config at `<cwd>/.mcp.json`. Each server is rendered as a card with its name, transport type, target (URL or command), auth type, enabled state, and which source it came from. The panel is read-only; you configure servers by editing the JSON files and reloading.

## Key abstractions

| Abstraction | File | Role |
| --- | --- | --- |
| `listMcpServers` | `src/main/services/config-service.ts` | Reads `mcpConfigPath()` (user) then `<cwd>/.mcp.json` (project), parses each `mcpServers` map, and returns `McpServerInfo[]` tagged with `source`. A missing or unparseable file is skipped silently. |
| `McpServerInfo` | `src/shared/domain.ts` | One server: `name`, `type` (`http`, `sse`, `stdio`, ...), `url` or `command` + `args`, `authType`, `enabled`, `source` (`user` or `project`), optional `toolCount`. |
| `collectMcp` | `src/main/services/config-service.ts` | Reads one config file, parses its `mcpServers` object, and pushes `McpServerInfo` entries into the output array with the given `source` tag. `enabled` defaults to `true` (`enabled !== false`), and `type` defaults to `stdio` when omitted. |

## How it works

`listMcpServers(cwd)` calls `collectMcp` twice: first on `mcpConfigPath()` (the user config, `~/.omp/agent/mcp.json`) with `source: "user"`, then on `join(cwd ?? process.cwd(), ".mcp.json")` with `source: "project"`. Both arrays are concatenated in source order, so a server defined in both files appears twice (once per source) rather than one overwriting the other. The `cwd` is threaded from the active workspace through `registerDataIpc`'s `resolveCwd` in `src/main/ipc/data.ts` (see [Data services](../systems/data-services.md)).

The view (`src/renderer/src/views/Mcp.tsx`) loads the list once via `useAsync(() => window.omp.listMcpServers())` and renders each entry as a `Card`. The target line shows `server.url` for HTTP/SSE servers, or the joined `command` + `args` for stdio servers. A colored dot indicates `enabled` (green) versus disabled (muted), an `authType` badge appears when set, and a `toolCount` (when present) is shown as a footnote. Reload re-runs the read.

## Integration points

- **Backend and IPC wiring** are covered in [Data services](../systems/data-services.md); the domain type is documented in [Domain types](../primitives/domain-types.md).
- **Dashboard** shows a compact MCP server list and the count as a stat card; see [Dashboard](dashboard.md).
- The `cwd` resolver and project scoping follow the workspace model described in [Architecture](../overview/architecture.md).

## Key source files

| File | Purpose |
| --- | --- |
| `src/renderer/src/views/Mcp.tsx` | The panel: server cards with type, target, auth, enabled dot, source badge. |
| `src/main/services/config-service.ts` | `listMcpServers` and `collectMcp` (user + project merge). |
| `src/main/paths.ts` | `mcpConfigPath()` resolves `~/.omp/agent/mcp.json`. |
| `src/shared/domain.ts` | `McpServerInfo`. |
| `src/main/ipc/data.ts` | `CH.listMcp` handler with `resolveCwd`. |

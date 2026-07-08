# Paths and logging

`src/main/paths.ts` resolves the external binaries `omp` and `gh`, the `omp`
agent-state directories, and the augmented `PATH` that spawned subprocesses
inherit. `src/main/logger.ts` is the tiny leveled, scoped, structured logger
every main module imports. Both are plain Node with no Electron dependency, so
they load under `bun test` and from the type-stripped RPC modules. The binary
resolution feeds the RPC bridge and the data services; the logger feeds
renderer-crash recovery and the smoke-boot signal. The environment variables
that drive both are documented in [`../overview/getting-started.md`](../overview/getting-started.md).

## Directory layout

```text
src/main/
  paths.ts     ompBinary / ghBinary / agentDir / sessionsDir / mcpConfigPath / augmentedEnv
  logger.ts    scoped / log — leveled, scoped, structured main-process logger
```

## Key abstractions

| Abstraction | File | Role |
| --- | --- | --- |
| `ompBinary` | `src/main/paths.ts` | Resolves the `omp` binary. Honors `OMP_BINARY` (always wins, even if the path does not exist, so the e2e smoke stays hermetic), probes common install locations (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.bun/bin`, `~/.local/bin`), and falls back to bare `omp` (PATH lookup). Result cached per process. |
| `ghBinary` | `src/main/paths.ts` | Same probing strategy for the `gh` CLI, with a matching `GH_BINARY` override. Probes Homebrew locations, falls back to `gh`. Cached. |
| `agentDir` | `src/main/paths.ts` | The `omp` agent-state root. Honors `PI_CODING_AGENT_DIR`, defaults to `~/.omp/agent`. |
| `sessionsDir` | `src/main/paths.ts` | `join(agentDir(), "sessions")`. The JSONL transcript root the session store reads. |
| `mcpConfigPath` | `src/main/paths.ts` | `join(agentDir(), "mcp.json")`. The user-scope MCP config the config service reads. |
| `augmentedEnv` | `src/main/paths.ts` | Builds a `PATH` that includes the common toolchain locations (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.bun/bin`, `~/.local/bin`) on top of the current env, so spawned `omp`/`gh` subprocesses and pty shells find their own dependencies even when launched from a packaged app with a stripped environment. Returns a fresh `NodeJS.ProcessEnv`. |
| `scoped` | `src/main/logger.ts` | `scoped(tag)` builds a logger whose every line is prefixed `[tag]`. `scoped('main')` is the bootstrap logger; `scoped('browser')` is the view manager. |
| `log` | `src/main/logger.ts` | The root (scopeless) logger. |
| `threshold` | `src/main/logger.ts` | Reads `OMP_STUDIO_LOG_LEVEL` (`debug`/`info`/`warn`/`error`, default `info`) on every call so it can be flipped at runtime. |
| `emit` / `render` | `src/main/logger.ts` | `emit` formats one line (`<ISO ts> <LEVEL> [scope] <message> key=value ...`) and writes it; `debug`/`info` go to stdout, `warn`/`error` to stderr. `render` serializes a field value without ever throwing (errors collapse to their message, circular values fall back to `String()`). |

## How it works

### Binary resolution

Packaged GUI apps on macOS inherit a minimal `PATH` that usually excludes
Homebrew and `~/.bun`, so a bare `omp` or `gh` lookup would fail. `ompBinary`
and `ghBinary` probe the common install locations first and fall back to the
bare name only when none exist. An explicit `OMP_BINARY` / `GH_BINARY` override
always wins, even when the path does not exist: callers (`runCli`) degrade
gracefully on a failed spawn, and pointing `OMP_BINARY` at a nonexistent path is
how the e2e smoke boots without spawning an `omp` child. Each result is cached
in a module-level variable after the first call.

### omp state directories

`agentDir` honors `PI_CODING_AGENT_DIR` and defaults to `~/.omp/agent`.
`sessionsDir` and `mcpConfigPath` derive from it. These three functions are the
single source of truth for where `omp`'s on-disk state lives, so the session
store, the config service, and the RPC bridge all agree. Changing the override
moves every reader at once.

### Augmented PATH

`augmentedEnv` returns a copy of `process.env` with a `PATH` that prepends the
common toolchain locations onto the current one (deduped). The `SessionRegistry`
passes it to the `omp` RPC child, and the `TerminalRegistry` passes it to every
spawned pty shell, so a subprocess launched from a packaged app can still find
`git`, `gh`, `node`, and the rest of the user's toolchain.

### Logger

The logger is zero-dependency and plain-Node safe. Each line is
`<ISO timestamp> <LEVEL> [scope] <message> key=value ...`. The active threshold
is read from `OMP_STUDIO_LOG_LEVEL` on every call, so it can be flipped at
runtime without a restart. Logging never throws: `emit` wraps its format and
write in a try/catch so a logger fault cannot take down the process it observes.
It never serializes secrets the caller did not hand it; field values are
rendered as given.

Two main-process behaviors depend on the logger. In `src/main/index.ts`, the
`render-process-gone` handler logs `renderer process gone` with the crash reason
before deciding whether to reload, and logs `renderer loaded` followed by
`smoke ok` on `did-finish-load` when `OMP_STUDIO_SMOKE=1`. The smoke-ok line is
the signal the e2e smoke suite waits for. The `BrowserViewManager` logs
`blocked navigation` and `loadURL failed` warnings through `scoped('browser')`.

## Integration points

- **RPC bridge**: `ompBinary()` resolves the `omp` child the bridge spawns; see
  [`./rpc-bridge.md`](./rpc-bridge.md).
- **Data services**: `ompBinary()` / `ghBinary()` feed `runCli` for
  `omp models`, `omp agents unpack`, `omp stats`, and the `gh` queries; see
  [`./data-services.md`](./data-services.md).
- **Session store**: `sessionsDir()` is the JSONL transcript root; see
  [`./session-store.md`](./session-store.md).
- **Terminal subsystem**: `augmentedEnv()` builds the spawned shell's PATH; see
  [`./terminal.md`](./terminal.md).
- **Bootstrap**: `scoped('main')` in `src/main/index.ts` drives the
  renderer-crash recovery logs and the smoke-ok signal; see
  [`./ipc-layer.md`](./ipc-layer.md).
- **Environment variables**: `OMP_BINARY`, `GH_BINARY`, `PI_CODING_AGENT_DIR`,
  `OMP_STUDIO_LOG_LEVEL`, and `OMP_STUDIO_SMOKE` are documented in
  [`../overview/getting-started.md`](../overview/getting-started.md).

## Entry points for modification

- **Add a binary probe location**: add the path to the `candidates` array in
  `ompBinary` or `ghBinary` in `src/main/paths.ts`.
- **Add an `augmentedEnv` location**: add the path to the `extra` array.
- **Change the agent-state layout**: `agentDir` and its derivations
  (`sessionsDir`, `mcpConfigPath`) in `src/main/paths.ts`.
- **Change log format or levels**: `format`, `render`, and `WEIGHT` in
  `src/main/logger.ts`.
- **Change the log threshold source**: `threshold` in `src/main/logger.ts`.

## Key source files

| File | Purpose |
| --- | --- |
| `src/main/paths.ts` | Binary probing, omp state directories, augmented PATH. |
| `src/main/logger.ts` | The scoped, leveled, structured main-process logger. |
| `src/main/index.ts` | Consumes `scoped('main')` for crash recovery and the smoke-ok signal. |

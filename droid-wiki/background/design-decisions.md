# Design decisions

The architectural choices that shaped OMP Studio, with the rationale where it is
explicit and a hedge where it is not. The history behind several of these is in
[Lore](../lore.md); the boundary implications are in [Security](../security.md).

## Drive the real `omp` over RPC

The app does not reimplement any agent logic. Each chat session is a dedicated
`omp --mode rpc --cwd <dir>` child process, driven over newline-delimited JSON
on its stdio. The bridge writes commands to stdin and reads response and event
frames from stdout, forwarding every frame to the renderer verbatim. This keeps
OMP Studio a thin cockpit: behavior, model handling, tool execution, and
subagent telemetry all come from `omp` itself, so the desktop app tracks the
harness rather than forking its semantics. The trade is a hard dependency on the
`omp` binary and its RPC protocol, which the frozen `src/shared/rpc.ts` types
against. See [RPC bridge](../systems/rpc-bridge.md).

## The three-process split with a frozen shared contract

The standard Electron main / preload / renderer split, with `src/shared` treated
as a frozen contract imported by all three. `src/shared/ipc.ts` carries the
channel map `CH` and the `OmpApi` interface; `src/shared/rpc.ts` carries the omp
protocol types; `src/shared/domain.ts` carries the read-only domain types.
Because the preload, main handlers, and renderer all import the same
definitions, the IPC surface stays in lockstep and is checked by
`npm run typecheck` as two separate projects (`tsconfig.node.json`,
`tsconfig.web.json`). The rule is that process-specific types never go in
`shared`. See [Architecture](../overview/architecture.md).

## safeStorage over keytar for the Linear key

The Linear personal API key is stored as OS-keychain ciphertext via Electron's
built-in `safeStorage` (macOS Keychain, Windows DPAPI, libsecret on Linux), with
no separate `keytar` native dependency. This avoids a second native addon to
build and ship, and `safeStorage` is already in the Electron runtime. When OS
encryption is unavailable, the store falls back to an in-memory map for the
session rather than ever writing plaintext to disk. See
[Secret store](../systems/secret-store.md).

## The additive v1 -> v2 settings migration

The settings schema is versioned, and v2 is an additive bump over v1: every new
field is optional (`workspaces`, `layout`, `ui`, `linear`, `terminal`,
`browser`). `migrate()` upgrades a v1 file by coercing the v1 fields and leaving
the v2 blocks `undefined` until the user opts in, so a persisted v1 file and any
partial update patch stay valid. Secure defaults are materialized only on a
fresh install: `terminal.enabled`, `browser.enabled`, and
`linear.writesEnabled` are all `false`. `mergeKnown` is the single funnel for
read and update, copying only known keys and dropping anything unknown,
invalid, or token-shaped, so the Linear key can never land in settings JSON.
See [Settings service](../systems/settings-service.md).

## The pane model holds only ids (AGE-801)

The center surface is a pane host with up to 8 panes in a split tree. The pane
model in `src/renderer/src/store/panes.ts` holds only ids (chat session id, file
path, subagent id), not transcript data. Each transcript pane subscribes to its
own session slice. This is the hot/cold split: the pane tree is cold (cheap to
persist and rehydrate), the per-session transcript state is hot (subscribed
lazily by the visible panes). It keeps the persisted layout small and avoids
holding every live session's full state in memory when only one pane is visible.
See [Shell layout](../features/shell-layout.md).

## The pure session-reducer as the single source of truth

Streaming chat state is reduced by `src/renderer/src/store/session-reducer.ts`,
a pure function with no React or Zustand imports. Every `evt:rpc` frame is
reduced into per-session render state through it. The payoff is testability: the
reducer is unit-tested under `bun test` with plain frame fixtures and no DOM,
which matters because the frame stream is the most state-shape-sensitive code in
the app. The chat store holds every live session in a normalized map and routes
frames to per-session slices through this reducer.

## The embedded browser as a separate sandbox

Remote web content loads in a separate, locked-down `WebContentsView` per tab,
not inside the privileged renderer. The view has `sandbox: true`,
`contextIsolation: true`, `nodeIntegration: false`, no preload, and an ephemeral
in-memory session by default. The choice is isolation over relaxation: instead
of loosening the main renderer's CSP to allow remote content, the app spawns a
distinct, deliberately-permissive web context with no IPC bridge back to `omp`
or Node. The main renderer's CSP stays `default-src 'self'`. See
[Browser subsystem](../systems/browser.md) and [Security](../security.md).

## Graceful degradation over throws across IPC

Data services never throw across the IPC boundary. Missing tools,
unauthenticated CLIs, and missing files degrade to `null` or `[]` rather than
rejecting. The terminal and browser registries are the exception: their
`create`/`write` throw clean errors with a message because the caller needs to
know why no terminal or view appeared. The rule of thumb is that read-only
browsers degrade silently and capability surfaces fail loudly with a reason. See
[Architecture](../overview/architecture.md).

## The recentProjects -> workspaces cutover

The v1 `recentProjects` log was replaced by first-class `settings.workspaces`
(`{id, cwd, label, pinned, lastUsedAt, color?}`). The `id` is a stable uuid
that survives label and preference edits, so pinning, recency, and color do not
break when a workspace is renamed or re-pointed. Selecting a workspace
re-targets new chats at its `cwd`; live sessions keep their own `cwd`, and
switching spawns nothing. The cutover also fixed a v1 bug where project-scoped
discovery used `process.cwd()` (the launch dir in a packaged app, often `/`),
now threaded from the active workspace cwd. See
[Settings service](../systems/settings-service.md) and
[Pitfalls and danger zones](pitfalls.md).

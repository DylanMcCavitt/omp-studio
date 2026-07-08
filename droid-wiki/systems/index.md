# Systems

The systems section covers the main-process internal building blocks of OMP
Studio. The main process is the only process that touches the filesystem,
spawns children (`omp`, `gh`, pty shells), makes HTTP (Linear), and hosts the
embedded `WebContentsView`. Every subsystem here lives in `src/main` and is
reached from the renderer only through the typed IPC channels in
`src/shared/ipc.ts`. The architecture overview that situates these in the
process model is at [`../overview/architecture.md`](../overview/architecture.md).

## Subsystems

### Read-only data services

The services that map host sources (`~/.omp/agent` JSONL, `mcp.json`, skill
dirs, `omp models` / `omp agents unpack`, `gh`, `omp stats`) into the
`src/shared/domain.ts` types the renderer browses. Each degrades gracefully to
`null` or `[]` when a source is missing.

- [Data services](data-services.md) — the read-only services and the dashboard
  aggregate, wired through `registerDataIpc`.

### Stateful subsystems

The registries and services that own long-lived process state (children, views,
secrets, settings) and push events back to the renderer.

- [RPC bridge](rpc-bridge.md) — `SessionRegistry` and the `OmpRpcSession` wrapper
  that drives the `omp` child over JSONL stdio.
- [Session store](session-store.md) — reads `omp`'s on-disk session transcripts,
  runs search, and performs the mutating session actions.
- [Settings service](settings-service.md) — the versioned settings store
  persisted under `userData`.
- [Secret store](secret-store.md) — the Linear API key in the OS keychain via
  Electron `safeStorage`.
- [Terminal subsystem](terminal.md) — the pty layer and external terminal
  launchers.
- [Browser subsystem](browser.md) — the isolated embedded `WebContentsView` per
  tab and its navigation policing.

### Infrastructure

The cross-cutting pieces the rest of main builds on.

- [IPC layer](ipc-layer.md) — the `src/main/ipc/` handlers that bind the `CH`
  channels to the registries and services.
- [Paths and logging](paths-and-logging.md) — binary probing, `omp` state
  directories, the augmented subprocess `PATH`, and the scoped logger.
- [Files and changes](files-and-changes.md) — the workspace-scoped file tree,
  atomic edits, and read-only git diff, both path-contained under a
  settings-validated workspace root.

## Shared conventions

Every subsystem in this section follows the same conventions, so a change to
one is usually a change to a pattern, not an isolated edit.

- **Graceful degradation.** The read-only services and the return-safe IPC
  handlers never throw across the IPC boundary. A missing tool, an
  unauthenticated CLI, a missing file, or a non-git workspace degrades to
  `null` or `[]`. The stateful subsystems (chat, terminal) throw clean `Error`s
  on bad input because the caller needs to know why nothing happened.
- **Child-process hygiene.** `SessionRegistry`, `TerminalRegistry`, and
  `BrowserViewManager` each provide a synchronous `disposeAll` / `destroyAll`
  that `src/main/index.ts` wires into `window-all-closed` and `before-quit`, so
  no `omp` child, pty shell, or embedded renderer outlives the app.
- **Typed IPC.** Every channel name lives in `CH` and every payload shape in
  `OmpApi` in `src/shared/ipc.ts`. The handlers implement the `OmpApi` surface;
  the preload forwards through `ipcRenderer.invoke` and a single-fan-out
  `ipcRenderer.on`. See [`../primitives/ipc-contract.md`](../primitives/ipc-contract.md).
- **Plain-Node testability.** The services and the pty/browser/terminal modules
  are plain Node with Electron reached only through structural type seams and
  lazy `require`, so they load under `bun test` with injected fakes and no
  Electron runtime.
- **Security boundaries.** Context isolation on, renderer CSP
  `default-src 'self'`, no remote content in the privileged renderer. The
  embedded browser is a separate sandboxed `WebContentsView`. The terminal is a
  real pty shell, off by default, with agent frames never written to pty input.
  Renderer-influenced paths are contained under a main-validated root. See
  [`../security.md`](../security.md).

## Related pages

- [Primitives](../primitives/index.md) — the frozen `src/shared` type contract.
- [IPC contract](../primitives/ipc-contract.md) — the `CH` channel map and
  `OmpApi` surface.
- [Architecture](../overview/architecture.md) — the process model that situates
  these subsystems.
- [Security](../security.md) — the terminal, browser, and files boundaries.

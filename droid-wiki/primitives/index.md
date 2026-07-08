# Primitives

`src/shared` is the frozen cross-process type contract for OMP Studio. The
preload, the main-process IPC handlers, and the renderer all import the same
definitions, so the IPC surface stays in lockstep across all three processes and
`npm run typecheck` catches drift between them.

## Why it exists

OMP Studio is a standard Electron three-process app (renderer, preload, main)
that drives external `omp` and `gh` processes. Every boundary between those
processes is a typed channel: the renderer calls `window.omp` methods, the
preload forwards them to `ipcMain.handle` handlers, and main reads host state
and spawns children. If each process defined its own copy of the channel names
or the payload shapes, a rename on one side would silently desync from the
other two until runtime. `src/shared` exists so there is one source of truth.

The contract is treated as frozen. `npm run typecheck` runs two separate
projects, `tsconfig.node.json` (main + preload) and `tsconfig.web.json`
(renderer), and both compile against the same `src/shared` modules. A change to
a channel string, a payload field, or a domain type propagates to every process
at compile time.

## The three files

| File | Covers |
| --- | --- |
| `src/shared/rpc.ts` | The `omp` `--mode rpc` protocol surface: `ThinkingLevel`, the message and content-block model, `ApprovalMode` / `ApprovalPolicy`, extension UI requests, `RpcModel` / `AvailableModel`, todo types, `RpcState`, `SessionStats`, `RpcFrame` and its refinements, subagent telemetry types, and the commands-palette types. See [RPC protocol types](rpc-protocol.md). |
| `src/shared/domain.ts` | App-level read-only domain types: sessions, MCP servers, skills, agents, providers and models, GitHub, `omp stats`, the dashboard aggregate, Linear, terminal, browser, and the files and changes types. See [Domain types](domain-types.md). |
| `src/shared/ipc.ts` | The IPC channel map `CH`, the `OmpApi` interface the preload implements and the renderer consumes, the chat payload types, and the persisted settings schema (V1, the additive V2, workspaces, layout, terminal, browser). See [IPC contract](ipc-contract.md). |

## Path aliases

Both aliases are wired in `tsconfig.json` and resolve at build time through
electron-vite.

- `@shared/*` -> `src/shared/*` in every process (main, preload, renderer).
- `@/*` -> `src/renderer/src/*` in the renderer only.

Imports look like `import type { RpcFrame } from "@shared/rpc"` and
`import { CH } from "@shared/ipc"`.

## What belongs here

Only types that two or more processes must agree on. The rule is simple: never
put process-specific types in `src/shared`. A type that only main uses (a
`SessionRegistry` record, a `PtySession` handle) lives in `src/main`; a type
that only the renderer uses (a Zustand store slice, a component prop) lives in
`src/renderer`. `src/shared` holds the wire shapes: the RPC frames `omp`
emits, the domain objects main returns to the renderer, and the channel names
plus payload types that cross the IPC boundary.

The types in `src/shared/rpc.ts` and `src/shared/domain.ts` are loose where the
wire format is loose. Several interfaces carry an open index signature
(`[key: string]: unknown`) so an `omp` build that adds a field the renderer
does not model yet does not break the typecheck. The bridge forwards frames
verbatim and the reducer shapes only what it knows.

## Related pages

- [RPC protocol types](rpc-protocol.md): the `omp` RPC type reference.
- [Domain types](domain-types.md): the read-only domain type reference.
- [IPC contract](ipc-contract.md): the channel map and `OmpApi` surface.
- [`../systems/rpc-bridge.md`](../systems/rpc-bridge.md): the bridge that
  produces the RPC frames typed by `src/shared/rpc.ts`.
- [`../systems/ipc-layer.md`](../systems/ipc-layer.md): the `ipcMain` handlers
  that implement the channels in `CH`.
- [`../systems/data-services.md`](../systems/data-services.md): the services
  that produce the domain objects typed by `src/shared/domain.ts`.
- [`../systems/settings-service.md`](../systems/settings-service.md): settings
  persistence for the schema in `src/shared/ipc.ts`.
- [`../overview/architecture.md`](../overview/architecture.md): the
  architecture overview that summarizes the shared contract.

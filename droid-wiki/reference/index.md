# Reference

The reference section is the lookup layer for OMP Studio: the configuration
the app reads, the data models that flow between processes, and the
dependencies the project is built from. Each page is a table-driven reference
that points to the deeper material elsewhere in the wiki instead of repeating
it.

## Pages

- [`configuration.md`](configuration.md): the settings schema (`StudioSettings`
  V2, field by field), the environment variables the app reads, and the theme
  token set.
- [`data-models.md`](data-models.md): the core data models that cross the
  process boundary, from the omp message model to the dashboard aggregate.
- [`dependencies.md`](dependencies.md): the key npm dependencies and what each
  one does in this repo.

## Where the exhaustive type lists live

The full type definitions and the IPC channel map live in the primitives
section. The reference pages summarize and cross-link them rather than
duplicating the field-by-field lists.

- [`../primitives/ipc-contract.md`](../primitives/ipc-contract.md): the `CH`
  channel map, the `OmpApi` surface, and the full settings schema with the
  V1-to-V2 migration notes.
- [`../primitives/rpc-protocol.md`](../primitives/rpc-protocol.md): the
  `src/shared/rpc.ts` types (the omp RPC protocol surface).
- [`../primitives/domain-types.md`](../primitives/domain-types.md): the
  `src/shared/domain.ts` types (the read-only domain shapes).

The systems section documents the producers: settings persistence in
[`../systems/settings-service.md`](../systems/settings-service.md), the session
transcript producer in
[`../systems/session-store.md`](../systems/session-store.md), and the RPC state
producer in [`../systems/rpc-bridge.md`](../systems/rpc-bridge.md).

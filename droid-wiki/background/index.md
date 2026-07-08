# Background

The background section holds the "why" and the "watch out" material that does
not fit a per-subsystem page: the architectural decisions that shaped OMP
Studio, and the pitfalls and danger zones that have bitten (or could bite) the
codebase.

- [Design decisions](design-decisions.md) — the key architectural choices and
  their rationale, from driving the real `omp` over RPC to the additive
  v1 -> v2 settings migration.
- [Pitfalls and danger zones](pitfalls.md) — the bugs and sharp edges that have
  already caused crashes or would, left unguarded: the bare-string
  `message.content` crash, resize spillover, the `process.cwd()` bug in a
  packaged app, the sandboxed-preload-must-be-CJS rule, and the `node-pty` exec
  bit.

For the project's history and release timeline, see [Lore](../lore.md). For the
boundary map, see [Security](../security.md).

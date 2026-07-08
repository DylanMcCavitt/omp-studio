# Cleanup opportunities

A single page, not a directory: OMP Studio is pre-1.0 and under heavy iteration,
and the only cleanup signal worth tracking right now is source complexity. There
are no accumulated `TODO` / `FIXME` / `HACK` comments and no stale dependencies,
so this page is the complexity-hotspots table plus the honest "nothing else"
notes.

## Complexity hotspots

The largest source files by line count, with a gentle refactoring note for each.
Line counts are from `wc -l` on the current tree.

| File | Lines | Note |
| --- | --- | --- |
| `src/renderer/src/views/Settings.tsx` | 1249 | The whole settings surface in one view. The workspaces, integrations (Linear), capabilities (terminal/browser), and appearance/layout blocks are candidates to split into one panel module per section, the way `WorkspacesPanel` already factored out. |
| `src/renderer/src/store/chat.ts` | 1129 | The normalized live-session map plus the global frame bridge. The per-session slice logic and the bridge subscription are the natural seams. |
| `src/renderer/src/views/Dashboard.tsx` | 1030 | The aggregate dashboard. The per-card sections (sessions, models/providers, MCP, skills, agents, GitHub) could become one component each. |
| `src/main/services/settings-service.ts` | 802 | Defaults, coercion, migration, load/save, and the write mutex in one module. The per-namespace coercers (`coerceLayout`, `coerceUiPrefs`, `coerceWorkspaces`, `coerceLinearMeta`) are already separate functions and could move to a `coercers/` subdir if the file grows further. |
| `src/main/services/session-store.ts` | 719 | On-disk session JSONL reading and search. The summary scan, transcript reader, and search index are the seams. |
| `src/renderer/src/components/chat/SessionList.tsx` | 691 | The sessions browser list. Row rendering, grouping, and the action menu are the natural split. |
| `src/renderer/src/store/session-reducer.ts` | 681 | The pure frame reducer. It is deliberately one module so the frame-to-state mapping is in one place; splitting it would trade cohesion for size, so this is a low-priority candidate. |
| `src/renderer/src/store/panes.ts` | 643 | The pane split-tree model. The tree operations and the id-based selectors are the seams. |
| `src/main/omp/rpc-session.ts` | 639 | The RPC session wrapper. Command sending, frame parsing, and lifecycle are the seams, though like the reducer it benefits from being one module. |

Two test files sit in the same size band
(`src/renderer/src/views/Browser.test.tsx` at 795 and
`src/renderer/src/components/shell/CenterTabs.test.tsx` at 655) and are out of
scope for a refactoring pass.

## No TODO / FIXME / HACK comments

A grep over `src/` for `TODO`, `FIXME`, `HACK`, and `XXX` finds only UI strings:
a compact-dialog placeholder that mentions "open TODOs" and the `EMPTY_TODOS`
constant in `src/renderer/src/components/chat/TodoPanel.tsx`. There are no real
TODO markers in the source, so there is no debt log to triage here.

## No stale dependencies

The `devDependencies` and `dependencies` in `package.json` are recent majors:
Electron 33, electron-vite 2, electron-builder 25, Biome 2, TypeScript 5.7,
Vitest 2, Vite 5, React 18, Zustand 5, Tailwind v3, Playwright 1.61. Nothing in
the manifest is a long-unmaintained or known-vulnerable pin that would warrant
an upgrade pass. The runtime dependency surface is intentionally tiny
(`node-pty`, `@xterm/*`, `@electron-toolkit/utils`).

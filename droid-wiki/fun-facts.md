# Fun facts

A few things about OMP Studio that are genuinely interesting and specific to
this repo, not generic Electron trivia.

## The name is a backronym

"OMP Studio" stands for "Oh My Pi Studio." The app is a desktop cockpit for the
**Oh My Pi (`omp`)** coding-agent harness (upstream at `can1357/oh-my-pi`), and
the second commit on 2026-06-19 (`docs: point Oh My Pi links to upstream repo`)
was specifically a docs fix to make sure that lineage was visible. The local
checkout directory is `port-omp`, but the git remote and `package.json` name are
both `omp-studio` (`origin` points to `git@github.com:DylanMcCavitt/omp-studio.git`),
so the directory name and the project name disagree on purpose: the directory
describes the work (porting/wrapping `omp`), the package describes the product.

## The oldest surviving code has barely moved

Every core file checked dates to the first commit on 2026-06-19. Their age, from
`git log --reverse --format='%cd' --date=short -- <file> | head -1`:

| File | First commit |
|---|---|
| `src/main/index.ts` | 2026-06-19 |
| `src/main/omp/rpc-session.ts` | 2026-06-19 |
| `src/main/omp/registry.ts` | 2026-06-19 |
| `src/preload/index.ts` | 2026-06-19 |
| `src/shared/ipc.ts` | 2026-06-19 |
| `src/renderer/src/App.tsx` | 2026-06-19 |
| `src/renderer/src/views/Dashboard.tsx` | 2026-06-19 |
| `src/renderer/src/store/chat.ts` | 2026-06-19 |

Two of those oldest files are also among the most-changed in the last 90 days:
`src/shared/ipc.ts` (20 touches) and `src/renderer/src/store/chat.ts` (18
touches). So the IPC contract and the chat store were both present on day one
and have been edited in roughly one of every seven commits since. The
architecture they set up on 2026-06-19, a main process that owns the `omp` child
and a renderer that only speaks through the frozen `window.omp` bridge, has
held through the entire v2 expansion.

## The longest file is a settings form

`src/renderer/src/views/Settings.tsx` is 1249 lines (confirmed with `wc -l`),
the largest source file in the repo. It is a single React view that renders
every settings panel: appearance, workspaces, integrations (Linear), terminal,
browser, and layout reset. The size is a gentle refactoring hint, since the
nearby `src/main/services/settings-service.ts` (802 lines) already owns the
schema and migration logic on the main side, so the renderer file is mostly
form layout that could split into one panel per section. It has been touched 18
times in the last 90 days, almost always to add a new settings panel for a v2
feature.

## node-pty loads lazily so a missing native addon never breaks startup

`node-pty` is a native addon, which means it has to be compiled for the host
platform and can fail to install or load. OMP Studio handles this defensively:
`src/main/terminal/registry.ts` never imports `node-pty` statically. It declares
only the structural type it needs (`import type { IPty } from "node-pty"`) and
loads the real module lazily on first spawn via a `requireNative("node-pty")`
factory call, inside the terminal capability check that is off by default. The
file's own comments spell out the intent: "node-pty is never statically imported
here" and "an unbuilt node-pty never breaks startup." A `postinstall` hook
(`scripts/ensure-node-pty-exec.mjs`) tries to ensure the addon is built, but the
lazy load is the real safety net. This is unusual for an Electron app, where
native addons are typically imported at the top of the main entry and can take
the whole app down if they fail.

The matching renderer side uses `@xterm/xterm` (pinned at `^6.0.0` with
`@xterm/addon-fit`) as a runtime dependency for the opt-in terminal panel, so
the terminal stack is `xterm.js` in the renderer talking to a `node-pty` shell
in main, with both gated behind `settings.terminal.enabled` (off by default).

## There are essentially no TODO comments in the source

A grep for `TODO`, `FIXME`, `HACK`, and `XXX` across `src/` returns 61 matches,
but every single one is a false positive:

- `src/renderer/src/components/chat/CompactDialog.tsx` has a placeholder string
  reading "e.g. Keep the API design decisions and open TODOs..." (a user-facing
  hint about what to put in a compact prompt).
- `src/renderer/src/components/chat/TodoPanel.tsx` and its tests reference
  `TodoPanel`, `TodoPhase`, and `TodoStatus`, which render omp's live todo
  phases (a real feature, not a code comment).
- `src/renderer/src/views/Linear.test.tsx` and
  `src/renderer/src/components/linear/LinearConnectCard.test.tsx` use `"Todo"`
  as a Linear issue workflow status name in test fixtures.

Zero matches are actual `// TODO` or `// FIXME` code comments. That is unusual
for a pre-1.0 codebase under heavy iteration, and it lines up with the dense
Linear tracking: work that might otherwise hang as a TODO comment is instead
filed as an `AGE-###` issue (125 distinct identifiers across commit subjects).

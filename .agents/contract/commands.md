# Commands — OMP Studio

From `package.json` scripts. Do not invent gates in issue work. Default branch: `main`.

## App

| Purpose | Command |
| --- | --- |
| Install dependencies | `npm install` (runs `postinstall` → `scripts/ensure-node-pty-exec.mjs`) |
| Run desktop app (dev) | `npm run dev` |
| Preview built app | `npm run start` |
| Build | `npm run build` |

## Issue worktree bootstrap

For each fresh issue worktree under `/private/tmp/omp-wt/<lowercase-issue-id>`, run `npm install` in that worktree before any gate.

This is the explicit networked dependency-install step (cold caches may fetch packages). It creates an untracked `node_modules/` and runs `postinstall` → `scripts/ensure-node-pty-exec.mjs`. Do not commit `node_modules/` or machine-local paths.

## Gates

| Purpose | Command |
| --- | --- |
| Typecheck (node + web) | `npm run typecheck` |
| Lint | `npm run lint` |
| Lint + format check | `npm run check` |
| Format write | `npm run format` |
| Renderer/unit tests | `npm run test:ui` (vitest) |
| Node-side tests | `bun test` (whole `test/` dir) |
| Drift radar (session start / pre-dispatch) | `npm run sync-check` |
| RPC bridge test | `npm run test:rpc` |
| Hermetic Electron e2e smoke | `npm run build && npm run test:e2e` (Playwright `_electron`) |
| Live paid e2e | `npm run build && STUDIO_E2E_LIVE=1 npm run test:e2e` (HITL only) |
| Demo recording (proof mp4 + keyframes) | `npm run build && npm run demo -- <scenario>` (hermetic; `DEMO_OUT` sets output dir; wrap with `xvfb-run -a` headless) |

## Packaging & release

| Purpose | Command |
| --- | --- |
| Package (current OS) | `npm run dist` |
| Package unpacked dir | `npm run dist:dir` |
| Package macOS | `npm run dist:mac` |
| Cut a release | `npm run release` |
| Generate release notes | `npm run release:notes` |

## Conventions

- Run only the gates touching your change unless asked otherwise; before a PR, run the full set above on the changed worktree.
- e2e is hermetic by default (fake omp/gh binaries; terminal/browser off unless the test enables their gates). Keep live/paid scenarios behind `STUDIO_E2E_LIVE`.
- macOS signing/notarization is deferred (`AGE-589`); packaging produces unsigned artifacts.

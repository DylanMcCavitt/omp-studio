# Getting started

## Prerequisites

- **Node.js >= 20** (the repo also tests against 22 in CI).
- **`omp`** installed and authenticated, the harness OMP Studio drives. Verify
  with `omp --version`.
- **`gh`** (GitHub CLI) installed and authenticated for the GitHub features.
  Verify with `gh auth status`.
- **Bun** (runs the node-side test suite). CI installs the latest.
- **macOS, Linux, or Windows.** Electron needs a display server even for a smoke
  launch, so on headless Linux wrap commands with `xvfb-run -a`.

OMP Studio probes the common install locations for `omp` and `gh` (Homebrew,
`~/.bun/bin`, `~/.local/bin`) so it works even when launched as a packaged app
with a minimal `PATH`. Set the `OMP_BINARY` environment variable to override the
`omp` binary location, and `PI_CODING_AGENT_DIR` to override the `omp`
agent-state directory (default `~/.omp/agent`).

## Install

```sh
npm install
```

The `postinstall` hook runs `scripts/ensure-node-pty-exec.mjs`, which restores
the executable bit on the `node-pty` native addon (npm drops it on some
platforms). This creates an untracked `node_modules/` and does not commit
machine-local paths.

## Run

```sh
npm run dev
```

`npm run dev` launches the app in development mode with hot-reloading renderer
and main processes via electron-vite. To preview the built app instead, run
`npm run build` then `npm run start`.

## Build

```sh
# Type-check both the node and web TypeScript projects
npm run typecheck

# Bundle main, preload, and renderer into out/
npm run build

# Build distributable installers into release/ (dmg / AppImage / nsis)
npm run dist
```

`npm run dist:mac` targets macOS only. Distributable packaging uses
electron-builder and downloads platform Electron binaries, so it runs locally or
in the release workflow rather than in CI. macOS code-signing and notarization
are deferred (the macOS build is currently unsigned).

The build is configured in `electron.vite.config.ts`. The preload is forced to
CommonJS output (`.cjs`) because sandboxed preload scripts cannot load ESM. Path
aliases: `@shared/*` resolves to `src/shared/*` in every process, and `@/*`
resolves to `src/renderer/src/*` in the renderer only.

## Test

```sh
# Node-side unit suite (bun) — includes the pure session reducer
bun test

# Renderer component suite (Vitest + jsdom + Testing Library)
npm run test:ui

# RPC bridge integration test (handshake only; live model turn needs RPC_LIVE=1)
npm run test:rpc

# Electron end-to-end smoke against the built app (launch / render / navigation)
npm run build && npm run test:e2e
```

`npm run test:e2e` uses Playwright's `_electron` API to launch the bundled app
from `out/main/index.js`, so the app must be built first. The smoke suite
(`e2e/smoke.spec.ts`) is non-live and hermetic: it never starts a chat, points
`omp`/`gh` at a nonexistent binary and the agent-state dir at an empty temp dir,
so the data services hit their graceful-degrade path and no child process
spawns. On headless Linux CI, wrap it with `xvfb-run -a`.

Live, paid end-to-end scenarios (a real chat turn, tool approval round-trips,
restart/resume, two-session concurrency) live in `e2e/live.spec.ts` and are
gated behind `STUDIO_E2E_LIVE=1` (mirroring `RPC_LIVE=1`). They are skipped by
default so `npm run test:e2e` and CI never spawn a paid turn. Run them locally
with a configured `omp`:

```sh
npm run build && STUDIO_E2E_LIVE=1 npm run test:e2e
```

See [Testing](../how-to-contribute/testing.md) for the frameworks, patterns, and
how to run, mock, and cover each suite.

## Lint and format

```sh
npm run check    # Biome lint + format check
npm run lint     # Biome lint
npm run format   # Biome format --write
```

Biome config is in `biome.json`: 2-space indent, double quotes, semicolons,
trailing commas, the `recommended` preset with a handful of rules turned off
(notably `useExhaustiveDependencies`, `noNonNullAssertion`,
`useButtonType`). See [Tooling](../how-to-contribute/tooling.md).

## Releases

Releases are cut from `main` and published by CI:

```sh
# 1. Bump the version + stamp the CHANGELOG, then commit and tag vX.Y.Z.
npm run release -- 0.1.0          # explicit version
npm run release -- patch          # or bump patch/minor/major
npm run release -- patch --dry-run  # preview only

# 2. Push the branch and the tag. Pushing the tag triggers the Release workflow.
git push && git push origin v0.1.0
```

On a `v*` tag, `.github/workflows/release.yml` verifies the `package.json`
version matches the tag, builds and smoke-tests the app on macOS/Linux/Windows,
packages installers with electron-builder, and cuts a single GitHub Release whose
notes are the matching `CHANGELOG.md` section. See
[Deployment](../deployment.md).

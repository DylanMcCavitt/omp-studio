# Patterns and conventions

How OMP Studio is written. Follow these when contributing. See also
[Development workflow](development-workflow.md) and [Tooling](tooling.md).

## Process boundaries are load-bearing

The three-process split is the most important convention in the codebase. The
renderer never touches Node, Electron, the filesystem, or the network. It calls
only the typed `window.omp` (`OmpApi`) surface the preload exposes. The preload
is a thin forwarder, not a logic layer. The main process owns every capability
that reaches the host.

- New renderer-to-main calls go through a channel in `CH` (`src/shared/ipc.ts`),
  an `OmpApi` method, a preload forwarder, and an `ipcMain.handle` registration
  in `src/main/ipc/`. All four stay in lockstep because they import the same
  `src/shared` definitions, and `npm run typecheck` catches drift.
- Never put process-specific types in `src/shared` (it is the frozen
  cross-process contract). Renderer-only types live under `src/renderer`; main
  types stay in `src/main`.

## Graceful degradation, not throws across IPC

Data services never throw across the IPC boundary. A missing `omp`/`gh` binary,
an unauthenticated CLI, a missing file, or a failed HTTP call degrades to
`null`/`[]`/a safe empty result. The renderer always gets a typed value back and
renders an empty state, never a crash. See the data services in
`src/main/services/` and [Data services](../systems/data-services.md).

## Security boundaries are preserved

Three boundaries must not be relaxed without a security review (see
[Security](../security.md) and [`.agents/contract/domain.md`](.agents/contract/domain.md)):

1. **The privileged renderer stays local.** Its CSP is `default-src 'self'`. No
   remote content loads in the main window. External navigations are denied and
   routed to the OS browser via `src/main/external-open.ts`.
2. **The embedded browser is a separate sandbox.** Each tab is its own
   `WebContentsView` with `sandbox:true`, `contextIsolation:true`,
   `nodeIntegration:false`, no preload, and an ephemeral in-memory session by
   default. It has no `window.omp`, no `ipcRenderer`, no Node. The main
   renderer's CSP is never relaxed for it.
3. **The terminal is user-initiated and off by default.** Agent frames, RPC
   frames, and remote content are never written to a pty. Only the local
   terminal view writes input.

Secrets never enter settings JSON, logs, transcripts, or tracked files. The
Linear API key is OS-keychain ciphertext via `services/secret-store.ts`
(`safeStorage`). When OS encryption is unavailable, the value is kept in memory
for the session only, never as plaintext on disk.

## Child-process hygiene

Any long-lived child the main process spawns is tracked and disposed on
`window-all-closed` and `before-quit`. The three registries
(`SessionRegistry`, `TerminalRegistry`, `BrowserViewManager`) all follow this
pattern. Disposing a chat session closes the `omp` child's stdin, on which `omp`
exits 0; no orphan processes survive the app.

## Renderer state: Zustand + a pure reducer

- **Zustand stores** under `src/renderer/src/store/` hold render state. The chat
  store (`store/chat.ts`) keeps every live session in a normalized
  `openSessions` map keyed by studio session id, with ONE global bridge
  subscription routing frames to the right session.
- **All state shaping flows through the pure reducer**
  (`store/session-reducer.ts`). The store owns side effects (subscriptions, IPC
  fetches, optimistic appends) and feeds their results back as studio-internal
  control frames, so there is exactly one place that mutates a session slice.
  The reducer imports only types (erased at runtime): no React, no `window`, no
  zustand. That makes it unit-testable under `bun test`
  (`test/session-reducer.test.ts`) without the DOM.
- **Hot/cold split.** The pane model (`store/panes.ts`) holds only ids (cold,
  tiny). Each transcript pane subscribes to its own session slice via a
  `useSession(sessionId)` hook (hot). Adding a pane never widens what any other
  pane re-renders on.
- **Global app chrome is not per-pane.** The right icon rail and its panels are
  one `openPanelId` for the whole window (`store/shell.ts`), because several
  rail destinations are backed by main-process singletons. Per-pane state stays
  inside the pane subtree.

## Preload subscription fan-out

The preload binds exactly one `ipcRenderer.on` listener per event channel on the
first subscribe and removes it when the last subscriber leaves
(`channelSubscription` in `src/preload/index.ts`). Many `onEvent`/`onLifecycle`/
`onUiRequest` callbacks must not stack duplicate listeners, or every frame would
be re-delivered. Every returned unsubscribe is real.

## Settings schema is additive and versioned

`services/settings-service.ts` persists a versioned schema. v2 is an additive
bump over v1: `migrate()` upgrades a v1 file by filling defaults, and every new
field is optional so a v1 file and any partial patch stay valid. New feature
flags default to off and secure: `terminal.enabled`, `browser.enabled`, and
`linear.writesEnabled` are all `false`. `mergeKnown()` copies only known keys and
drops token-shaped data, so the Linear API key never lands in settings JSON. See
[Settings service](../systems/settings-service.md).

## Formatting and style

- Biome 2 (`biome.json`): 2-space indent, double quotes, semicolons, trailing
  commas, the `recommended` preset with a few rules off
  (`useExhaustiveDependencies`, `noNonNullAssertion`, `useButtonType`,
  `useTemplate`, `noArrayIndexKey`).
- Tailwind v3 utility classes plus a CSS-variable token set
  (`src/renderer/src/styles.css`). The identity is a neutral graphite surface
  ramp with an iris/violet accent (the v2 visual refresh, AGE-658). All body and
  muted copy stays WCAG-AA legible in both dark and light themes. The renderer is
  fully token-driven, so theme work changes token values, not per-component code.
- Sentence case in headings. Lowercase-hyphen filenames. No uppercase in
  filenames.

## Tests mirror the process split

- **Node-side** tests under `test/` run with `bun test` and cover main-process
  services, the RPC bridge, the session reducer, settings, and IPC handlers.
- **Renderer** tests under `src/renderer/**/*.test.tsx` run with Vitest (jsdom +
  Testing Library) and cover components and stores.
- **e2e** tests under `e2e/` run with Playwright's `_electron` runner against the
  built app. The smoke suite is hermetic (fake `OMP_BINARY`/`GH_BINARY`, empty
  agent-state dir, no spawn). Live, paid scenarios are gated behind
  `STUDIO_E2E_LIVE=1` and never run in CI.

Keep new tests in the right suite for the process they exercise. See
[Testing](testing.md).

# Pitfalls and danger zones

The bugs and sharp edges that have already caused crashes or would, left
unguarded. Each entry names the symptom, the root cause, and the guard now in
place. The design context for several of these is in
[Design decisions](design-decisions.md); the boundary implications are in
[Security](../security.md).

## The bare-string `message.content` crash (AGE-656)

**Symptom.** A text-only assistant turn tore down the whole transcript with
`content.map is not a function`.

**Root cause.** `omp` emits text-only turns with a bare-string `content`, which
violated the declared `ContentBlock[]` type. The reducer called `.map` on a
string and threw, taking the transcript with it.

**Guard.** The session reducer's `toContentBlocks` now normalizes assistant and
`toolResult` string content into a text block as the single source of truth,
with a render-side call to `toContentBlocks` in `MessageBubble` as a backstop.
The fix lives in `src/renderer/src/store/session-reducer.ts` and
`src/renderer/src/components/chat/MessageBubble.tsx`.

## Resize spillover (AGE-657)

**Symptom.** Narrowing a panel or the window spilled a horizontal scrollbar
onto the app instead of clipping content within the panel.

**Root cause.** Flex children without a `min-width: 0` floor refuse to shrink
below their content's intrinsic width, so a wide child pushed the whole row
out.

**Guard.** `min-w-0` and `overflow` guards were added to the shell and chat
split panels, the Sidebar toggle, the Dashboard and Skills headers, and the
Settings workspace rows. An `e2e/resize.spec.ts` regression suite narrows the
window and panels and asserts no horizontal overflow.

## The v1 `process.cwd()` bug in a packaged app

**Symptom.** Project-scoped discovery (skills, MCP, agents, the dashboard)
returned nothing useful in a packaged app.

**Root cause.** The reads used `process.cwd()`, which in a packaged Electron
app is the launch directory (often `/`), not the user's project. The v1
`recentProjects` log held project paths but discovery did not consume them.

**Guard.** `listSkills`, `listMcpServers`, `listAgents`, and the dashboard now
take an optional `cwd` threaded from the active workspace, falling back to the
most-recently-active chat session's `cwd` (`activeSessionCwd()` in
`src/main/index.ts`) when no workspace is set. The workspaces cutover made the
workspace `cwd` a first-class selection; see
[Design decisions](design-decisions.md).

## The sandboxed preload must be CJS

**Symptom.** The app fails to load its preload in a packaged build.

**Root cause.** The `BrowserWindow` is created with `sandbox: true`, and
Electron cannot load an ESM preload in a sandboxed context. The package is
`"type": "module"`, so the default build output is ESM.

**Guard.** `electron.vite.config.ts` forces the preload build to CommonJS:
`format: "cjs"`, `entryFileNames: "[name].cjs"`, and
`inlineDynamicImports: true` for a sandbox-safe single-file bundle. The preload
lands at `out/preload/index.cjs`, which is the path `src/main/index.ts` loads.
See [Tooling](../how-to-contribute/tooling.md).

## The node-pty exec bit

**Symptom.** `terminal:create` fails at spawn with `posix_spawnp failed.`,
with no module-load error.

**Root cause.** `node-pty` execs a small `spawn-helper` binary (via
`posix_spawnp`) to fork the pty on unix. Its prebuilt binaries ship with the
exec bit set, but some install or extraction paths strip it, leaving
`spawn-helper` as `-rw-r--r--`. The `.node` addon itself loads fine, so the
failure is opaque.

**Guard.** The `postinstall` hook `scripts/ensure-node-pty-exec.mjs` restores
the exec bit on every `spawn-helper` under `node_modules/node-pty` (both the
`prebuilds/<platform>/` and `build/Release/` shapes). It is idempotent and
best-effort, and never fails the install. The addon also loads lazily, so a
missing or unbuilt `node-pty` never breaks app startup, only an opted-in
`terminal:create`. See [Terminal subsystem](../systems/terminal.md).

## The preload duplicate-listener pitfall

**Symptom.** Many `onEvent` / `onLifecycle` / `onUiRequest` callbacks stack
duplicate `ipcRenderer.on` listeners, and every frame is re-delivered once per
listener.

**Root cause.** A naive subscription registers a new IPC listener per
callback. With N subscribers on the same channel, each frame fires N times.

**Guard.** The preload's `channelSubscription` binds exactly one
`ipcRenderer.on` listener per channel on the first subscribe, fans out to a
`Set` of renderer callbacks, and removes the IPC listener when the last
subscriber leaves. Every returned unsubscribe is real, and a channel never
double-registers. See `src/preload/index.ts`.

## The terminal and browser are off by default for a reason

**Symptom.** (None yet; this is the guard.)

**Root cause.** The terminal is a real shell at full user privilege and can run
anything the user can. The embedded browser loads untrusted remote content.
Both are the largest capabilities in the app.

**Guard.** `settings.terminal.enabled` and `settings.browser.enabled` default
to `false`. The terminal's pty input is never auto-fed from agent output,
`evt:rpc` frames, or remote content. The embedded browser is a separate
sandboxed `WebContentsView` with no IPC bridge, so its content cannot reach
`window.omp` or Node. The UI never calls either "safe"; enabling either is a
deliberate user choice. See [Security](../security.md),
[Terminal subsystem](../systems/terminal.md), and
[Browser subsystem](../systems/browser.md).

# Debugging

Logs, the smoke boot, crash recovery, and common errors. See
[Paths and logging](../systems/paths-and-logging.md) for the logger and binary
resolution internals, and [Getting started](../overview/getting-started.md) for
the environment variables.

## Logs

The main process uses a small scoped, leveled, structured logger at
`src/main/logger.ts`. It has zero dependencies and is plain-Node safe, so every
main module can import it (including the type-stripped `src/main/omp` modules).
Each line is:

```text
<ISO timestamp> <LEVEL> [scope] <message> key=value ...
```

`debug` and `info` go to stdout; `warn` and `error` go to stderr. Derive a child
logger with `scoped(tag)` so every line is prefixed with `[tag]`:

```ts
import { scoped } from "./logger";
const log = scoped("main");
log.info("renderer loaded");
log.error("renderer process gone", { reason: details.reason });
```

The active threshold is read from `OMP_STUDIO_LOG_LEVEL`
(`debug|info|warn|error`, default `info`) on every call, so it can be flipped at
runtime without a restart. The logger never throws and never serializes secrets
the caller did not hand it.

Renderer console errors are forwarded to the same logger. In `src/main/index.ts`,
the `console-message` handler routes any renderer `level >= 2` (error) to
`log.error("renderer: <message>")`, so a renderer crash or uncaught error leaves
a main-process trace alongside the DevTools console.

### Where logs go

- `npm run dev`: stdout and stderr in the terminal running electron-vite.
- `npm run build && npm run start`: stdout and stderr in the terminal launching
  the built app.
- Packaged app: stdout and stderr of the launched binary. The Release workflow
  captures them to a temp file to grep for `smoke ok`.

## Smoke boot (`OMP_STUDIO_SMOKE=1`)

Set `OMP_STUDIO_SMOKE=1` to boot the app without showing a window. In
`src/main/index.ts`, `createWindow()` checks the flag: on `ready-to-show` it
skips `mainWindow.show()`, and on `did-finish-load` it logs `smoke ok`. The
Release workflow uses this as a fail-fast boot gate: it packages an unpacked
build, launches it with `OMP_STUDIO_SMOKE=1`, and waits for `smoke ok` in the
output before spending time on installers. The hermetic e2e specs set it too, so
no window flashes during a Playwright launch.

```sh
OMP_STUDIO_SMOKE=1 npm run start
# watch stdout for: [main] smoke ok
```

## Renderer crash recovery

A gone renderer (OOM, GPU fault, crashed V8) is recoverable: the `BrowserWindow`
is still alive and main-owned state (the `SessionRegistry`, settings, the
`BrowserViewManager`) is intact. In `src/main/index.ts`, the
`render-process-gone` handler reloads the web contents instead of stranding the
user on a blank window. It is bounded twice so a boot-path crash cannot loop:

- A **burst filter** drops out crashes older than 30s. More than 3 crashes in
  that window means the crash is on the boot path, so it stops reloading.
- A **lifetime cap** of 5 auto-reloads per window stops a slower crash loop from
  reloading forever.

A `clean-exit` or `killed` reason is a deliberate teardown, not a crash, and
never triggers a reload. Past the caps the user can still reload manually.

## Common issues

### `omp` or `gh` not found

The app probes common install locations (Homebrew, `~/.bun/bin`, `~/.local/bin`)
and falls back to a bare `omp`/`gh` on `PATH`, so it works as a packaged app
with a minimal `PATH`. If the binary is somewhere else, override it:

- `OMP_BINARY` overrides the `omp` binary location.
- `PI_CODING_AGENT_DIR` overrides the `omp` agent-state dir (default
  `~/.omp/agent`).

How to diagnose it: the data services degrade to `null`/`[]` when a binary is
missing (see [Patterns and conventions](patterns-and-conventions.md)), so a
blank Dashboard or GitHub view usually means the CLI is not on the probed path
or is not authenticated. Check `gh auth status` and `omp --version`. See
[Paths and logging](../systems/paths-and-logging.md) for the resolution order.

### node-pty native addon

The terminal needs `node-pty`'s `spawn-helper` to be executable. Some install or
extraction paths strip the exec bit, leaving `spawn-helper` as `-rw-r--r--`,
which makes `terminal:create` fail at spawn time with the opaque
`posix_spawnp failed` (the `.node` addon itself loads fine, so it is not a
module-load error). The `postinstall` hook
`scripts/ensure-node-pty-exec.mjs` restores the bit on every `spawn-helper`
under `prebuilds/*/` and `build/Release/`. If you hit the error after a manual
`node_modules` change, rerun it:

```sh
node scripts/ensure-node-pty-exec.mjs
```

The script is idempotent, best-effort, and never fails the install (the terminal
is opt-in).

### Sandboxed preload must be CJS

The preload is loaded with `sandbox: true`, and Electron cannot load an ESM
preload in a sandboxed context. The package is `"type": "module"`, so
`electron.vite.config.ts` forces the preload output to CommonJS
(`format: "cjs"`, `entryFileNames: "[name].cjs"`, `inlineDynamicImports: true`)
so the sandbox-safe single-file bundle lands at `out/preload/index.cjs`. If you
change preload build settings and the app fails to load the preload with a
module-format error, this is why: keep the preload CJS. See
[Tooling](tooling.md).

### Live e2e settings pollution

The live e2e specs isolate the studio's settings in a temp `--user-data-dir` and
assert the override took effect, so a misfired flag can never silently pollute
your real host settings. If a live run did write to your real settings, check
that the `--user-data-dir=` arg actually resolved: the `launch()` helper in
`e2e/live.spec.ts` deletes the hermetic `OMP_BINARY`/`GH_BINARY` overrides and
verifies the userData path before proceeding. See [Testing](testing.md).

## DevTools

In `npm run dev`, the renderer DevTools open with the usual Electron shortcuts
(`Cmd/Ctrl+Shift+I`). The `console-message` forwarding means renderer errors also
appear in the main-process terminal, which helps when a crash closes the
DevTools window. For the node side, `OMP_STUDIO_LOG_LEVEL=debug` turns on
debug-level logging in every main module.

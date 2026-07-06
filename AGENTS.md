# OMP Studio

OMP Studio is an Electron + electron-vite + React 18 desktop app (a cockpit for the
Oh My Pi `omp` coding-agent harness). See `README.md`, `docs/ARCHITECTURE.md`, and
`.agents/contract/commands.md` for architecture and the canonical build/test/lint/run
command tables.

## Cursor Cloud specific instructions

The environment definition is versioned at `.cursor/environment.json`; mirror any
dashboard-side environment edits there. The install/update script is `npm install`
(which runs the `postinstall` `ensure-node-pty-exec` step). The following are already
provisioned in the VM image and do **not** need reinstalling — they are noted here as
durable, non-obvious context.

- **Node-side test suite needs `bun`.** `bun test` and `npm run test:rpc` run under
  Bun (scoped to `test/` via `bunfig.toml`), not Node/Vitest. Bun is installed at
  `~/.bun/bin` and added to `PATH` via `~/.bashrc`. `npm run test:ui` (Vitest) covers
  the renderer suite instead. Live/paid cases are gated behind `RPC_LIVE=1` /
  `STUDIO_E2E_LIVE=1` and stay skipped by default.
- **Electron manual run + e2e need a display and system libs.** Chromium system
  libraries are installed (`playwright install-deps`). A live X display is available
  at `DISPLAY=:1`, so `DISPLAY=:1 npm run dev` opens a real window for manual testing;
  otherwise wrap headless launches with `xvfb-run -a`.
- **`npm run test:e2e` requires a fresh build first** (`npm run build`), because
  Playwright's `_electron` runner launches the bundled app from `out/main/index.js`.
- **Electron's `chrome-sandbox` setuid bit.** npm extracts
  `node_modules/electron/dist/chrome-sandbox` without the setuid bit, which makes the
  sandbox helper fail. It has been fixed (`chown root:root` + `chmod 4755`). If Electron
  is ever reinstalled (e.g. a lockfile bump) and the app/e2e fails to launch, re-apply
  that fix.
- **Benign noise to ignore:** D-Bus `bus.cc … Failed to connect to the bus` and GPU
  init warnings on launch, and jsdom's `HTMLCanvasElement.prototype.getContext` warning
  in the Vitest run — none of these indicate a failure.
- **`omp` / `gh` are optional.** The data services degrade gracefully when the `omp`
  harness (and, for GitHub features, `gh`) are absent, so the app, unit tests, and the
  hermetic e2e smoke all run without them.

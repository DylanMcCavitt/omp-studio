# Dependencies

The npm dependency graph for OMP Studio, grouped by role. Only four packages
are true runtime `dependencies` (shipped inside the asar): `@electron-toolkit/utils`,
the xterm packages, and `node-pty`. Everything else is a `devDependency`:
the renderer UI libraries are bundled by Vite into the renderer output and so
do not need to ship as runtime deps, and the rest is build, lint, and test
tooling. Versions are the ranges pinned in `package.json`.

## Runtime

The packages that ship with the packaged app.

| Package | Version | Role |
| --- | --- | --- |
| `@electron-toolkit/utils` | `^3.0.0` | Electron helpers (`is.dev`, `electronApp.setAppUserModelId`, the `optimizer.watchWindowShortcuts` shortcut guard). |
| `node-pty` | `^1.0.0` | Native pseudo-terminal bindings backing the embedded terminal. `asarUnpack`ed in the build config so the native addon loads from disk, and lazy-loaded through `createRequire(import.meta.url)` in `src/main/terminal/registry.ts` on first spawn, so an unbuilt `node-pty` never breaks app startup. |
| `@xterm/xterm` | `^6.0.0` | The renderer-side terminal emulator that renders pty output in the Terminal panel. |
| `@xterm/addon-fit` | `^0.11.0` | xterm addon that fits the terminal grid to its container size. |

`electron` itself is a `devDependency` (`^33.2.1`): the Electron runtime is
downloaded as a platform binary at install time and is the host process, not a
bundled library.

## Renderer UI

The React SPA stack. All bundled by Vite into the renderer output.

| Package | Version | Role |
| --- | --- | --- |
| `react` | `^18.3.1` | The renderer SPA framework. |
| `react-dom` | `^18.3.1` | React DOM renderer. |
| `zustand` | `^5.0.2` | State stores (`src/renderer/src/store/*`). The chat store holds every live session in a normalized `openSessions` map; the pure `session-reducer.ts` does the shaping. |
| `react-resizable-panels` | `^2.1.9` | Resizable split panels for the shell layout (sidebar, chat rail, right icon-rail sheets, center pane splits). |
| `lucide-react` | `^0.468.0` | Icon set used across the shell and views. |
| `clsx` | `^2.1.1` | Conditional class-name builder behind the `cn` helper (`src/renderer/src/lib/cn.ts`). |
| `react-markdown` | `^9.0.1` | Renders assistant markdown in the chat message list and transcript views. |
| `remark-gfm` | `^4.0.0` | GitHub-flavored markdown plugin for `react-markdown` (tables, task lists, strikethrough). |
| `rehype-highlight` | `^7.0.1` | Syntax highlighting for code blocks in markdown; themed through the CSS-variable highlight.js token set. |
| `react-virtuoso` | `^4.18.10` | Virtualized lists for long transcripts and rosters (sessions, subagents). |
| `@codemirror/language` | `^6.12.3` | CodeMirror 6 language infrastructure for the file editor (`src/renderer/src/components/files`). |
| `@codemirror/state` | `^6.6.0` | CodeMirror 6 editor state. |
| `@codemirror/view` | `^6.43.1` | CodeMirror 6 editor view. |
| `@codemirror/commands` | `^6.10.3` | CodeMirror 6 commands (find, history, indentation). |
| `@codemirror/lang-javascript` | `^6.2.5` | JavaScript/TypeScript language pack. |
| `@codemirror/lang-json` | `^6.0.2` | JSON language pack. |
| `@codemirror/lang-css` | `^6.3.1` | CSS language pack. |
| `@codemirror/lang-html` | `^6.4.11` | HTML language pack. |
| `@codemirror/lang-markdown` | `^6.5.0` | Markdown language pack. |
| `@codemirror/lang-python` | `^6.2.1` | Python language pack. |
| `@codemirror/lang-rust` | `^6.0.2` | Rust language pack. |
| `@codemirror/lang-go` | `^6.0.1` | Go language pack. |
| `@lezer/highlight` | `^1.2.3` | Lezer highlight bindings behind the CodeMirror syntax highlighting. |
| `tailwindcss` | `^3.4.17` | The utility-class styling framework. Semantic tokens are backed by the CSS-variable set in `src/renderer/src/styles.css`. |

## Build and dev tooling

| Package | Version | Role |
| --- | --- | --- |
| `electron-vite` | `^2.3.0` | The Electron-aware Vite build/dev runner (`npm run dev`, `npm run build`). |
| `vite` | `^5.4.11` | The underlying bundler for main, preload, and renderer. |
| `@vitejs/plugin-react` | `^4.3.4` | React Fast Refresh and JSX transform for the renderer build. |
| `electron-builder` | `^25.1.8` | Packaging (`npm run dist`) into dmg / AppImage / nsis installers. Configured in the `build` block of `package.json`. |
| `typescript` | `^5.7.2` | Type checking and type stripping. `npm run typecheck` runs `tsconfig.node.json` and `tsconfig.web.json`. |
| `@types/node` | `^22.10.2` | Node type definitions for the main and preload builds. |
| `@types/react` | `^18.3.17` | React type definitions. |
| `@types/react-dom` | `^18.3.5` | React DOM type definitions. |
| `postcss` | `^8.4.49` | CSS transform pipeline behind Tailwind. |
| `autoprefixer` | `^10.4.20` | PostCSS plugin that adds vendor prefixes to the compiled CSS. |

## Lint and format

| Package | Version | Role |
| --- | --- | --- |
| `@biomejs/biome` | `^2.5.0` | Linter and formatter (`npm run check`, `npm run lint`, `npm run format`). Recommended preset plus a few off rules; 2-space indent, double quotes, semicolons, trailing commas. |

## Testing

| Package | Version | Role |
| --- | --- | --- |
| `vitest` | `^2.1.9` | Renderer component tests (`npm run test:ui`), jsdom + Testing Library. |
| `@testing-library/react` | `^16.3.2` | React component query and interaction helpers for Vitest. |
| `@testing-library/jest-dom` | `^6.9.1` | DOM assertion matchers for Testing Library. |
| `@testing-library/user-event` | `^14.6.1` | User-interaction simulation for component tests. |
| `jsdom` | `^25.0.1` | DOM implementation for the Vitest renderer environment. |
| `@playwright/test` | `^1.61.0` | End-to-end tests via Playwright `_electron` (`npm run test:e2e`); the smoke suite is hermetic, live scenarios gated behind `STUDIO_E2E_LIVE=1`. |
| `bun` | (system) | The runtime for node-side tests (`bun test`, including the pure session reducer and the RPC bridge test). A system prerequisite, not an npm dependency. |

## Notes

- `node-pty` is the only native addon. It is `asarUnpack`ed and lazy-loaded so
  the app starts even before the terminal capability is enabled (which is off
  by default). The `postinstall` script `scripts/ensure-node-pty-exec.mjs`
  rebuilds the native addon against the installed Electron.
- The CodeMirror language packs are individual packages so unused languages
  can be tree-shaken out of the file editor bundle.
- The xterm terminal (`@xterm/xterm` + `@xterm/addon-fit`) is the renderer
  side of the embedded terminal; the main side is `node-pty` driven by
  `src/main/terminal/registry.ts`.

## Related pages

- [`../how-to-contribute/tooling.md`](../how-to-contribute/tooling.md): the
  build, lint, and test commands and the CI gates.
- [`../how-to-contribute/testing.md`](../how-to-contribute/testing.md): the
  test setup (Vitest, Bun, Playwright).
- [`configuration.md`](configuration.md): the `OMP_BINARY`, `GH_BINARY`, and
  test-gating environment variables.

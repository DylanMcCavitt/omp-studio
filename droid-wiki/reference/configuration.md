# Configuration

OMP Studio is configured through a versioned settings file plus a handful of
environment variables. The settings file is the user-facing surface (theme,
workspaces, layout, capability toggles); the environment variables override
binary locations and gate test and CI modes. The renderer's visual identity is
driven by a CSS-variable token set.

## Settings schema

The settings store is versioned. `StudioSettings = StudioSettingsV2` is the
canonical shape, defined in `src/shared/ipc.ts`. `StudioSettingsV1` is the
original schema; V2 is an additive bump where every new field is optional, so a
persisted V1 file and any partial `settings.update` patch stay valid.
`migrate()` in `src/main/services/settings-service.ts` upgrades a V1 file to
V2 in place (synthesizing `workspaces` 1:1 from `recentProjects` with
`pinned: false`) and leaves the new capability namespaces undefined until the
user opts in. The handlers that read and write settings are documented in
[`../systems/settings-service.md`](../systems/settings-service.md); the channel
map and the full type definitions are in
[`../primitives/ipc-contract.md`](../primitives/ipc-contract.md).

Settings persist to `<userData>/settings.json` (the Electron userData
directory, injected at boot through `setSettingsDir` in
`src/main/services/settings-service.ts`). The store is plain Node with no
Electron import, so it stays unit-testable; `OMP_STUDIO_SETTINGS_DIR` overrides
the directory for non-Electron contexts such as `bun test`, and the injected
value wins in production. Writes are atomic (temp file plus rename) and
serialized through a promise-queue mutex so concurrent writer families (the
registry's `openSessions` persistence versus renderer `settings:update`
patches) cannot interleave. Unknown keys, invalid values, and anything
token-shaped are dropped on read and on write, so secrets can never ride along
inside a known namespace.

### Top-level fields (V1, carried into V2)

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `theme` | `ThemeMode` (`"system" | "dark" | "light"`) | `"system"` | Color mode. `"system"` follows the OS `prefers-color-scheme`. |
| `defaultProject` | `string | null` | `null` | Default workspace cwd for new chats. |
| `defaultModel` | `string | null` | `null` | Default model selector (e.g. `"anthropic/claude-opus-4-8"`). |
| `defaultThinkingLevel` | `ThinkingLevel` (`"off" | "minimal" | "low" | "medium" | "high" | "xhigh"`) | `"medium"` | Default reasoning depth for new chats. |
| `defaultApprovalMode` | `ApprovalMode` (`"always-ask" | "write" | "yolo"`) | `"always-ask"` | Default tool-approval mode for the `rpc-ui` child. |
| `defaultAutoApprove` | `boolean` | `false` | Default auto-approve flag paired with the approval mode. |
| `liveSessionLimit` | `number` | `4` | Max concurrent live chat sessions. |
| `recentProjects` | `RecentProject[]` (`{ cwd, label, lastUsedAt }`) | `[]` | Legacy project log. Superseded by `workspaces` in V2; retained for migration. |
| `openSessions` | `OpenSessionDescriptor[]` | `[]` | Persisted open-chat descriptors so a fresh boot can list them for resume. |

`OpenSessionDescriptor` is `{ studioSessionId, cwd, createdAt, lastActiveAt,
title, model?, thinkingLevel?, approvalPolicy, sessionFile?, ompSessionId?,
status }` where `status` is `"open" | "hibernated" | "closed"`. The registry
hydrates from this list at boot without spawning children; the renderer
resumes them on demand.

### `workspaces` (V2, optional)

First-class project workspaces. Supersedes `recentProjects`. Synthesized 1:1
from `recentProjects` on migrate (each with a fresh `id` and `pinned: false`).

| Field | Type | Purpose |
| --- | --- | --- |
| `id` | `string` | Stable uuid; survives label and prefs across an explicit cwd edit. |
| `cwd` | `string` | Workspace root. New chats in this workspace run against this cwd. |
| `label` | `string` | Display label. Defaults to the project basename, user-overridable. |
| `pinned` | `boolean` | Pins the workspace to the top of the picker. |
| `lastUsedAt` | `string` | Last-used timestamp (ISO string). |
| `color` | `WorkspaceColorKey?` | Optional curated color key; absent means no color. |

`WORKSPACE_COLOR_KEYS` is the curated tuple `["slate", "red", "amber", "green",
"teal", "blue", "violet", "pink"]` (AGE-671). The renderer maps each key to a
swatch value; main only needs the key set to validate persisted data without
importing renderer-only presentation.

### `layout` (V2, optional)

Persisted resizable shell layout. Every field optional.

| Field | Type | Purpose |
| --- | --- | --- |
| `sidebarWidthPct` | `number?` | Left sidebar width as a percent of the shell. |
| `sidebarCollapsed` | `boolean?` | Whether the sidebar is collapsed. |
| `chatRailWidthPct` | `number?` | Chat right-rail width as a percent of the shell. |
| `chatRailCollapsed` | `boolean?` | Whether the chat right-rail is collapsed. |
| `navOrder` | `string[]?` | Ordered route ids for the sidebar nav. |
| `navHidden` | `string[]?` | Route ids hidden into the sidebar overflow. |
| `chatRailPanels` | `{ id: string; visible: boolean }[]?` | Chat right-rail panel order and per-panel visibility. |
| `rightPanelId` | `string | null?` | Last-open right icon-rail destination route id (`null` or absent means collapsed). |
| `rightPanelWidthPct` | `number?` | Legacy right icon-rail panel width (percent of shell); read-only fallback. |
| `rightPanelWidthsPx` | `Record<string, number>?` | Right icon-rail overlay sheet widths in px, keyed by destination route id. |

### `ui` (V2, optional)

| Field | Type | Purpose |
| --- | --- | --- |
| `collapsed` | `Record<string, boolean>?` | Persisted collapse state keyed by each Collapsible `persistKey`. |
| `pinnedCommands` | `string[]?` | Pinned command names for the Commands palette. |

### `linear` (V2, optional)

Non-secret Linear metadata only. The API key lives in the OS keychain via
`safeStorage` and never crosses into settings JSON.

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `writesEnabled` | `boolean` | `false` | Gates the optional Linear CRUD channels (`createIssue`, `updateIssue`, `createComment`). |
| `defaultTeamId` | `string | null?` | absent | Default team for new Linear issues. |

### `terminal` (V2, optional)

The embedded terminal capability. Off by default; a fresh install mints the
full block with `enabled: false`, while an upgraded V1 file leaves the
namespace undefined (still disabled) until the user opts in.

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Whether the embedded terminal is available. |
| `maxConcurrent` | `number` | `4` | Max concurrent pty sessions. |
| `defaultTarget` | `TerminalDefaultTarget?` (`"built-in" | "external"`) | `"built-in"` | Where terminal affordances open by default. |
| `externalProfile` | `ExternalTerminalProfile?` | `"system"` | Which external app to prefer when `defaultTarget` is `"external"`. |

`ExternalTerminalProfile` is `"system" | "ghostty" | "kitty" | "iterm2" |
"alacritty" | "wezterm"`. The launcher discovery types
(`ExternalTerminalLauncherInfo`, `ExternalTerminalLaunchResult`) describe what
`terminal.externalLaunchers` and `terminal.openExternal` return at runtime.

### `browser` (V2, optional)

The embedded browser capability. Off by default.

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Whether the embedded browser is available. |
| `bookmarks` | `BrowserBookmark[]?` (`{ url, title, createdAt }`) | absent | Saved bookmarks. URLs are sanitized to http(s) with no embedded credentials. |
| `history` | `BrowserHistoryEntry[]?` (`{ url, title, lastVisitedAt }`) | absent | Browsing history. Same URL sanitization as bookmarks. |

### Secure defaults

Three capabilities ship off and must be explicitly enabled in settings:
`terminal.enabled`, `browser.enabled`, and `linear.writesEnabled`. The Linear
API key is never stored in settings JSON; it lives in the OS keychain via
`safeStorage` (see [`../systems/secret-store.md`](../systems/secret-store.md)).

## Environment variables

| Variable | Source | Purpose |
| --- | --- | --- |
| `OMP_BINARY` | `src/main/paths.ts` (`ompBinary`) | Override the `omp` binary location. The override wins even if the path does not exist, which is how the e2e smoke stays hermetic (no `omp` child spawned). When unset, the app probes `/opt/homebrew/bin/omp`, `/usr/local/bin/omp`, `~/.bun/bin/omp`, `~/.local/bin/omp`, then falls back to bare `omp` on PATH. |
| `GH_BINARY` | `src/main/paths.ts` (`ghBinary`) | Override the `gh` CLI location. Same probing strategy as `OMP_BINARY` (`/opt/homebrew/bin/gh`, `/usr/local/bin/gh`, then bare `gh`). |
| `PI_CODING_AGENT_DIR` | `src/main/paths.ts` (`agentDir`) | Override the `omp` agent-state directory (default `~/.omp/agent`). The sessions tree and `mcp.json` resolve under here. |
| `OMP_STUDIO_SMOKE` | `src/main/index.ts` | `OMP_STUDIO_SMOKE=1` is smoke-boot mode: the main process logs `smoke ok` after the renderer finishes loading and suppresses the window show. Used by the e2e smoke suite. |
| `OMP_STUDIO_SETTINGS_DIR` | `src/main/services/settings-service.ts` | Override the settings directory for non-Electron contexts such as `bun test`. The `setSettingsDir` value injected at boot wins in production. |
| `ELECTRON_SKIP_BINARY_DOWNLOAD` | `.github/workflows/ci.yml` | `=1` skips the Electron binary download. Set on the `gate` CI job so lint, typecheck, and unit tests run without the Electron binary. |
| `STUDIO_E2E_LIVE` | `e2e/live.spec.ts` | `=1` gates the live e2e scenarios that spend real `omp` model turns. Skipped by default; run with `STUDIO_E2E_LIVE=1 npm run test:e2e`. |
| `RPC_LIVE` | `test/rpc-bridge.test.ts` | `=1` gates the live RPC bridge test (a paid streaming prompt). Skipped by default; run with `npm run test:rpc` plus `RPC_LIVE=1`. |
| `ELECTRON_RENDERER_URL` | `src/main/index.ts` | The dev renderer URL set by `electron-vite dev`. In dev the main window loads it; in-packaged builds the main window loads the bundled `index.html`. |

Prerequisites for running the app (the `omp` and `gh` CLIs) are covered in
[`../overview/getting-started.md`](../overview/getting-started.md).

## Theme tokens

The renderer's visual identity is a CSS-variable token set in
`src/renderer/src/styles.css`, consumed by Tailwind through
`tailwind.config.js`. Every semantic color token is backed by a CSS variable
holding space-separated RGB channels, so Tailwind's `/<alpha>` opacity
modifiers keep working (`rgb(var(--c-x) / <alpha-value>)`). The identity is
graphite: a neutral surface ramp with a monochrome accent (AGE-672, no hue).
The only chromatic hues in the chrome are the status colors, the highlight.js
entity token, and the per-workspace color swatches. AGE-658 is the visual
identity refresh that introduced this token set.

`lib/theme.ts` resolves `settings.theme` to a concrete `dark` or `light`
choice (`system` follows the OS `prefers-color-scheme`), and
`lib/useTheme.ts` applies it by toggling the `dark` class on the document
root (Tailwind `darkMode: "class"`). `:root` carries the light palette; `.dark`
overrides it with the dark cockpit palette.

### Surface and structure

| Token | Light (RGB) | Dark (RGB) | Tailwind key | Purpose |
| --- | --- | --- | --- | --- |
| `--c-bg` | `246 246 249` | `12 12 15` | `bg-bg` | App background. |
| `--c-bg-raised` | `251 251 253` | `14 14 18` | `bg-bg-raised` | Recessed inset surface (panel2). |
| `--c-bg-panel` | `255 255 255` | `19 19 24` | `bg-bg-panel` | Elevated panel surface. |
| `--c-bg-hover` | `237 237 242` | `23 23 29` | `bg-bg-hover` | Hover fill. |
| `--c-terminal-bg` | `255 255 255` | `8 8 10` | `bg-bg-terminal` | Embedded terminal background. |
| `--c-code-bg` | `237 237 242` | `28 28 34` | `bg-bg-code` | Inline code and code-block background. |
| `--c-border` | `219 219 227` | `41 41 51` | `border` | Default border. |
| `--c-border-subtle` | `231 231 238` | `30 30 38` | `border-subtle` | Subtle divider. |
| `--c-border-strong` | `198 198 209` | `57 57 71` | `border-strong` | Strong divider and scrollbar thumb. |
| `--shadow-panel` | soft | deep | `shadow-panel` | Panel elevation shadow. |
| `--shadow-glow` | accent-tinted | accent-tinted | `shadow-glow` | Focus/glow ring. |

### Ink (text)

| Token | Light (RGB) | Dark (RGB) | Tailwind key | Purpose |
| --- | --- | --- | --- | --- |
| `--c-ink` | `22 22 28` | `238 238 243` | `text-ink` | Primary text. |
| `--c-ink-clear` | `44 44 56` | `207 208 216` | `text-ink-clear` | Secondary primary text (between ink and ink-muted). |
| `--c-ink-muted` | `90 90 103` | `166 167 179` | `text-ink-muted` | Muted text. |
| `--c-ink-faint` | `116 116 131` | `129 130 144` | `text-ink-faint` | Faint text and hover scrollbar. |

### Accent (monochrome graphite, AGE-672)

| Token | Light (RGB) | Dark (RGB) | Tailwind key | Purpose |
| --- | --- | --- | --- | --- |
| `--c-accent` | `24 24 30` | `226 228 234` | `accent` | Filled primary button fill. Dark-on-light in light mode, light-on-dark in dark mode. |
| `--c-accent-hover` | `42 42 52` | `245 245 248` | `accent-hover` | Hover fill. |
| `--c-accent-soft` | `236 236 241` | `32 32 40` | `accent-soft` | Soft accent surface (chips, subtle fills). |
| `--c-accent-ink` | `255 255 255` | `12 12 15` | `accent-ink` | Text rendered on an accent fill. |

### Status and reasoning

| Token | Light (RGB) | Dark (RGB) | Tailwind key | Purpose |
| --- | --- | --- | --- | --- |
| `--c-success` | `26 127 55` | `74 222 128` | `success` | Success state. |
| `--c-warn` | `180 83 9` | `251 191 36` | `warn` | Warning state. |
| `--c-danger` | `207 34 46` | `248 113 113` | `danger` | Danger state. |
| `--c-thinking` | `100 100 116` | `150 152 168` | `thinking` | Reasoning indicator (calm neutral slate). |
| `--c-diff-add` | `63 185 104` | `63 185 104` | `diff-add` | Diff added-line marker. |
| `--c-diff-remove` | `224 89 79` | `224 89 79` | `diff-remove` | Diff removed-line marker. |

### Code syntax (highlight.js)

Code-block syntax colors are variable-driven too, replacing the dark-only
highlight.js stylesheet so light mode stays legible. The values mirror the
GitHub light and GitHub dark themes.

| Token | Light | Dark | Maps to |
| --- | --- | --- | --- |
| `--hljs-keyword` | `#d73a49` | `#ff7b72` | Keywords, types. |
| `--hljs-entity` | `#6f42c1` | `#d2a8ff` | Function and class titles (the only purple in the chrome). |
| `--hljs-constant` | `#005cc5` | `#79c0ff` | Constants, numbers, attributes. |
| `--hljs-string` | `#032f62` | `#a5d6ff` | Strings, regexps. |
| `--hljs-variable` | `#e36209` | `#ffa657` | Built-ins, symbols. |
| `--hljs-comment` | `#6a737d` | `#8b949e` | Comments. |
| `--hljs-tag` | `#22863a` | `#7ee787` | Tags, selectors. |
| `--hljs-heading` | `#005cc5` | `#1f6feb` | Section headings. |
| `--hljs-bullet` | `#735c0f` | `#f2cc60` | Bullets. |
| `--hljs-addition` / `--hljs-addition-bg` | `#22863a` / `#f0fff4` | `#aff5b4` / `#033a16` | Diff addition text and background. |
| `--hljs-deletion` / `--hljs-deletion-bg` | `#b31d28` / `#ffeef0` | `#ffdcd7` / `#67060c` | Diff deletion text and background. |

The per-workspace color swatches (the `WORKSPACE_COLOR_KEYS` palette, including
`violet` `#8b5cf6`) are rendered inline on workspace dots and labels; they are
not part of the global token set.

## Related pages

- [`../systems/settings-service.md`](../systems/settings-service.md): settings
  persistence, the V1-to-V2 migration, and the write mutex.
- [`../primitives/ipc-contract.md`](../primitives/ipc-contract.md): the
  `settings:get` / `settings:update` channels and the full settings type
  definitions.
- [`../overview/getting-started.md`](../overview/getting-started.md): the
  `omp` and `gh` CLI prerequisites behind `OMP_BINARY` and `GH_BINARY`.
- [`../how-to-contribute/tooling.md`](../how-to-contribute/tooling.md): how
  `ELECTRON_SKIP_BINARY_DOWNLOAD` gates the CI `gate` job.

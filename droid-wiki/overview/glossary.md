# Glossary

Project-specific terms used across OMP Studio. The canonical domain glossary
also lives in [`.agents/contract/domain.md`](.agents/contract/domain.md).

## Product

| Term | Meaning |
| --- | --- |
| OMP Studio | The Electron desktop cockpit for the Oh My Pi (`omp`) coding-agent harness. |
| omp / OMP harness | The coding-agent CLI/runtime this app drives ([can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)). |
| Workspace | A project root the user opens; threads/sessions run against its cwd. Supersedes the v1 `recentProjects` log. |

## Stack and process model

| Term | Meaning |
| --- | --- |
| Main | Electron main process (`src/main`): omp RPC bridge, services, terminal/browser backends, IPC. |
| Renderer | React 18 UI (`src/renderer`): Zustand stores, Tailwind v3, react-resizable-panels, lucide icons. |
| Preload | Context-bridge surface (`src/preload`) exposing the typed `window.omp` API. |
| Shared | Cross-process contracts (`src/shared`): `ipc.ts` (channels + `OmpApi`), `domain.ts` (domain types), `rpc.ts` (omp protocol types). |
| Gates | `biome` (lint/format), `tsc` typecheck, `vitest` (renderer), `bun test` (node), Playwright `_electron` e2e, `electron-vite build`. |

## Runtime and RPC

| Term | Meaning |
| --- | --- |
| OMP child | The real `omp` process driven over JSONL stdio from the main process (`src/main/omp`). |
| JSONL frame | One newline-delimited protocol object to/from the OMP child. |
| RPC bridge | Main-process layer that spawns the OMP child and maps frames to IPC events/results. |
| Session lifecycle | Spawn, ready, prompt, stream, idle, cancel/abort, close, child-process teardown. Statuses: `spawning`, `ready`, `exited`, `error`. |
| Live vs hibernated session | A live session has a running child; a hibernated session is restored from its JSONL transcript with no child (resumable). |
| Transcript provenance | The visible source path / session id needed to resume or inspect a session later. |

## Surfaces

| Term | Meaning |
| --- | --- |
| Right icon rail + expandable panels | The right-side nav rail and the panels it opens (Dashboard, Skills, MCP, Agents, Terminal, Browser, Changes, GitHub, Linear, Settings). Global app chrome (one `openPanelId`). |
| Subagent tree / inspector | Live hierarchy of OMP subagent lifecycle/progress frames, with a full-view transcript drill-in. |
| Drill-in | Opening a subagent/session transcript or event stream from the tree into the center view. |
| Terminal panel | In-app shell: `xterm` renderer over a `node-pty` child (`src/main/terminal`). User-initiated, gated. |
| Browser panel | Sandboxed `WebContentsView` browser (`src/main/browser`). User-initiated, gated. |
| Files | Workspace-scoped file tree + CodeMirror 6 editor tabs. |
| Changes | Read-only local git diff view scoped to the active workspace cwd. |
| Read-only bridge | GitHub / Linear context access that cannot mutate external state. |
| Pane | An independent center surface: a chat transcript (optionally pinned to a session), a file editor, or a subagent inspector. Up to 8 in a split tree. |

## Security boundaries

| Term | Meaning |
| --- | --- |
| Privileged renderer | The main app window, which loads only the local bundle under a `'self'` CSP. Distinct from the embedded browser. |
| Embedded browser boundary | A separate sandboxed `WebContents` per tab: `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, no preload, http(s)-only navigation, ephemeral in-memory session by default. No agent auto-control. |
| Terminal boundary | User-initiated, off by default. Agent frames never write directly to pty input. |
| Secret store | OS-keychain ciphertext via Electron `safeStorage` (`services/secret-store.ts`). Secrets never cross UI/runtime/log/transcript boundaries or tracked files. |

## Tracking

| Term | Meaning |
| --- | --- |
| AGE | The Linear team key for this project (team `dmcc`, project `OMP Studio`). Issues are referenced as `AGE-###`. |

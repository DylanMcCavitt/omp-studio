# Sessions browser

The sessions browser is the read-only view over every past `omp` session on this machine. It reads the JSONL transcripts straight from `~/.omp/agent/sessions` (and the archive root when you toggle it), groups them by project, and replays any one in a transcript pane. A debounced query swaps the left pane from the summary list into grouped search hits with highlighted snippets, and a per-session overflow menu handles rename, archive, delete, export, and reveal. The same transcript search backs the Cmd+K global search, which can open a transcript scrolled to a specific message.

## Directory layout

```text
src/renderer/src/views/
  Sessions.tsx                     list + search + detail layout
src/renderer/src/components/
  session/
    SessionActionsMenu.tsx         overflow menu (rename/delete/archive/export/reveal)
    RenameSessionDialog.tsx        rename modal (studio alias, no JSONL rewrite)
  search/
    Highlight.tsx                  snippet highlighter (<mark> over match ranges)
  transcript/
    TranscriptView.tsx             message list with focusIndex scroll
src/main/services/
  session-store.ts                 listSessions / readSession / searchSessions / actions
  session-paths.ts                 resolveSessionPath containment + archivedDir
src/main/ipc/
  data.ts                          registerDataIpc wires session actions to shell
src/renderer/src/store/
  app.ts                           focusSession / clearSessionFocus (cross-route focus)
src/shared/
  domain.ts                        SessionSummary / SessionTranscript / SessionSearchHit
  ipc.ts                           CH.listSessions / readSession / searchSessions / session.*
```

## Key abstractions

| Abstraction | File | Role |
| --- | --- | --- |
| `listSessions` | `src/main/services/session-store.ts` | Enumerates `<sessionsDir>/<slug>/*.jsonl` (and `<archivedDir>` when `includeArchived`), parses each header and counts messages, applies studio aliases, and returns `SessionSummary[]` sorted newest-first. |
| `readSession` | `src/main/services/session-store.ts` | Resolves the path through `resolveSessionPath` (containment), parses the full JSONL into `OmpMessage[]`, and returns `SessionTranscript`. A hostile or unreadable path degrades to an empty transcript, never a throw. |
| `searchSessions` | `src/main/services/session-store.ts` | Case-insensitive substring scan over message text. Files are located newest-first by a metadata-only pass, then streamed line by line; only sessions that produce hits pay for a full summary read. Returns `SessionSearchHit[]` with a snippet and highlight `ranges`. |
| `SessionSearchHit` | `src/shared/domain.ts` | One match: the `session` summary, `messageIndex` (aligned with `readSession`), `role`, a windowed `snippet`, and `ranges` re-based into the snippet string. |
| `focusSession` | `src/renderer/src/store/app.ts` | A pending `SessionFocus` (`{ path, messageIndex }`) set by the global search. Opens the Sessions panel and is consumed once by the view to select the transcript and scroll to the message. |
| `SessionActionsMenu` | `src/renderer/src/components/session/SessionActionsMenu.tsx` | Shared overflow menu for live and historical sessions. Routes every file action through `window.omp.session.*`; Close is live-only, Archive/Unarchive are historical-only. |

## How it works

The view holds three pieces of local state: the selected path, an optional `focusIndex` (the message to scroll to), and the `includeArchived` toggle. The left pane is driven by one of two `useAsync` calls depending on whether the query is empty.

### List mode

When the query is empty, `listSessions({ includeArchived })` returns `SessionSummary[]` and the view groups them by `project` into `SessionGroup[]` (sorted by `lastActive`). Selecting a row calls `openSummary(path)`, which sets the detail pane to that transcript with no focus index. The "Show archived" toggle re-runs the list with `includeArchived: true`, which adds the `<archivedDir>` root to the scan; archived rows carry an "Archived" badge.

### Search mode

A non-empty query debounces 200ms, then calls `searchSessions(q, { includeArchived })`. The result is tagged with the query that produced it so a stale result set (`useAsync` keeps previous data while a new query loads) is never shown or clicked. Hits are grouped by session path; each hit renders its `role` badge and a `Highlight`-ed snippet. Clicking a hit calls `openHit(hit)`, which sets both the path and `focusIndex` so the transcript opens scrolled to the matched message.

The "Searching" flag spans the debounce gap and the in-flight scan, so the pane never flickers "No matches" mid-type. A failed scan surfaces as an explicit error state rather than reading as empty.

### The focusSession flow

The Cmd+K overlay (see [Global search](global-search.md)) can activate a historical hit by calling `focusSession({ path, messageIndex })`. That sets `sessionFocus` in the app store and opens the Sessions panel. The view's `useEffect` consumes it once: it sets the selected path and focus index, then calls `clearSessionFocus()`. The detail pane's `TranscriptView` receives `focusIndex` and scrolls to that message.

### Session actions

The detail header mounts a `SessionActionsMenu` with the session's path, title, and archived flag. Each action routes through `window.omp.session.*` to the session-store service, and the IPC layer in `src/main/ipc/data.ts` injects the Electron `shell` capabilities (`shell.trashItem` for delete, `shell.showItemInFolder` for reveal) so the service stays electron-free and unit-testable.

| Action | Backend | Notes |
| --- | --- | --- |
| Rename | `renameSession` | Writes a studio display alias to `~/.omp/agent/studio-session-aliases.json`, keyed by the contained path. The JSONL header is never rewritten. An empty title clears the alias. |
| Archive / Unarchive | `archiveSession` / `unarchiveSession` | Moves the JSONL between `sessionsDir()` and `archivedDir()` (a sibling under `agentDir()`), preserving the `<project>/<file>` layout. The alias follows the file. |
| Delete | `deleteSession` | Moves the file to the OS trash via `shell.trashItem` (recoverable). Never unlinks. On a live session the child is disposed first so the file is no longer held open. |
| Export HTML | `exportSessionHtml` | Runs `omp --export <jsonl>` in a dedicated exports dir, parses the printed `Exported to:` path, and reveals it. |
| Reveal | `revealSession` | `shell.showItemInFolder` on the contained path. |

After a listing-affecting change, the view reloads the list (and re-runs the search in search mode); a rename bumps a `detailRefresh` counter to re-read the detail, while delete/archive/unarchive clears the selection because the file moved or is gone.

### Path containment

Every IPC surface that accepts a session path funnels through `resolveSessionPath` in `src/main/services/session-paths.ts`. It rejects non-`.jsonl` paths and canonicalizes (symlink-resolved) both the candidate and the roots before checking containment against `sessionsDir()` and `archivedDir()`, so a hostile path can never escape the session roots. See [Session store](../systems/session-store.md) for the full backend.

## Integration points

- **Global search** shares `searchSessions` and the `Highlight` component; its history hits activate `focusSession`. See [Global search](global-search.md).
- **Backend** (listing, read, search, actions, containment) is covered in [Session store](../systems/session-store.md); the IPC wiring is in [Data services](../systems/data-services.md).
- **Domain types** (`SessionSummary`, `SessionTranscript`, `SessionSearchHit`) are documented in [Domain types](../primitives/domain-types.md).
- The `SessionActionsMenu` is also used by the live session list in the chat rail; see [Session management](chat/session-management.md).

## Entry points for modification

- Add a new session action: extend `SessionActionResult` and `SessionActionsMenu` in `src/renderer/src/components/session/SessionActionsMenu.tsx`, add the backend in `src/main/services/session-store.ts`, wire it in `src/main/ipc/data.ts`, and add the channel to `src/shared/ipc.ts`.
- Change search caps or snippet radius: the `SEARCH_*` constants at the top of `src/main/services/session-store.ts` (`SEARCH_RESULT_CAP`, `SEARCH_HITS_PER_SESSION`, `SEARCH_SNIPPET_RADIUS`, `SEARCH_MAX_RANGES`).
- Change the debounce: `useDebouncedValue(query, 200)` in `src/renderer/src/views/Sessions.tsx`.

## Key source files

| File | Purpose |
| --- | --- |
| `src/renderer/src/views/Sessions.tsx` | List + search + detail layout, `focusSession` consumption, archived toggle. |
| `src/renderer/src/components/session/SessionActionsMenu.tsx` | Shared overflow menu (rename, delete, archive, export, reveal). |
| `src/renderer/src/components/session/RenameSessionDialog.tsx` | Rename modal (studio alias). |
| `src/renderer/src/components/search/Highlight.tsx` | Snippet highlighter over match ranges. |
| `src/main/services/session-store.ts` | `listSessions`, `readSession`, `searchSessions`, all mutating actions. |
| `src/main/services/session-paths.ts` | `resolveSessionPath` containment, `archivedDir`. |
| `src/main/ipc/data.ts` | Wires session actions to `shell.trashItem` / `shell.showItemInFolder`. |
| `src/renderer/src/store/app.ts` | `focusSession` / `clearSessionFocus`. |
| `src/shared/domain.ts` | `SessionSummary`, `SessionTranscript`, `SessionSearchHit`. |

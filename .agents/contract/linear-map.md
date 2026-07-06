# Linear map — OMP Studio

Binds the OMP Studio app to Linear and GitHub delivery. Read this before `inserter`, `ghosts`, `roboports`, `rocket-launch`, or any handoff.

## Scope

- Repo: `DylanMcCavitt/omp-studio`, local checkout `port-omp`, default branch `main`.
- OMP Studio is the Electron cockpit for the Oh My Pi (`omp`) coding-agent harness. All app work happens directly in this repo.
- The "OMP Native Zed" Zed-fork workstream is a separate Linear project with its own repo — not tracked here.

## Linear binding

| Field | Value |
| --- | --- |
| Team | `dmcc` / key `AGE` |
| Project | `OMP Studio` |
| Production-readiness epic | `AGE-655` |

## Workflow states

Use real `dmcc` states only.

| Role | Linear state | Type | Use |
| --- | --- | --- | --- |
| needs-triage | `Triage` | triage | Newly captured work that needs classification. |
| backlog | `Backlog` | backlog | Ordered but not ready to start. |
| ready-for-agent | `Ready` | unstarted | Agent can start without more user input. |
| planned-todo | `Todo` | unstarted | Accepted work queued for a specific slice. |
| blocked / needs-info | `Blocked` | unstarted | Waiting on missing credential, human decision, or dependency. |
| in-progress | `In Progress` | started | One issue is actively being built on its branch/worktree. |
| needs-rework | `Rework` | started | Direction changed or scope needs re-cutting. |
| in-review | `In Review` | started | PR/review packet exists. |
| needs-fixes | `Needs Fixes` | started | Review found required changes. |
| ready-for-human | `Human Review` | started | Human approval is required before proceed/merge. |
| merging | `Merging` | started | Launch gate is underway. |
| done | `Done` | completed | Merged/closed through the bridge. |
| wontfix | `Canceled` | canceled | Deliberately not doing this work. |
| duplicate | `Duplicate` | duplicate | Superseded by another issue. |

## Labels

These are the labels in active use on the OMP Studio project. Prefer them; do not invent parallel names.

Excluded workspace labels: `symphony` belongs to the separate `OMP Native Zed` project/Symphony-runnable workflow, not OMP Studio. Do not apply it to OMP Studio issues or pull `symphony` issues into this repo unless the issue is explicitly in the `OMP Studio` Linear project.

### Area

| Label | Use |
| --- | --- |
| `area:renderer` | React renderer (`src/renderer`). |
| `area:main` | Electron main process (`src/main`). |
| `area:platform` | Native deps, packaging, release, terminal/browser backends, infra. |
| `area:shared` | Cross-process contracts (`src/shared`). |
| `area:rpc-bridge` | omp RPC/JSONL bridge (`src/main/omp`). |
| `area:design-ux` | Visual identity, tokens, design-sensitive UI. |

### Team / model

| Label | Use |
| --- | --- |
| `team:ui` | UI/design implementation lanes. |
| `team:platform` | Runtime/backend/integration/infra lanes. |
| `model:opus` / `model:gpt5.5` | Owning model lane for the slice. |

### Type / risk

| Label | Use |
| --- | --- |
| `Feature` | New user-visible capability. |
| `Bug` | Defect/regression. |
| `Improvement` | Enhancement/workflow improvement. |
| `risk:low` | Small, well-understood change with no sensitive boundary. |
| `risk:medium` | UX-sensitive, public API, or first-touch integration work. |
| `risk:high` | Security boundary, credentials, signing/distribution, browser/terminal control, or external-account writes. |

## Estimates and priority

| Linear estimate | Use |
| --- | --- |
| None / unset | Planning-only or bookkeeping issues where effort is not useful. |
| `1` | Docs/config-only slice with no runtime behavior. |
| `2` | Small single-surface implementation or test slice. |
| `3` | Tracer bullet crossing renderer/main/test seams. |
| `5+` | Too large for one branch by default; split into child issues unless explicitly approved. |

- Existing issue estimates are preserved; agents do not rewrite them during implementation unless the issue asks for estimation.
- Priority mapping: Linear `1 Urgent`, `2 High`, `3 Medium`, `4 Low`, `0 None`.

## HITL / AFK classification

Every issue description includes an `Execution` section with exactly one mode.

| Mode | Criteria |
| --- | --- |
| `AFK` | No paid model turn, no credential access, no browser automation against live sites, no terminal input on behalf of an agent, no GitHub/Linear writes except the issue/PR workflow itself, no destructive filesystem or account action. |
| `HITL` | Any paid live OMP prompt, credential/keychain work, GitHub/Linear write outside issue/PR bookkeeping, browser control, terminal/task execution initiated by an agent, secrets handling, signing/distribution, or security-boundary decision. |

If a slice starts AFK and later needs HITL behavior, stop and update the issue before continuing. Do not hide HITL work behind a test flag.

## GitHub / Linear bridge

- One Linear issue -> one branch/worktree -> one PR.
- Branch names must carry the Linear issue id. Prefer Linear's generated branch name, e.g. `dylanmccavitt2015/age-667-platform-terminal-fails-to-start-node-pty-spawn-helper-not`.
- Local worktrees live under `/private/tmp/omp-wt/<lowercase-issue-id>`; bootstrap each fresh worktree with `commands.md` before running gates.
- PR body uses the repo template in `.agents/contract/templates/pull-request.md` and references the Linear issue id.
- Merge through the GitHub/Linear bridge (squash merge closes the issue); do not manually close Linear issues from an implementation agent.

## Executors

Two executors implement the same delivery loop: **local OMP agents** (worktree under `/private/tmp/omp-wt`) and **Cursor Cloud background agents** (headless VM). Both follow Linear issue → branch → PR → gates → squash-merge through the bridge. Executor choice is per-issue, not a separate track.

### Cloud-eligible (Cursor Cloud)

Dispatch to Cursor Cloud only when **all** hold:

- `Execution: AFK` per the classification above.
- Proof is hermetic: `commands.md` gates suffice; VM video/screenshot artifacts may supplement gate output.
- `risk:low` or `risk:medium`; no security-boundary files in scope (`src/main/browser`, `src/main/terminal` gating, `src/main/services/secret-store.ts`).
- Acceptance criteria are already written on the issue.
- One Cursor Cloud agent per issue — never batch multiple issues on one agent.

### Local-only

Keep local when **any** hold:

- `Execution: HITL` per the classification above (paid omp turns, keychain/`safeStorage`, live-site browser automation, agent-driven terminal, signing/distribution, external writes).
- `risk:high` or security-boundary code.
- Design judgment on real macOS rendering (`team:ui` polish, Live Dot work) — cloud may draft; local run gates approval.
- Merge itself: `rocket-launch` is always human/local-initiated. Cloud agents never merge and never push `main`.

### Cloud dispatch rules

- Every dispatch prompt carries the AGE id and Linear-generated branch name. Bare `cursor/*` heads violate the bridge — rename before opening the PR.
- PR body uses the repo template in `.agents/contract/templates/pull-request.md`.
- Cloud PRs open as **draft** until VM proof artifacts are attached (video/screenshot + gate output).
- Same landing strip as local: CI gates, Droid review, human squash-merge. No cloud-special path.

### Sync ritual

At session start and before any cloud dispatch batch:

- `git pull --ff-only` on `main`.
- `git worktree prune`.
- Review open PRs and Linear `In Progress` / `Ready` issues (automation tracked by `AGE-835`).

## Gated work

- Terminal and browser are user-initiated and off by default. Agent frames never write directly to pty input; the browser stays in its sandboxed boundary (separate WebContents, http(s)-only, no OMP bridge/preload/Node, ephemeral storage).
- macOS signing/notarization is deferred (`AGE-589`) — it needs Apple Developer credentials and is out of scope for autonomous work.

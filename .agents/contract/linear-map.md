# Linear map — OMP Native Zed

This contract binds the OMP Native Zed workstream to Linear and GitHub delivery. Read this before `dispatch`, `ghosts`, `robots`, `rocket-launch`, or any handoff.

## Scope

- Planning/bridge repo: `DylanMcCavitt/omp-studio`, local checkout `port-omp`, default branch `main`.
- Implementation target: a Zed fork, not this Electron app. As of 2026-06-23, no local checkout or GitHub repo named `DylanMcCavitt/zed` was found. AGE-639 must create/check out the fork before code work.
- Expected upstream: `zed-industries/zed`, default branch `main`. Verify the actual fork owner/name/default branch in the AGE-639 worktree before editing Zed code.
- No OMP Studio Electron cockpit transplant. The Zed fork keeps Zed primitives and adds OMP through ACP/custom-agent first, then fork-owned native seams where needed.

## Linear binding

| Field | Value |
| --- | --- |
| Team | `dmcc` / key `AGE` |
| Team id | `e513928d-f3e5-4a7c-955a-786a47287d02` |
| Project | `OMP Native Zed` |
| Project id | `03a4635b-5765-483c-aab7-ff97e24ca742` |
| Project URL | https://linear.app/dylanmccavitt/project/omp-native-zed-8ded4620e7fd |
| Project state | `Planned` |
| Initiative | `OMP Studio` |
| Parent issue | `AGE-637` — OMP-native Zed fork |
| First contract issue | `AGE-638` |
| First implementation issue | `AGE-639` |

## Workflow states

Use real `dmcc` states only.

| Role | Linear state | Type | Use |
| --- | --- | --- | --- |
| needs-triage | `Triage` | triage | Newly captured work that needs classification. |
| backlog | `Backlog` | backlog | Ordered but not ready to start. |
| ready-for-agent | `Ready` | unstarted | Agent can start without more user input. |
| planned-todo | `Todo` | unstarted | Accepted work queued for a specific slice. |
| blocked / needs-info | `Blocked` | unstarted | Waiting on missing repo, credential, human decision, or dependency. |
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

### Project labels

| Label | Use |
| --- | --- |
| `codex` | Runtime, backend, integration, testing, security, infra. Default for AGE-638/AGE-639. |
| `claude` | UI/design implementation lanes. |
| `design` | Design-sensitive UI/UX decisions and visual proof. |

### Issue labels used by this track

| Label | Use |
| --- | --- |
| `symphony` | Runnable by autonomous agents from Linear state. |
| `codex` | GPT/codex-owned engineering slice. |
| `claude` | Claude-owned UI/design slice. |
| `risk:low` | Small, well-understood change with no sensitive boundary. |
| `risk:medium` | UX-sensitive, public API, or first-touch integration work. |
| `risk:high` | Security boundary, credentials, signing/distribution, browser/terminal control, or external-account writes. |
| `Improvement` | Enhancement/workflow improvement. |
| `Feature` | New user-visible capability. |
| `Bug` | Defect/regression. |

Existing OMP Studio area/team/model labels remain valid for this repo, but OMP Native Zed ghosts should prefer the labels above until Zed-fork-specific labels are created.

## Milestones, estimates, and priority

- Project milestones: none configured on 2026-06-23.

| Linear estimate | Use for OMP Native Zed ghosts |
| --- | --- |
| None / unset | Planning-only or bookkeeping issues where effort is not useful. |
| `1` | Contract/docs/config-only slice with no runtime behavior. |
| `2` | Small single-surface implementation or test slice. |
| `3` | Tracer bullet crossing runtime/integration/test seams. |
| `5+` | Too large for one robot branch by default; split into child issues unless explicitly approved. |

- Existing issue estimates are preserved; agents do not rewrite them during implementation unless the issue asks for estimation.
- Priority mapping: Linear `1 Urgent`, `2 High`, `3 Medium`, `4 Low`, `0 None`. The OMP Native Zed project and AGE-638 are `2 High`.

## HITL / AFK classification

Every issue description must include an `Execution` section with exactly one mode.

| Mode | Criteria |
| --- | --- |
| `AFK` | No paid model turn, no credential access, no browser automation against live sites, no terminal input on behalf of an agent, no GitHub/Linear writes except the issue/PR workflow itself, no destructive filesystem or account action. |
| `HITL` | Any paid live OMP prompt, credential/keychain work, GitHub/Linear write outside issue/PR bookkeeping, browser control, terminal/task execution initiated by an agent, secrets handling, signing/distribution, or security-boundary decision. |

If a slice starts AFK and later needs HITL behavior, stop and update the issue before continuing. Do not hide HITL work behind a test flag.

## GitHub / Linear bridge

- One Linear issue -> one branch/worktree -> one PR.
- Branch names must carry the Linear issue id. Prefer Linear's generated branch name, for example `dylanmccavitt2015/age-638-zed-00-publish-factorio-contract-for-omp-native-zed-ghosts`.
- Local worktrees live under `/private/tmp/omp-wt/<lowercase-issue-id>` unless the target repo contract says otherwise.
- PR body uses the repo template in `.agents/contract/templates/pull-request.md` and references the Linear issue id.
- Merge through the GitHub/Linear bridge; do not manually close Linear issues from an implementation agent.

## Dependency spine

- AGE-638 blocks AGE-639.
- AGE-639 blocks AGE-640, AGE-641, and AGE-642.
- Browser work is blocked until AGE-647 proves the security boundary.
- Terminal/task writes stay off by default and blocked until approval/UI and boundary slices exist.

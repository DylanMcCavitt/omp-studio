# OMP Studio / OMP Native Zed agent context

## Agent skills

This repo runs the Factorio workflow kit. The per-repo contract is in `.agents/contract/` — read it before planning or building:

- `linear-map.md` — Linear team/project/label/state map, HITL/AFK rules, implementation target, and the GitHub bridge.
- `domain.md` — OMP Native Zed glossary and preserved architecture decisions.
- `commands.md` — observed build/test/lint/run commands for this planning repo and expected Zed-fork commands.
- `templates/` — repo-local PR, Linear issue, project-doc, and PRD templates.

Repo-specific skills and agents live in `.agents/skills/` and `.agents/agents/` when a real recurring workflow needs them. None are scaffolded yet; generic kit skills plus this contract are enough for AGE-638.

## Current track

- Planning/bridge repo: `DylanMcCavitt/omp-studio` on `main`.
- Linear project: `OMP Native Zed` (`AGE` team / `dmcc`).
- Parent issue: `AGE-637`.
- Contract issue: `AGE-638`.
- First implementation issue: `AGE-639`.
- Zed fork repo is not checked out yet; AGE-639 must create/check out the fork and verify its default branch before code changes.

## Rules

- Preserve unrelated user changes.
- One Linear issue -> one branch/worktree -> one PR; branch names must carry the `AGE-###` id.
- Use `/private/tmp/omp-wt/<lowercase-issue-id>` for issue worktrees unless the target repo contract overrides it.
- Do not put secrets, keys, tokens, account IDs, or private environment values in tracked files.
- Do not transplant OMP Studio's Electron cockpit into Zed. Use Zed primitives first; add fork-native panels only after ACP/runtime proof.

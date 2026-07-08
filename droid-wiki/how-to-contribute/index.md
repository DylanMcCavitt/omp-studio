# Contributing

How to pick up work and land a pull request in OMP Studio. This page is the
entry point; the details live in the sibling pages below.

OMP Studio is a solo project under active, pre-1.0 iteration. The fastest way to
land a change is to keep it small, follow the conventions already in the
codebase, and run the gates that touch your change. Work is tracked in Linear
(team `dmcc`, key `AGE`, project `OMP Studio`): every change maps to one
`AGE-###` issue, one branch, and one pull request.

## Pick up work

1. Find or open an issue. Bug reports use
   `.github/ISSUE_TEMPLATE/bug_report.md` and feature requests use
   `.github/ISSUE_TEMPLATE/feature_request.md`; blank issues are disabled and
   security reports route to private advisories
   (`.github/ISSUE_TEMPLATE/config.yml`, see [Security](../security.md)).
   Linear issues carry the `AGE-###` id the rest of the workflow keys off.
   The written policy lives in `CONTRIBUTING.md` at the repo root.
2. Create a worktree for the issue at
   `/private/tmp/omp-wt/<lowercase-issue-id>` (for example
   `/private/tmp/omp-wt/age-796`). See
   [Development workflow](development-workflow.md) for the bootstrap.
3. Branch from `main`. The branch name carries the `AGE-###` id so the GitHub
   bridge links the pull request back to the Linear issue and the merge closes
   it.

## Make the change

- Follow the existing TypeScript and component conventions. The load-bearing
  ones (process boundaries, graceful degradation, security boundaries, the pure
  reducer, the settings schema) are in
  [Patterns and conventions](patterns-and-conventions.md).
- Keep changes focused. One issue leads to one branch leads to one PR.
- Do not put secrets, keys, tokens, or private environment values in tracked
  files. The Linear API key stays in the OS keychain, never in settings JSON.
- Add a line under `## [Unreleased]` in `CHANGELOG.md` describing the change.

## Run the gates

Before opening a pull request, run the full set on your worktree (see
[Development workflow](development-workflow.md) for the cycle and
[Testing](testing.md) for what each suite covers):

```sh
npm run typecheck                # node + web TypeScript projects
npm run check                    # Biome lint + format check
npm run test:ui                  # Vitest renderer component suite
bun test                         # Bun node-side suite (incl. the pure reducer)
npm run test:rpc                 # RPC bridge handshake (live turn needs RPC_LIVE=1)
npm run build                    # bundle main, preload, renderer into out/
npm run build && npm run test:e2e  # hermetic Electron smoke
```

The convention is to run only the gates touching your change while iterating,
then the full set before a PR. On headless Linux, wrap the e2e smoke with
`xvfb-run -a`.

## Open the pull request

The PR template at `.github/pull_request_template.md` sets the shape: the title
is `AGE-### — slice title`, the body starts with `Fixes AGE-###`, and it asks for
a Summary, Changes, Acceptance criteria, Proof, HITL/AFK, and Review notes.
Security-boundary or credential work must be called out in Review notes.
`.github/CODEOWNERS` routes every PR to the maintainer for review.

## Land it

After review, the PR merges to `main`. Releases are cut separately from `main`
with `npm run release` and a tag push; see
[Development workflow](development-workflow.md) and
[Deployment](../deployment.md).

## Where to go next

- [Development workflow](development-workflow.md) — branch, code, test, PR, and
  release cycle.
- [Testing](testing.md) — the three suites and how to run, mock, and cover them.
- [Debugging](debugging.md) — logs, the smoke boot, crash recovery, common
  errors.
- [Tooling](tooling.md) — the build system, lint, packaging, and CI.
- [Patterns and conventions](patterns-and-conventions.md) — the load-bearing
  codebase conventions.
- [Getting started](../overview/getting-started.md) — prerequisites, install,
  build, and run.

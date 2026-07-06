# Contributing to OMP Studio

OMP Studio is a pre-1.0 Electron desktop client for the Oh My Pi (`omp`) coding-agent harness. Contributions are welcome; the bar is a scoped change with a linked issue, clean gates, and a complete PR packet.

## Before you start

1. **Open or claim a GitHub issue first.** Every change maps to a Linear `AGE-###` issue. Use the bug or feature request templates under `.github/ISSUE_TEMPLATE/`.
2. **Discuss scope in the issue** before writing code. Ambiguous or oversized work gets split before implementation starts.
3. **PRs without a linked issue may be closed.** Link the issue in the PR body (`Fixes AGE-###`) and keep the branch name carrying the issue id.

## One issue → one branch → one PR

- Branch from `main`. The branch name must include the issue reference (e.g. `dylanmccavitt2015/age-833-…`).
- One worktree per issue under `/private/tmp/omp-wt/<lowercase-issue-id>`.
- Keep the diff scoped to what the issue describes. Unrelated changes — drive-by refactors, formatting sweeps, bundled features — get the PR sent back for a split.
- Do not commit `node_modules/`, build artifacts, or machine-local paths.

## Development setup

Prerequisites: Node.js, npm, and Bun (for the node-side test suite). Clone the repo and install dependencies:

```sh
npm install
```

`postinstall` runs `scripts/ensure-node-pty-exec.mjs` to restore the `node-pty` native addon executable bit.

### Gates

Run only the gates that touch your change while iterating. Before opening a PR, run the full set on your worktree:

| Purpose | Command |
| --- | --- |
| Lint + format check | `npm run check` |
| Typecheck (node + web) | `npm run typecheck` |
| Renderer/unit tests | `npm run test:ui` |
| Node-side tests | `bun test` |
| Build | `npm run build` |
| Hermetic Electron e2e smoke | `npm run build && npm run test:e2e` |

Live/paid e2e suites (`STUDIO_E2E_LIVE=1`) are **maintainer-only**. Do not run them in CI or contributor PRs without explicit maintainer approval.

On headless Linux, wrap the e2e smoke with `xvfb-run -a`.

## Pull request expectations

Use the template at `.github/pull_request_template.md`. Fill every section:

- **Summary** — what changed and why it belongs in this slice.
- **Changes** — concrete list of edits.
- **Acceptance criteria** — map every Linear criterion to the artifact or location that satisfies it.
- **Proof** — gates you ran and observed output. Mark anything unrun with the blocker, not a vague excuse.
- **HITL / AFK** — whether human-in-the-loop work was required.
- **Review notes** — risks, tradeoffs, and review lens. Call out security-boundary or credential work explicitly.

Other rules:

- **Squash-merge only.** The merge commit lands on `main`; head branches are auto-deleted after merge.
- **CI runs on every PR**, including automated review (Factory Droid via `.github/workflows/droid-review.yml`).
- Add a line under `## [Unreleased]` in `CHANGELOG.md` for user-visible changes. Docs-only slices may omit it when the issue does not require a changelog entry.

## Security boundaries

Terminal and browser capabilities are **user-initiated and gated** — both are off by default in settings. Contributors must not weaken these boundaries:

- Never add code that writes agent output, RPC frames, or remote content to pty input.
- The embedded browser stays in its sandboxed boundary (separate `WebContents`, no OMP bridge/preload/Node).

For the full threat model and process-isolation details, see the [Security notes](docs/ARCHITECTURE.md#security-notes) section in `docs/ARCHITECTURE.md`. Do not restate or duplicate that section here.

To report vulnerabilities, see [SECURITY.md](SECURITY.md).

## Questions

Open a GitHub issue for bugs, features, or process questions. For security reports, use the private advisory flow described in `SECURITY.md` — not a public issue.

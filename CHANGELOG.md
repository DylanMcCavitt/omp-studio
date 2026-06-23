# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Live Playwright `_electron` end-to-end flows (`e2e/live.spec.ts`) gated behind
  `STUDIO_E2E_LIVE=1` (mirroring `RPC_LIVE=1`): a real chat turn, the D1 tool
  approval approve/deny/input-select round-trips, D3 restart-and-resume, and D2
  two-session concurrency. They are skipped by default so `npm run test:e2e` and
  CI stay non-live, and run against the installed `omp` only when the flag is set.

### Changed

- Real tool approvals now render with the rich approval dialog. omp surfaces an
  `always-ask` tool approval as an Approve/Deny `select` (not a `confirm`), so
  the studio detects that shape and routes it to `ApprovalRequestDialog` — Deny
  default-focus, danger styling, and session-scoped "Always allow" — mapping the
  chosen affordance back to the select's `{value}` response. Generic (non
  approval) selects keep the plain `SelectRequestDialog`.
- Skill discovery now mirrors omp's own roots. `listSkills(cwd?)` walks up from
  the active workspace (capped at 5 ancestors) collecting `.agents/skills` and
  `.agent/skills`, adds the user `~/.agents`, `~/.agent`, and `~/.claude` skill
  dirs plus the project `<cwd>/.claude/skills`, and scans the managed/auto-learn
  dir at the exact `<agentDir>/managed-skills` path (no broad `agentDir()` scan,
  so sessions/blobs/SQLite noise stays out). Per-root depth rises 1→2 and skills
  are tagged `claude`/`managed`. The skills/MCP/agents reads and the dashboard
  now thread the active workspace cwd (falling back to the most-recently-active
  chat session's cwd) instead of the wrong `process.cwd()` project root.

## [0.1.0] - 2026-06-19

Initial release.

### Added

- Dashboard aggregating recent sessions, model and provider counts, MCP servers,
  skills, bundled agents, and the current GitHub repository at a glance.
- Live agent chat backed by a per-session `omp --mode rpc` child process, with
  streaming assistant text, thinking blocks, tool-call rendering, steering, and
  follow-ups.
- Sessions browser that reads on-disk session transcripts from `~/.omp/agent`.
- Skills browser scanning project, user, and bundled skill markdown.
- MCP servers browser sourced from user and project MCP configuration.
- Bundled agents browser populated from `omp agents unpack`.
- Models and providers browser sourced from `omp models --json`.
- GitHub browser for the current repository, issues, pull requests, and owned
  repositories via the `gh` CLI.

[Unreleased]: https://github.com/DylanMcCavitt/omp-studio/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DylanMcCavitt/omp-studio/releases/tag/v0.1.0

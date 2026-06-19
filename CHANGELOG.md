# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

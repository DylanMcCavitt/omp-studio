# OMP Native Zed — Project Doc

## Overview

Fork Zed into an OMP-native IDE by keeping Zed's editor/project/thread primitives and integrating OMP through ACP/custom-agent first, then native OMP panels only where Zed surfaces cannot express OMP semantics.

## Context

OMP Studio is the reference for OMP runtime behavior, protocol expectations, security constraints, and E2E coverage. Zed is the target IDE foundation. The bridge repo records planning until the Zed fork exists.

## Scope

- In scope: OMP runtime host, ACP/custom-agent bridge, session lifecycle, approval/input/select widgets, workspace discovery/settings, slash commands, subagent telemetry, read-only GitHub/Linear context, security-gated browser, and off-by-default terminal/task integration.
- Out of scope: copying the Electron cockpit wholesale, replacing Zed editor/project/LSP/git primitives, browser before the boundary threat model, and agent-written terminal input.

## Decisions

- 2026-06-23: ACP/custom-agent spine first.
- 2026-06-23: OmpHost is the permanent runtime seam.
- 2026-06-23: Browser and terminal writes are late, gated work.
- 2026-06-23: Claude owns UI/design lanes; GPT/codex owns runtime/backend/integration/test/security/infra.

## Links

- Project: https://linear.app/dylanmccavitt/project/omp-native-zed-8ded4620e7fd
- Plan document: https://linear.app/dylanmccavitt/document/omp-native-zed-agent-grill-plan-a7d1ffb27c1d
- Parent issue: AGE-637
- Contract issue: AGE-638
- First implementation issue: AGE-639

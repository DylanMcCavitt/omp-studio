# PRD — OMP Native Zed slice

Use the glossary in `.agents/contract/domain.md`. Publish durable specs as Linear documents on the OMP Native Zed project.

## Problem

What specific gap prevents OMP Native Zed from advancing, in user-visible terms.

## Solution

The smallest outcome that resolves the gap while preserving Zed primitives and OMP runtime/security boundaries.

## User stories

1. As a Zed user, I want the slice outcome, so I can use OMP inside the IDE without losing Zed's strengths.

## Decisions

Record only decisions this slice owns. Preserve these defaults unless the issue explicitly overrides them: ACP/custom-agent spine first, OmpHost runtime seam, no Electron cockpit transplant, no browser/terminal writes before their gates.

## Non-goals

- Capabilities outside the issue's acceptance criteria.
- Browser, terminal writes, GitHub/Linear writes, or paid live turns unless explicitly named.

## Acceptance criteria

- [ ] Observable, testable outcome.

## Proof plan

Map each criterion to the highest useful existing seam: fake JSONL, unit mapping, native Zed smoke, visual runner, security smoke, or HITL live OMP proof.

## Open questions / further notes

Only unresolved facts that tools cannot answer. Route blocking unknowns to a research issue rather than expanding implementation scope.

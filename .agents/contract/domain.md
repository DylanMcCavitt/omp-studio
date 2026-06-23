# Domain glossary — OMP Native Zed

Use these nouns in Linear issues, specs, PRs, and review packets. Avoid inventing parallel names.

## Product contexts

| Term | Meaning |
| --- | --- |
| OMP Native Zed | The Zed fork track that makes Zed an OMP-native IDE. |
| OMP Studio | The existing Electron reference app. It is source material for runtime behavior and tests, not UI architecture to copy wholesale. |
| Zed fork | The future implementation repo based on `zed-industries/zed`. Code work begins there after AGE-638. |
| Planning repo | `DylanMcCavitt/omp-studio`; holds this contract and OMP Studio reference behavior until the Zed fork exists. |

## Architecture terms

| Term | Meaning |
| --- | --- |
| ACP/custom-agent spine | Zed's existing external/custom agent path. First visible seam for OMP chat. |
| OmpHost | Fork-owned Rust runtime seam that launches/owns OMP child processes and exposes OMP state to ACP and later native panels. |
| OMP child | The real `omp` process driven over JSONL stdio. Slice 1 is no-tool chat only. |
| JSONL frame | One newline-delimited protocol object from or to the OMP child. |
| Agent thread | Zed's user-visible conversation surface for ACP/custom agents. |
| Transcript provenance | The visible source path/session id needed to resume or inspect a session later. |
| Default-deny UI request | Safe response to unexpected OMP UI/approval/input/select/editor requests before AGE-640 implements widgets. It must not hang the agent. |
| Session lifecycle | Spawn, ready, prompt, stream, idle, cancel/abort, close, and child-process teardown. |

## Capability terms

| Term | Meaning |
| --- | --- |
| Approval widget | Zed UI for approve/deny prompts from OMP. Not in AGE-639. |
| Input/select widget | Zed UI for OMP text input or option selection. Not in AGE-639. |
| Subagent telemetry tree | Live hierarchy of OMP subagent lifecycle/progress frames. |
| Drill-in | Opening a subagent/session transcript or event stream from the telemetry tree. |
| Browser boundary | The security design for any browser panel: separate sandboxed webview/process, http(s)-only navigation, no OMP bridge/preload/Node, ephemeral storage by default, no agent auto-control. |
| Terminal/task integration | User-initiated, off-by-default terminal/task bridge. Agent frames never write directly to pty input. |
| Read-only bridge | GitHub or Linear context access that cannot mutate external state. |

## Ownership lanes

| Lane | Owner |
| --- | --- |
| Runtime/backend/integration/test/security/infra | GPT/codex agents. |
| UI/design/presentation/visual polish | Claude agents. |
| Security-boundary review | GPT/codex security reviewers unless the issue explicitly assigns another owner. |

## Decisions to preserve

- ACP/custom-agent spine first.
- OmpHost is the permanent runtime seam.
- Do not transplant the Electron cockpit, CodeMirror editor, xterm terminal, WebContentsView browser, right rail, or dashboard wholesale into Zed.
- Keep Zed primitives where they already win: editor, project/worktree, LSP, git, terminal/thread affordances, settings, command palette, Agent Panel.
- Browser and terminal writes are late, gated work.
- Secrets never cross UI/runtime/log/transcript boundaries.

## Words to avoid

| Avoid | Use instead |
| --- | --- |
| Electron port | OMP Native Zed / Zed fork integration |
| Right rail port | Native Zed panel, only when ACP is insufficient |
| Browser automation | Browser boundary / browser panel, depending on scope |
| Tool approval in slice 1 | Default-deny UI request |
| Terminal agent control | User-initiated terminal/task integration |

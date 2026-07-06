# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report them privately through [GitHub Security Advisories](https://github.com/DylanMcCavitt/omp-studio/security/advisories/new):

1. Go to the repository **Security** tab.
2. Click **Report a vulnerability**.
3. Provide a clear description, reproduction steps, and impact assessment.

We will acknowledge receipt, investigate, and coordinate disclosure. Please allow reasonable time for a fix before any public disclosure.

## Supported versions

OMP Studio is pre-1.0 and under active iteration. Only the latest `main` branch is supported. Older tags and release builds receive security fixes at maintainer discretion.

## Scope

Security-relevant boundaries in this project include:

| Boundary | Notes |
| --- | --- |
| **Electron main/renderer isolation** | Context isolation is on; the renderer reaches the host only through the typed `OmpApi` IPC surface. No `require`, `ipcRenderer`, or Node built-ins in the renderer. |
| **Sandboxed embedded browser** | Off by default. When enabled, each tab is a separate `WebContentsView` with `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, and no preload — remote content cannot reach `window.omp` or Node. |
| **Gated terminal** | Off by default. When enabled, spawns a real pty at full user privilege. Input reaches a pty only from the local terminal view; agent frames never write to pty input. Concurrency-capped; killed on quit. |

For architecture-level detail, see [Security notes](docs/ARCHITECTURE.md#security-notes) in `docs/ARCHITECTURE.md`.

## Out of scope

- Issues in third-party dependencies without a demonstrable impact on OMP Studio.
- Social engineering, physical access, or attacks requiring the victim to manually enable terminal/browser and execute attacker-controlled commands.
- Vulnerabilities in the external `omp` binary or `gh` CLI beyond how OMP Studio invokes them.

## Recognition

We appreciate responsible disclosure. Acknowledgments will be included in advisory release notes when appropriate and with reporter consent.

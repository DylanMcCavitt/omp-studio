# Commands — OMP Native Zed

Commands are recorded from observed repo files/docs. Do not invent gates in issue work.

## Planning repo: DylanMcCavitt/omp-studio

| Purpose | Command | Source |
| --- | --- | --- |
| Install dependencies | `npm install` | README quick start |
| Run desktop app | `npm run dev` | `package.json`, README |
| Typecheck | `npm run typecheck` | `package.json` |
| Lint/format check | `npm run check` | `package.json` / PR template |
| Format write | `npm run format` | `package.json` |
| RPC bridge test | `npm run test:rpc` | `package.json`, README |
| Renderer/unit tests | `npm run test:ui` | `package.json` |
| Build | `npm run build` | `package.json`, README |
| Hermetic Electron E2E smoke | `npm run build && npm run test:e2e` | README / Playwright config |
| Live paid E2E | `npm run build && STUDIO_E2E_LIVE=1 npm run test:e2e` | README; HITL only |
| Package | `npm run dist` | `package.json` |
| macOS package | `npm run dist:mac` | `package.json` |

Default branch: `main`.

Use planning-repo commands for AGE-638 contract work and any OMP Studio reference/test changes. AGE-638 has no code changes; verification is file-level contract inspection plus optional `npm run check` only if tracked Markdown/template formatting becomes relevant.

## Zed fork: expected commands after checkout

These are from Zed upstream docs inspected during planning. Re-verify in the actual fork before AGE-639 edits.

| Purpose | Command |
| --- | --- |
| Run development build | `cargo run` |
| Run release build | `cargo run --release` |
| Workspace tests | `cargo test --workspace` |
| Visual test runner | `cargo run -p zed --bin zed_visual_test_runner --features visual-tests` |
| Update visual baselines | `UPDATE_BASELINE=1 cargo run -p zed --bin zed_visual_test_runner --features visual-tests` |

Zed visual tests on macOS require Screen Recording permission. Baselines are local/gitignored by Zed convention.

## AGE-639 minimum proof ladder

After the Zed fork exists, the no-tool chat tracer must prove:

1. Fake/captured JSONL `ready -> response -> message_update -> agent_end` maps into ACP frames.
2. Native Zed smoke starts a fake OMP child and sees one thread return idle.
3. Fixture UI request receives deny/cancel response and does not hang.
4. HITL only: one paid harmless real OMP prompt in Zed with persisted transcript path.

Do not run live paid proof in AFK mode.

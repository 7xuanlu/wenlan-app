# Wenlan App Launch Smoke Checkpoint

- **Date:** 2026-06-28
- **Repo:** `/Users/lucian/Repos/wenlan-app`
- **Worktree:** `/Users/lucian/Repos/wenlan-app/.worktrees/wenlan-app-launch-smoke`
- **Branch:** `codex/wenlan-app-launch-smoke`
- **Base:** `origin/main` at `4d4ea79`
- **Daemon:** `127.0.0.1:7878`, version `0.9.1`

## Purpose

Validate that the renamed standalone `wenlan-app` repo can still launch a Tauri desktop app against the live Wenlan daemon, and fix any repeatability issue that blocks later origin-app -> wenlan-app refactor checkpoints from running in isolated worktrees.

This checkpoint is not the full migration. It is the runtime/tooling gate before the next larger parity refactor slices.

## Structural Tooling Used

CodeGraph was synced and queried before editing runtime/launch-adjacent surfaces:

```bash
CODEGRAPH_TELEMETRY=0 DO_NOT_TRACK=1 npx -y @colbymchenry/codegraph sync .
CODEGRAPH_TELEMETRY=0 DO_NOT_TRACK=1 npx -y @colbymchenry/codegraph query WenlanClient --json
CODEGRAPH_TELEMETRY=0 DO_NOT_TRACK=1 npx -y @colbymchenry/codegraph query first_run_install_if_needed --json
CODEGRAPH_TELEMETRY=0 DO_NOT_TRACK=1 npx -y @colbymchenry/codegraph query tray_health --json
CODEGRAPH_TELEMETRY=0 DO_NOT_TRACK=1 npx -y @colbymchenry/codegraph impact WenlanClient --json
CODEGRAPH_TELEMETRY=0 DO_NOT_TRACK=1 npx -y @colbymchenry/codegraph impact first_run_install_if_needed --json
```

Observed useful anchors:

- `WenlanClient` in `app/src/api.rs` with `health` and `status` methods.
- `first_run_install_if_needed` in `app/src/lifecycle.rs`; impact includes `run` and lifecycle tests.
- `tray_health` in `app/src/tray_health.rs`.

ast-grep was used for syntax-level orientation:

```bash
npx -y -p @ast-grep/cli sg outline app/src/lib.rs
npx -y -p @ast-grep/cli sg outline app/src/lifecycle.rs
npx -y -p @ast-grep/cli sg outline app/src/api.rs
```

`rg` was used only after those structural probes to classify residual runtime identity and sidecar surfaces.

## Bug Found

`scripts/prepare-sidecars.sh` still assumed the backend checkout lived at `../..` from the app repo. That accidentally worked in some older nested layouts, but it fails in the real renamed standalone layout and in project-local app worktrees.

Bad worktree resolution before the fix:

```text
/Users/lucian/Repos/wenlan-app/.worktrees/wenlan-app-launch-smoke
  -> /Users/lucian/Repos/wenlan-app/target/debug/wenlan-server
```

Expected backend source:

```text
/Users/lucian/Repos/wenlan/target/debug/wenlan-server
```

This matters because every future Tauri launch/build checkpoint needs sidecars to resolve without manually setting `WENLAN_BACKEND_DIR`.

## Fix

`prepare-sidecars.sh` now validates backend candidates by checking for:

- `Cargo.toml`
- `crates/wenlan-server`
- `crates/wenlan-mcp`
- `crates/wenlan-cli`

Default discovery order:

1. sibling standalone checkout: `$REPO_ROOT/../wenlan`
2. project-local worktree checkout: `$REPO_ROOT/../../../wenlan`
3. legacy nested checkout: `$REPO_ROOT/../..`

`WENLAN_BACKEND_DIR` remains supported. Relative overrides stay relative to the app checkout, and invalid overrides fail loud.

Regression coverage lives in `scripts/prepare-sidecars.test.ts` for:

- standalone `wenlan-app` next to `wenlan`
- `wenlan-app/.worktrees/<name>` next to `wenlan`
- relative `WENLAN_BACKEND_DIR` overrides
- inherited environment isolation for default discovery
- invalid `WENLAN_BACKEND_DIR` failures

## Runtime Evidence

Daemon health during validation:

```text
GET /api/health -> {"status":"ok","db_initialized":true,"version":"0.9.1"}
GET /api/status -> {"is_running":true,"files_indexed":8952,"files_total":0,"sources_connected":[],"reranker":{"state":"disabled"},"reranker_light":{"state":"disabled"},"reranker_mode":"off"}
```

Tauri launch command:

```bash
pnpm tauri dev
```

Observed launch output:

```text
Vite ready at http://localhost:1420/
Running /Users/lucian/Repos/wenlan-app/.worktrees/wenlan-app-launch-smoke/target/debug/wenlan-app
[first-run] skipping LaunchAgent install from non-stable app path: /Users/lucian/Repos/wenlan-app/.worktrees/wenlan-app-launch-smoke/target/debug/wenlan-app
```

Process evidence while the app was running:

```text
64133 node ... pnpm.mjs tauri dev
64186 node ... @tauri-apps/cli/tauri.js dev
64385 node ... vite/bin/vite.js
64887 /Users/lucian/Repos/wenlan-app/.worktrees/wenlan-app-launch-smoke/target/debug/wenlan-app
```

macOS accessibility evidence:

```text
process "wenlan-app" -> visible=true, window="Wenlan", count=1
Dock item -> wenlan-app, application dock item, AXDockItem, AXApplicationDockItem
```

CoreGraphics window evidence:

```text
owner=wenlan-app
pid=64887
title=Wenlan
window_id=29795
bounds=1280x720 at 224,199
onscreen=1
```

Window-ID screenshot evidence:

```text
/private/tmp/wenlan-app-windowid-2026-06-28.png
```

The screenshot shows the Tauri desktop app rendered with daemon-backed data: Home selected, profile/sidebar loaded, Worth-a-glance proposals, recent refining entries, and library counts.

The generic desktop screenshots taken before window-ID capture are intentionally not used as proof because they captured another foreground app.

## Non-Fatal Warnings

Observed during `pnpm tauri dev`:

```text
[TAURI_MCP] WARNING: No auth token configured. Socket server is unauthenticated.
[first-run] skipping LaunchAgent install from non-stable app path: .../target/debug/wenlan-app
update endpoint did not respond / update check failed
```

These did not block app render, daemon-backed data loading, Dock presence, or window creation. The LaunchAgent skip is expected for worktree debug binaries.

## Verification Commands

Run before opening or merging the checkpoint PR:

```bash
bash -n scripts/prepare-sidecars.sh
bash scripts/prepare-sidecars.sh --print-paths
pnpm vitest run scripts/prepare-sidecars.test.ts src/runtimeIdentity.test.ts
pnpm build
git diff --check
```

Optional wider gates if this checkpoint is batched with more app code:

```bash
cargo build --manifest-path app/Cargo.toml
cargo test --manifest-path app/Cargo.toml --lib
pnpm test
```

Known residual risk: `package.json` still has a `dev:daemon` script with an older `../..` backend default. This checkpoint fixes the sidecar prep path used by app build/launch packaging; `dev:daemon` should be folded into the same resolver in a separate dev-script cleanup.

## Next Gate

After this PR, continue the migration with a larger parity slice, not another palette/runtime-only pass:

1. daemon API parity wrappers still missing or stale
2. stale taxonomy/product copy cleanup after API parity is stable
3. bundle/updater/release identity migration as a separate one-way-door plan
4. relay/domain migration only after a Wenlan relay target exists

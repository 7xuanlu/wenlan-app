# Wenlan App Migration Goal Context

- **Date:** 2026-06-26
- **App repo:** `/Users/lucian/Repos/wenlan-app`
- **Active worktree:** `/Users/lucian/Repos/wenlan-app/.worktrees/wenlan-app-convergence`
- **Branch:** `codex/wenlan-app-convergence`
- **Remote:** `https://github.com/7xuanlu/wenlan-app.git`
- **Backend source of truth:** `/Users/lucian/Repos/wenlan`

## Goal

Drive the old `origin-app` codebase to `wenlan-app` end to end. This is not a shallow rename. The app must keep up with current Wenlan daemon/API behavior while preserving bridge compatibility for users who still have Origin-era app paths, LaunchAgents, MCP config, token paths, and data.

## Current Evidence

The active app worktree is the renamed `wenlan-app` worktree, not the backend monorepo worktree.

Current runtime baseline:

```text
GET /api/health -> {"status":"ok","db_initialized":true,"version":"0.9.1"}
GET /api/status -> {"is_running":true,"files_indexed":8925,"files_total":0,"sources_connected":[],"reranker":{"state":"disabled"},"reranker_light":{"state":"disabled"},"reranker_mode":"off"}
```

The rebuilt debug app bundle launches from:

```text
/Users/lucian/Repos/wenlan-app/.worktrees/wenlan-app-convergence/target/debug/bundle/macos/Origin.app
```

Current live process evidence:

```text
PID 45700
```

The bundle is still named `Origin.app`; product/runtime rename remains a future migration step. Do not treat this as a failed repo rename.

Current structural inventory from `bash scripts/refactor/inventory.sh`:

| Surface | Count |
|---|---:|
| frontend `invoke(...)` calls | 123 |
| registered Tauri commands | 167 |
| Rust `origin_types` references | 0 |
| runtime identity references | 222 |
| stale taxonomy references | 239 |
| source files under `app/src` and `src` | 151 |

Current build evidence:

```text
cargo build -> Finished `dev` profile [unoptimized + debuginfo]
cargo test -p origin-app --lib -> 111 passed
pnpm build -> passed, with existing Vite chunk/dynamic-import warnings
pnpm test -> 329 passed, 1 skipped
GET /api/setup/status -> {"setup_completed":true,"mode":"basic-memory","anthropic_key_configured":false,"local_model_selected":null,"local_model_loaded":null,"local_model_cached":false}
```

Tauri debug bundle generation reaches a built `.app`, then exits at updater signing when `TAURI_SIGNING_PRIVATE_KEY` is unset. That is expected local debug behavior unless signing secrets are present.

## Completed Migration Base

Already landed in this branch history:

| Area | Evidence |
|---|---|
| typed app client | `wenlan-types = "0.9.1"`, `WenlanClient`, `origin_types` residual count 0 |
| sidecar bridge | `wenlan-server` and `wenlan-mcp` external bins, `scripts/prepare-sidecars.sh`, direct `cargo build` passes |
| MCP config bridge | writes `wenlan`, detects and preserves legacy `origin` |
| stable app path bridge | accepts current `Wenlan.app` paths and legacy `Origin.app` paths |
| Dock visibility | app activation policy is regular; debug app shows as an app process |
| migrated avatar path | avatar loader handles migrated paths |
| revision signal bridge | `StoreMemoryResponse` preserves `triggered_revisions` and `auto_superseded`; revision/contradiction mutation wrappers return typed daemon responses; `listPendingRevisions` wraps `/api/memory/pending-revisions` |
| neutral theme baseline | failed palette experiment replaced with conservative graphite-gray tokens; revisit visual design later |
| pending revision Home review lane | `listPendingRevisions` feeds Worth-a-glance cards; Accept/Dismiss call typed daemon wrappers and invalidate relevant caches |
| setup status bridge | `getSetupStatus` wraps `/api/setup/status`; wizard gating and completion now use daemon-backed setup state instead of app-local config writes |

## Tool Boundaries

Use tools in this order for cross-cutting edits:

| Tool | Use for | Boundary |
|---|---|---|
| CodeGraph | symbol orientation, impact, affected-test hints | advisory only; not a proof oracle |
| ast-grep | repeatable syntax inventory and codemod surfaces | structural, not semantic |
| LSP/compiler | imports, types, signatures, semantic breakage | cannot prove product parity |
| tests/builds | behavior evidence for edited slices | cannot discover full migration scope |
| `rg` | residual checks and allowlists | use after graph/structural scope is known |
| `grep` | last-resort bounded fallback | only if stronger lanes are unavailable |

Current practical state:

- `rust-analyzer` is on `PATH`.
- `codegraph`, `ast-grep`, and `sg` are not globally on `PATH`.
- CodeGraph was validated through `npx -y @colbymchenry/codegraph` earlier, but later sandbox/network paths sometimes blocked or stalled. Each cross-cutting task must attempt a target-specific CodeGraph probe or record why it was unavailable.
- ast-grep is available through `npx -y -p @ast-grep/cli sg`; the inventory harness uses that lane.

## Next Refactor Slices

### Slice B1: Daemon/API Parity Review Surface

Goal: make the app catch up to current Wenlan review/status/setup surfaces before public product rename.

Current daemon/API parity gaps from read-only subagent exploration:

| Gap | Priority | Action |
|---|---|---|
| setup/config source of truth is split | P0 | setup status and wizard completion now use daemon `setup_status`/`update_config`; remaining work is converging Settings/local toggles to daemon config or explicitly app-local sensors |
| store/revision signals need UI surfacing | P0 | Rust and TypeScript wrappers now preserve `triggered_revisions` and `auto_superseded`; Home now surfaces pending revisions; post-store notification surfacing still remains |
| revision/contradiction accept/dismiss need consumer handling | P0 | wrappers return typed daemon responses; pending-revision Accept/Dismiss now consumes them through Home cache invalidation |
| pending revisions need central UI | P0 | Home Worth-a-glance now lists pending revisions with Accept/Dismiss; expand later only if volume requires a dedicated review screen |
| memory taxonomy is stale | P1 | remove first-class `goal`, add `lesson`/`gotcha`, and update colors, stability tiers, fixtures, and reclassification options |
| page links/revisions/refinery are under-wrapped | P1 | add `getPageLinks`, `listOrphanLinks`, `getPageRevisions`, `getMemoryRevisions`, and refinery queue accept/reject wrappers; move `PageDetail` related links to `/api/pages/{id}/links` |
| source registry still mutates local config | P1 | route add/list/remove through `/api/sources`; keep sync as daemon proxy |
| frontend status shape is stale | P1 | add a daemon `getStatus` wrapper and surface reranker disabled/failed/active state in operator status UI |

Pre-edit structural probes:

```bash
CODEGRAPH_TELEMETRY=0 DO_NOT_TRACK=1 npx -y @colbymchenry/codegraph sync .
CODEGRAPH_TELEMETRY=0 DO_NOT_TRACK=1 npx -y @colbymchenry/codegraph query WenlanClient --json
CODEGRAPH_TELEMETRY=0 DO_NOT_TRACK=1 npx -y @colbymchenry/codegraph impact WenlanClient --json
npx -y -p @ast-grep/cli sg outline app/src/api.rs
npx -y -p @ast-grep/cli sg outline app/src/search.rs
npx -y -p @ast-grep/cli sg run -p 'invoke($CMD, $$$ARGS)' -l ts src
rg -n 'serde_json::Value|pending-revisions|refinery/queue|setup/status|enrichment-status|StatusResponse' app/src src
```

Required verification:

```bash
pnpm build
cargo build
cargo test -p origin-app --lib
pnpm vitest run <targeted UI tests>
curl -s http://127.0.0.1:7878/api/health
curl -s http://127.0.0.1:7878/api/status
```

### Slice B2: Runtime Identity Classification

Goal: decide which remaining Origin references are bridge state and which are real rename work.

Current classification from read-only subagent exploration:

| Residual group | Classification | Action |
|---|---|---|
| app bundle/product identity (`productName`, bundle id, crate/package/executable) | migrate later | cut over as one coordinated product/runtime identity migration |
| low-risk visible Origin labels/docs/menu text | migrate now | rename when not part of compatibility behavior |
| backend sidecars | already migrated | keep `wenlan`, `wenlan-server`, `wenlan-mcp` sidecar strategy |
| server LaunchAgent bridge | keep legacy bridge | keep cleanup/detection for `com.origin.server` |
| app LaunchAgent identity | investigate | decide whether app LaunchAgent follows old bundle id or new brand; if migrating, add old-plist cleanup |
| app config/data root | migrate now | prefer `WENLAN_DATA_DIR`, fallback to `ORIGIN_DATA_DIR`, default to `wenlan`, keep legacy read/import |
| app log paths | migrate now | move app logs to Wenlan naming or document explicitly as legacy |
| local MCP config bridge | keep legacy bridge | keep writing `wenlan` and preserving old `origin` entries |
| remote MCP token/config path | migrate now | prefer `~/.config/wenlan-mcp`, import/fallback from `~/.config/origin-mcp` |
| relay URL/domain | investigate | do not blind-rename until a Wenlan relay is provisioned and existing relay ids have a migration strategy |
| confusing comments/tests | migrate now | leave only comments that explicitly say "legacy Origin bridge" |

Rule: do not delete old state automatically. Detect, preserve, and migrate through an explicit bridge release.

Recommended order:

1. Fix app config/data/env first: align app config and daemon URL helpers with `WENLAN_*` plus legacy fallback.
2. Migrate remote token path to `~/.config/wenlan-mcp` with import fallback from `origin-mcp`.
3. Rename low-risk UI/docs/comments/tests from Origin to Wenlan.
4. Open a separate bundle-identity plan for product name, bundle id, executable/crate name, updater endpoint, app LaunchAgent label, and DMG naming.
5. Investigate relay migration before changing `origin-relay.originmemory.workers.dev`.

### Slice B3: Taxonomy and Product Copy

Goal: remove stale user-facing Origin taxonomy only after API parity is stable.

Candidate scope:

- first-class `goal` memory type in UI.
- visible `concept` copy where the daemon now models pages/wiki surfaces.
- visible `domain` copy where spaces/pages are the correct product language.
- product copy still saying Origin in setup, updater, README, tests, and UI.

## Boule Review Handoff

Use this prompt after the next design/spec draft is ready:

```text
/boule:debate Review the Wenlan app migration design. The target is a large origin-app to wenlan-app convergence, not a shallow rename. Evaluate the plan on the merits: daemon/API parity with Wenlan v0.9.x, typed-client correctness, bridge compatibility for Origin-era user state, runtime identity rename sequencing, structural-tool boundaries, and verification gates. Do not force optimism or pessimism. Identify missing requirements, false dependencies, unsafe ordering, insufficient tests, and any places where the plan could silently strand user data or config.
```

## Do Not Do Yet

- Do not globally replace `Origin` with `Wenlan`.
- Do not remove old MCP config, token, relay id, LaunchAgent, app path, or data path state.
- Do not use color/palette exploration as a blocker for the migration.
- Do not treat CodeGraph output as completion evidence.
- Do not mark the overall goal complete until the app product/runtime identity, parity surfaces, bridge behavior, and Tauri launch against the v0.9 daemon are all verified together.

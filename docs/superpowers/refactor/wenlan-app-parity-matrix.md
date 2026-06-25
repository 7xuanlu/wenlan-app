# Wenlan App Parity and Compatibility Matrix

- **Date:** 2026-06-25
- **App worktree:** `/Users/lucian/Repos/wenlan/.worktrees/origin-app-wenlan-app-convergence`
- **App branch:** `codex/wenlan-app-convergence`
- **Wenlan backend source:** `/Users/lucian/Repos/wenlan`
- **Purpose:** prerequisite matrix before the full `origin-app` -> `wenlan-app` refactor run.

## Evidence Snapshot

| Evidence | Current value | Source |
|---|---:|---|
| Frontend `invoke(...)` calls | 136 | `docs/superpowers/refactor/wenlan-app-inventory/frontend-invokes.txt` |
| Registered Tauri commands | 165 | `app/src/lib.rs` + `search-rs-outline.txt` |
| Rust `origin_types` references | 49 | `app/src` residual scan |
| Runtime identity references | 282 | `Origin`/`origin-server`/`origin-mcp`/`com.origin`/relay residual scan |
| Stale taxonomy references | 231 | `concept`/`goal`/`domain` residual scan |
| Wenlan typed request/response declarations in `requests.rs` + `responses.rs` | 99 | `wenlan-types` scan |

## Compatibility Gates

| Gate | Required before | Check | Fallback behavior |
|---|---|---|---|
| Daemon reachability | Any app UI data load | `GET /api/health` typed as `HealthResponse` | show daemon-offline state; do not assume local DB access |
| Daemon capability set | P0 feature UI | `GET /api/status` plus route probes for optional surfaces | hide unsupported panels; show "requires newer daemon" diagnostics |
| Typed wire contract | API wrapper migration | `wenlan-types` dependency and serde smoke tests for critical envelopes | app-local DTO allowed only for Tauri-local or missing shared types |
| Sidecar availability | `cargo build`/Tauri bundle | target-specific `wenlan-server`, `wenlan-mcp`, and `cloudflared` sidecars present | fail loud with migration instructions; do not hand-copy ad hoc binaries |
| Origin bridge detection | Runtime identity rename | old LaunchAgents, app paths, MCP config keys, token/relay ids detected | preserve old state for bridge release; do not silently open empty Wenlan state |

## P0 Matrix

These block "caught up enough for full refactor run".

| Surface | Current source | App status | Action | Daemon compatibility |
|---|---|---|---|---|
| `/api/health` | `wenlan-server/src/router.rs`; `HealthResponse` | present in `OriginClient.health`; stale naming | rename to `WenlanClient.health`; keep typed response | required; app cannot proceed without daemon |
| `/api/status` | `StatusResponse`, `RerankerStatus` | missing user-facing status diagnostics | add typed wrapper and settings/diagnostics surface | required for capability gate; tolerate absent fields by feature-gating |
| `/api/refinery/queue` | `ListRefinementsResponse` | missing wrapper and UI | add central review queue | require route for review queue; hide panel if absent |
| `/api/refinery/queue/{id}/accept` | `AcceptRefinementResponse` | missing wrapper and UI | add accept action with typed response | optional until queue route exists |
| `/api/refinery/queue/{id}/reject` | `RejectRefinementResponse` | missing wrapper and UI | add reject action with typed response | optional until queue route exists |
| `/api/memory/pending-revisions` | daemon route | missing list wrapper/UI | add central pending revision list | require for P0 review surface; hide list if absent |
| `/api/memory/pending-revision/{source_id}` | daemon route | present as per-memory `getPendingRevision` | keep but type through `wenlan-types` if available | optional detail route |
| `/api/memory/revision/{id}/accept` | `RevisionAcceptResponse` | present command accepts `sourceId`; response is `serde_json::Value` | confirm path parameter semantics, rename argument if revision id, type response | require typed response before review UI |
| `/api/memory/revision/{id}/dismiss` | `RevisionDismissResponse` | present command accepts `sourceId`; response is `serde_json::Value` | confirm path parameter semantics, rename argument if revision id, type response | require typed response before review UI |
| `/api/memory/contradiction/{source_id}/dismiss` | `ContradictionDismissResponse` | present command, untyped response | type response and surface in review queue | optional if contradictions route absent |
| `/api/memory/{source_id}/enrichment-status` | `EnrichmentStatusResponse` | missing direct wrapper; store response has partial enrichment string | add typed direct status wrapper and post-store polling/invalidation | optional per-memory route; show unknown state if absent |
| `/api/sources` | daemon source routes | present via local `RegisteredSource`/`SyncStats` DTOs | converge DTOs with current daemon/source types, keep source registry daemon-owned | required for source management |
| `/api/config` | `ConfigResponse`, `UpdateConfigRequest` | partial Rust wrapper; `origin_types` 0.3 comments mention local builder | switch to `wenlan-types`; remove stale local builder when shared defaults exist | required for settings |
| `/api/setup/status` | daemon setup route | missing explicit wrapper/UI | add typed setup status; use for setup wizard instead of local-only inference | required for setup correctness |
| MCP config bridge | `app/src/mcp_config.rs`, setup wizard | Origin key/package only | write `wenlan`, detect `origin`, do not delete user-authored `origin` | bridge release required |
| Remote access bridge | `app/src/remote_access.rs` | Origin relay URL and `~/.config/origin-mcp` token/relay id | preserve old token/relay id; define relay endpoint strategy before URL rename | bridge release required |
| Sidecar build contract | `app/tauri.conf.json`, `package.json` | stale `origin-server`/`origin-mcp`; `cargo build` fails missing sidecar | define `wenlan-server`/`wenlan-mcp` sidecar source and build/copy flow | required before build verification |

## P1 Matrix

These are required for feature parity but can follow the P0 review/status/setup surfaces.

| Surface | Current source | App status | Action | Daemon compatibility |
|---|---|---|---|---|
| `/api/memory/{id}/revisions` | `ListMemoryRevisionsResponse` | missing; app has older `/versions` chain wrapper | add typed memory revision history panel | hide revisions panel if route absent |
| `/api/pages/{id}/revisions` | `ListPageRevisionsResponse` | missing | add typed page revision panel | hide revisions panel if route absent |
| `/api/pages/{id}/links` | `PageLinksResponse` | missing wrapper/UI | add page detail inbound/outbound link affordance | hide links section if route absent |
| `/api/pages/orphan-links` | `OrphanLinksResponse` | missing wrapper/UI | add orphan link review or diagnostics section | optional diagnostics until route exists |
| `/api/pages/{id}/sources` | `PageSourceWithMemory` | present via `getPageSources` | keep and type through `wenlan-types` | optional |
| `/api/pages/export` | export response | present as `exportPagesToObsidian` | keep; rename "concept" UI/file wording where user-facing | optional |
| `/api/pages/{id}/export` | export response | present as `exportPageToObsidian` | keep; rename "concept" UI/file wording where user-facing | optional |
| `/api/on-device-model` | config route | present wrapper | keep; type through `wenlan-types` | optional settings section |
| `/api/llm/test` | config route | present wrapper | keep; type through `wenlan-types` | optional settings section |

## Taxonomy Matrix

| Surface | Current app state | Required action | Gate |
|---|---|---|---|
| `goal` memory type | first-class TypeScript union, facet, profile section, import examples | remove first-class type from UI; legacy imports may map to identity/fact per daemon semantics | no visible first-class `Goal` controls before feature catch-up |
| `concept` copy | deprecated aliases plus visible component/test copy | migrate user-facing copy to Page/wiki wording; keep aliases only as compatibility wrappers | residual scan allowlist required |
| `domain` copy | entity/memory/page filters and decision route copy | map user-facing wording to spaces where semantically correct; keep daemon back-compat field names | residual scan allowlist required |
| `Origin` app copy | setup, updater, tests, README, runtime names | replace only after typed API and bridge are green | public identity rename gate |

## Runtime Identity Matrix

| Surface | Current app state | Required action | Gate |
|---|---|---|---|
| Bundle id | `com.origin.desktop` | new installs use `com.wenlan.desktop`; old app state detected | Phase E only |
| LaunchAgents | `com.origin.desktop`, `com.origin.server` | detect/unload/tombstone old labels; install Wenlan labels | sidecar and data bridge tests |
| Stable app path | `Origin.app` only | accept `/Applications/Wenlan.app` and `~/Applications/Wenlan.app`; detect old `Origin.app` | lifecycle tests |
| Daemon sidecar | `origin-server` | use `wenlan-server`; stop `cargo build -p origin-server` assumption | `cargo build` reaches app code |
| MCP sidecar | `origin-mcp` | use `wenlan-mcp`; bridge old config key/package | setup wizard tests |
| Remote relay | `origin-relay.originmemory.workers.dev` | explicit endpoint and stable URL strategy | remote access tests |
| Data/config paths | Origin paths | do not open fresh Wenlan path if legacy data exists | migration smoke |

## Go/No-Go Before Full Refactor Run

Go when all are true:

- This matrix is committed.
- `bash scripts/refactor/inventory.sh` runs and generated summary is current.
- `pnpm install --frozen-lockfile --offline` exits 0.
- `pnpm test` exits 0.
- The known `cargo build` sidecar failure is either still documented as the next Task 5 prerequisite or fixed with a tested sidecar strategy.
- Task 4 typed-client work has not started in the same commit as parity/matrix work.

No-go:

- Starting public `Origin` -> `Wenlan` rename before typed client and sidecar bridge.
- Replacing text with `rg` globally before AST inventory surfaces are classified.
- Removing old MCP config or token paths automatically.
- Hand-copying sidecar binaries to make `cargo build` pass without a repeatable build/copy contract.

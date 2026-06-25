# Wenlan App Refactor Tooling Preflight

- **Date:** 2026-06-25
- **Worktree:** `/Users/lucian/Repos/wenlan/.worktrees/origin-app-wenlan-app-convergence`
- **Branch:** `codex/wenlan-app-convergence`
- **Base:** `af618e5 frontend: align activity strings + CSS var with daemon page rename`
- **Purpose:** establish repeatable structural search and baseline checks before API/identity refactor edits.

## Baseline

Frontend setup is repeatable:

```bash
pnpm install --frozen-lockfile --offline
pnpm test
```

Observed frontend result:

```text
Test Files 35 passed (35)
Tests 319 passed | 1 skipped (320)
```

Rust build currently fails before app code compiles because the Tauri sidecar contract is stale:

```text
resource path `binaries/origin-server-aarch64-apple-darwin` doesn't exist
```

Evidence:

- `app/tauri.conf.json` still declares `externalBin` entries for `binaries/origin-server`, `binaries/origin-mcp`, and `binaries/cloudflared`.
- `package.json` still tries `cargo build -p origin-server`, but this repo's Cargo workspace only contains `app`.
- This is a pre-existing setup drift and a required migration item, not a reason to hand-copy a local binary before the refactor.

## Structural Tools

`ast-grep` is available through:

```bash
npx -y -p @ast-grep/cli sg --version
```

Verified version:

```text
ast-grep 0.44.0
```

The reusable inventory command is:

```bash
bash scripts/refactor/inventory.sh
```

It writes:

- `docs/superpowers/refactor/wenlan-app-inventory/summary.md`
- `docs/superpowers/refactor/wenlan-app-inventory/tauri-ts-outline.txt`
- `docs/superpowers/refactor/wenlan-app-inventory/api-rs-outline.txt`
- `docs/superpowers/refactor/wenlan-app-inventory/search-rs-outline.txt`
- `docs/superpowers/refactor/wenlan-app-inventory/frontend-invokes.txt`
- `docs/superpowers/refactor/wenlan-app-inventory/rust-structs.txt`

## Initial Inventory Counts

From the preflight scan:

| Surface | Count | Meaning |
|---|---:|---|
| `src/lib/tauri.ts` `invoke(...)` calls | 136 | frontend-to-Tauri wrapper surface |
| `app/src/lib.rs` registered `search::...` commands | 165 | Rust command registration surface |
| Rust `origin_types` references | 49 | typed contract migration surface |
| runtime identity references | 282 | package/service/MCP/remote/app-name migration surface |
| stale taxonomy references | 231 | `concept`/`goal`/`domain` review surface |
| source files under `app/src` and `src` | 147 | working code surface size |

## Refactor Optimizer Rules

Use structural search first, then text search:

1. Use `sg outline` to map exported TypeScript wrappers, Rust client methods, and Rust Tauri commands.
2. Use `sg run -p 'invoke($CMD, $$$ARGS)' -l ts src` to inventory frontend command calls.
3. Use `sg run -p 'pub struct $NAME { $$$FIELDS }' -l rs app/src` to find local DTO shadows before replacing them with `wenlan-types`.
4. Use `rg` residual checks only after structural surfaces are mapped.
5. Keep the first refactor steps contract-only: no shell redesign, no visual rewrite, no public rename before typed API and compatibility gates are in place.

## Known Hotspots

- `src/lib/tauri.ts`: public frontend wrapper and many local TypeScript DTO shadows.
- `app/src/api.rs`: `OriginClient`, `origin_types`, and daemon HTTP helper methods.
- `app/src/search.rs`: Tauri command implementations and many app-local request/response DTOs.
- `app/src/lib.rs`: sidecar spawn and command registration.
- `app/src/lifecycle.rs`: LaunchAgent labels, stable app path validation, sidecar install/uninstall.
- `app/src/remote_access.rs`: Origin relay URL, token/relay-id paths, port-only orphan cleanup.
- `app/src/mcp_config.rs` and `src/components/SetupWizard.tsx`: MCP key/package naming and compatibility bridge.
- `app/tauri.conf.json`, `app/capabilities/default.json`, `package.json`: public/runtime identity and sidecar names.

## Stop Conditions

- Do not start typed API edits until `scripts/refactor/inventory.sh` runs and its summary is committed or intentionally regenerated.
- Do not start public identity rename until the sidecar contract has a tested `wenlan-server`/`wenlan-mcp` path and Origin bridge behavior.
- Do not delete old MCP config entries automatically; migration UI must detect and report both old and new keys.

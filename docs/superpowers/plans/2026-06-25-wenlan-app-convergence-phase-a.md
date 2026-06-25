# Wenlan App Convergence Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare `origin-app` for the Wenlan convergence refactor with repeatable structural inventory, baseline checks, and finite Phase A/B gates before changing behavior.

**Architecture:** Keep the app as a thin Tauri client. Use `wenlan-server` and `wenlan-types` as the source of truth, but first map the app's current Tauri command, HTTP wrapper, local DTO, sidecar, and identity surfaces with `ast-grep` and residual checks.

**Tech Stack:** Tauri 2, Rust, React 19, TypeScript, pnpm, Cargo, ast-grep via `npx -p @ast-grep/cli`.

---

### Task 1: Lock Baseline Dependency Setup

**Files:**
- Create: `pnpm-workspace.yaml`
- Verify: `package.json`

- [ ] **Step 1: Keep pnpm build approval explicit**

```yaml
allowBuilds:
  esbuild: true
```

- [ ] **Step 2: Verify offline install**

Run:

```bash
pnpm install --frozen-lockfile --offline
```

Expected: exits 0 and does not print `ERR_PNPM_IGNORED_BUILDS`.

- [ ] **Step 3: Verify frontend baseline**

Run:

```bash
pnpm test
```

Expected: `35 passed`, `319 passed`, `1 skipped`.

- [ ] **Step 4: Record Rust sidecar baseline failure**

Run:

```bash
cargo build
```

Expected for this baseline phase: failure with:

```text
resource path `binaries/origin-server-aarch64-apple-darwin` doesn't exist
```

This failure is tracked as a migration prerequisite, not fixed by hand-copying binaries.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml
git commit -m "chore: make pnpm build approval explicit"
```

### Task 2: Add Structural Inventory Harness

**Files:**
- Create: `scripts/refactor/inventory.sh`
- Create: `docs/superpowers/refactor/2026-06-25-wenlan-app-tooling.md`
- Generated: `docs/superpowers/refactor/wenlan-app-inventory/summary.md`

- [ ] **Step 1: Add the inventory script**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
OUT="$ROOT/docs/superpowers/refactor/wenlan-app-inventory"
SG=(npx -y -p @ast-grep/cli sg)

mkdir -p "$OUT"

"${SG[@]}" outline "$ROOT/src/lib/tauri.ts" > "$OUT/tauri-ts-outline.txt"
"${SG[@]}" outline "$ROOT/app/src/api.rs" > "$OUT/api-rs-outline.txt"
"${SG[@]}" outline "$ROOT/app/src/search.rs" > "$OUT/search-rs-outline.txt"
"${SG[@]}" run -p 'invoke($CMD, $$$ARGS)' -l ts "$ROOT/src" > "$OUT/frontend-invokes.txt"
"${SG[@]}" run -p 'pub struct $NAME { $$$FIELDS }' -l rs "$ROOT/app/src" > "$OUT/rust-structs.txt"
```

- [ ] **Step 2: Make it executable**

Run:

```bash
chmod +x scripts/refactor/inventory.sh
```

- [ ] **Step 3: Generate the inventory**

Run:

```bash
bash scripts/refactor/inventory.sh
```

Expected: `Inventory written to .../docs/superpowers/refactor/wenlan-app-inventory`.

- [ ] **Step 4: Verify key counts in the generated summary**

Run:

```bash
sed -n '1,80p' docs/superpowers/refactor/wenlan-app-inventory/summary.md
```

Expected counts are allowed to change only when the related surface is intentionally refactored.

- [ ] **Step 5: Commit**

```bash
git add scripts/refactor/inventory.sh docs/superpowers/refactor
git commit -m "chore: add wenlan app structural inventory"
```

### Task 3: Produce the Parity Matrix

**Files:**
- Create: `docs/superpowers/refactor/wenlan-app-parity-matrix.md`
- Read: `src/lib/tauri.ts`
- Read: `app/src/search.rs`
- Read: `app/src/api.rs`
- Read: `/Users/lucian/Repos/wenlan/crates/wenlan-server/src/router.rs`
- Read: `/Users/lucian/Repos/wenlan/crates/wenlan-types/src`

- [ ] **Step 1: Generate current app inventory**

Run:

```bash
bash scripts/refactor/inventory.sh
```

Expected: generated inventory files exist under `docs/superpowers/refactor/wenlan-app-inventory/`.

- [ ] **Step 2: Extract current Wenlan routes**

Run from `/Users/lucian/Repos/wenlan`:

```bash
rg -n 'route\(|nest\(' crates/wenlan-server/src/router.rs
```

Expected: route list includes refinement queue, page graph/orphans, pending revisions, enrichment status, sources/config, status/reranker, and page export.

- [ ] **Step 3: Extract current Wenlan wire responses**

Run from `/Users/lucian/Repos/wenlan`:

```bash
rg -n 'struct (RerankerStatus|StatusResponse|EnrichmentStatusResponse|PageLinksResponse|OrphanLinksResponse|ListMemoryRevisionsResponse|ListPageRevisionsResponse|ListRefinementsResponse|AcceptRefinementResponse|RejectRefinementResponse|RevisionAcceptResponse|RevisionDismissResponse|ContradictionDismissResponse)' crates/wenlan-types/src
```

Expected: every named response resolves to a concrete `wenlan-types` definition.

- [ ] **Step 4: Write matrix rows**

Create rows with these columns:

```markdown
| Surface | Current source | App status | Action | Daemon compatibility |
|---|---|---|---|---|
| `/api/refinery/queue` | `wenlan-server` route + `ListRefinementsResponse` | missing UI | add P0 review queue | require route, hide UI if absent |
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/refactor/wenlan-app-parity-matrix.md
git commit -m "docs: add wenlan app parity matrix"
```

### Task 4: Plan Typed Client Convergence

**Files:**
- Modify: `app/Cargo.toml`
- Modify: `app/src/api.rs`
- Modify: `app/src/state.rs`
- Modify: `app/src/search.rs`
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Write the failing Rust import check**

Run:

```bash
rg -n 'origin-types|origin_types|OriginClient' app/Cargo.toml app/src
```

Expected before implementation: matches exist in `app/Cargo.toml`, `app/src/api.rs`, `app/src/state.rs`, and `app/src/search.rs`.

- [ ] **Step 2: Replace the crate dependency**

Target dependency:

```toml
wenlan-types = "0.3.1"
```

Use the version required by the current daemon release. If the crate version differs, update this plan before editing code.

- [ ] **Step 3: Rename the client seam**

Target names:

```rust
pub struct WenlanClient {
    client: Client,
    base_url: String,
}
```

```rust
pub client: WenlanClient,
```

- [ ] **Step 4: Verify no stale typed imports remain**

Run:

```bash
rg -n 'origin-types|origin_types::|use origin_types|OriginClient' app/Cargo.toml app/src
```

Expected after implementation: only intentional compatibility comments or fixtures remain.

- [ ] **Step 5: Commit**

```bash
git add app/Cargo.toml app/src/api.rs app/src/state.rs app/src/search.rs src/lib/tauri.ts
git commit -m "refactor: converge app client on wenlan types"
```

### Task 5: Plan Sidecar Compatibility Before Public Rename

**Files:**
- Modify: `package.json`
- Modify: `app/tauri.conf.json`
- Modify: `app/capabilities/default.json`
- Modify: `app/src/lib.rs`
- Modify: `app/src/lifecycle.rs`

- [ ] **Step 1: Capture current failing sidecar contract**

Run:

```bash
cargo build
```

Expected before implementation:

```text
resource path `binaries/origin-server-aarch64-apple-darwin` doesn't exist
```

- [ ] **Step 2: Define sidecar names without public app rename**

Target rule:

```text
Use wenlan-server and wenlan-mcp sidecar binaries for new builds, while detecting old Origin launch agents and config during bridge releases.
```

- [ ] **Step 3: Add tests around stable app target validation**

Required cases:

```text
/Applications/Wenlan.app accepted
~/Applications/Wenlan.app accepted
/Applications/Origin.app detected as legacy migration state
random Downloads app path rejected
```

- [ ] **Step 4: Verify sidecar build reaches app code**

Run:

```bash
cargo build
```

Expected after implementation: no missing `binaries/origin-server-*` error.

- [ ] **Step 5: Commit**

```bash
git add package.json app/tauri.conf.json app/capabilities/default.json app/src/lib.rs app/src/lifecycle.rs
git commit -m "refactor: prepare wenlan sidecar compatibility"
```

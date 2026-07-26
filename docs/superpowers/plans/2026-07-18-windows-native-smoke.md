# Windows Native Smoke Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prove in a manual GitHub Actions `windows-2022` run that the release-profile native Wenlan Tauri executable starts an exact source-built Windows backend commit, completes visible zero-configuration onboarding, renders a uniquely stored backend memory in WebView2, and shuts down without an orphaned backend. The pinned backend release payload remains a separate pre-distribution gate.

**Architecture:** Keep one strict key/value sidecar lock and make the existing download seam target-aware. A small Node downloader handles platform mapping, checksum verification, extraction, and a staged manifest while the existing Bash entrypoint remains the Tauri hook. The native smoke records that locked payload as a release baseline, then deliberately replaces the backend files with binaries built from an exact post-release commit; its claim and validator must say `source-build`. A standalone WebdriverIO client drives `tauri-driver`; PowerShell gathers Windows process/module evidence; a pure Node validator owns machine-checkable positive controls. Product code changes stay limited to honest non-macOS lifecycle behavior revealed by the native build.

**Tech Stack:** Tauri 2, Rust stable, Node 20, pnpm 10.28.2, Vitest 4, WebdriverIO 9.29.1 standalone client, PowerShell/CIM, `tauri-driver` 2.0.6, `msedgedriver-tool` at commit `8c4b34f51b45f5cf08013366d703de464ab871d1`.

---

## Task 1: Make the sidecar lock strict and cross-platform

**Files:**

- Modify: `.wenlan-backend-version`
- Create: `scripts/sidecar-lock.mjs`
- Create: `scripts/download-sidecars.mjs`
- Modify: `scripts/prepare-sidecars.sh`
- Modify: `scripts/prepare-sidecars.test.ts`
- Create: `scripts/sidecar-lock.test.ts`

- [ ] **Step 1: Write RED lock and download tests**

Assert that the lock has exactly these keys and no duplicates or unknown keys:

```text
backend_tag
backend_darwin_arm64_sha256
backend_windows_x64_sha256
cloudflared_version
cloudflared_darwin_arm64_sha256
cloudflared_windows_x64_sha256
```

Test both target mappings:

```text
aarch64-apple-darwin
  backend: wenlan-darwin-arm64.tar.gz
  cloudflared: cloudflared-darwin-arm64.tgz
x86_64-pc-windows-msvc
  backend: wenlan-windows-x64.zip
  cloudflared: cloudflared-windows-amd64.exe
```

The Windows fixture must require `wenlan.exe`, `wenlan-server.exe`,
`wenlan-mcp.exe`, and `onnxruntime.dll`. Tests must fail on a corrupt backend
hash, corrupt cloudflared hash, missing DLL, missing lock key, and unsupported
target.

Run:

```bash
pnpm exec vitest run scripts/sidecar-lock.test.ts scripts/prepare-sidecars.test.ts
```

Expected: FAIL because the parser and Windows mapping do not exist.

- [ ] **Step 2: Implement the lock parser and target specification**

`scripts/sidecar-lock.mjs` exports:

```js
export const REQUIRED_SIDECAR_LOCK_KEYS
export function parseSidecarLock(text)
export function readSidecarLock(path)
export function sidecarSpecForTarget(lock, targetTriple)
```

It also supports:

```bash
node scripts/sidecar-lock.mjs get backend_tag
node scripts/sidecar-lock.mjs spec x86_64-pc-windows-msvc
```

The parser rejects malformed lines, duplicate/unknown/missing keys, non-64-hex
hashes, tags without `v`, and cloudflared versions containing path separators.

- [ ] **Step 3: Implement one target-aware downloader**

`scripts/download-sidecars.mjs` accepts:

```text
--target <triple>
--manifest <json-path>     optional
```

Target defaults to `TARGET_TRIPLE`, then `TAURI_ENV_TARGET_TRIPLE`, then
`rustc -vV` host. It downloads the backend from `7xuanlu/wenlan` and
cloudflared from `cloudflare/cloudflared` with `gh release download`, verifies
each archive/file with Node `crypto`, extracts through `tar -xf`, validates the
complete payload before copying anything, and atomically stages:

```text
app/binaries/wenlan-<triple>[.exe]
app/binaries/wenlan-server-<triple>[.exe]
app/binaries/wenlan-mcp-<triple>[.exe]
app/binaries/cloudflared-<triple>[.exe]
app/binaries/onnxruntime.dll       Windows only
```

When requested, the manifest records lock versions, source asset names and
verified hashes, destination paths, and hashes of every staged payload.
`prepare-sidecars.sh --download` delegates to this script without changing the
build-from-source path.

- [ ] **Step 4: Install the approved lock values and go GREEN**

Use:

```text
backend_tag=v0.13.0
backend_darwin_arm64_sha256=56473c3e19bd2327f139b6b623dc81bda056f085e701e7ba0e22f00d7c483158
backend_windows_x64_sha256=9ab795d00e067709297be57d47f48fc80662c85158ddfd453e8052d21a61573c
cloudflared_version=2026.7.2
cloudflared_darwin_arm64_sha256=2086e51c61d6565781d84117a5007d0c826d03ffdc74acb91c08c167f9f8cd7c
cloudflared_windows_x64_sha256=cdb5d4432f6ae1595654a692a51308b69d2bf7af961f5578d9391837cf072df9
```

Run the focused tests again and require PASS.

- [ ] **Step 5: Commit**

```bash
git add .wenlan-backend-version scripts/sidecar-lock.mjs scripts/download-sidecars.mjs scripts/prepare-sidecars.sh scripts/prepare-sidecars.test.ts scripts/sidecar-lock.test.ts
git commit -m "feat: stage pinned Windows sidecars"
```

## Task 2: Move every pin consumer and writer to the one lock

**Files:**

- Modify: `scripts/release-version-sync.test.ts`
- Create: `scripts/sidecar-lock-consumers.test.ts`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/backend-pin-bump.yml`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write RED consumer tests**

Require version sync to read `backend_tag`, reject the old two-line format, and
statically reject `releases/latest` cloudflared downloads or line-one pin reads
from all three workflows. Require the bump workflow to update both backend
hashes while preserving all cloudflared keys.

Run:

```bash
pnpm exec vitest run scripts/release-version-sync.test.ts scripts/sidecar-lock-consumers.test.ts
```

Expected: FAIL against the current workflow text.

- [ ] **Step 2: Update release and CI readers**

Use `node scripts/sidecar-lock.mjs get backend_tag` for version checks. Remove
the unpinned cloudflared `releases/latest` step from `release.yml`; the existing
Tauri before-build hook downloads both locked products. Keep the macOS download
smoke, but make it verify the strict manifest as well as execute the Darwin
backend.

- [ ] **Step 3: Update the automated backend pin writer**

The macOS bump job downloads both backend assets for one candidate tag,
computes their SHA-256 values, executes the Darwin payload smoke, and replaces
only:

```text
backend_tag
backend_darwin_arm64_sha256
backend_windows_x64_sha256
```

It must re-parse the resulting lock before committing and must leave all three
cloudflared fields byte-for-byte unchanged.

- [ ] **Step 4: Run focused and full script tests**

```bash
pnpm exec vitest run scripts/release-version-sync.test.ts scripts/sidecar-lock-consumers.test.ts scripts/sidecar-lock.test.ts scripts/prepare-sidecars.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/release-version-sync.test.ts scripts/sidecar-lock-consumers.test.ts .github/workflows/release.yml .github/workflows/backend-pin-bump.yml .github/workflows/ci.yml
git commit -m "ci: keep platform sidecars in one lock"
```

## Task 3: Make Windows lifecycle behavior explicit

**Files:**

- Modify: `app/src/lifecycle.rs`
- Modify: `app/src/search.rs`
- Modify only if the Windows build proves necessary: `app/Cargo.toml`
- Modify only if the Windows build proves necessary: `app/src/lib.rs`

- [ ] **Step 1: Write RED policy tests**

Extract a pure platform policy that maps `macos` to LaunchAgent management and
every other target to unsupported run-at-login. Assert that unsupported
platforms report disabled state and the exact error:

```text
Run at Login is not supported on this platform
```

Add a quit-plan test asserting plist cleanup belongs only to macOS while daemon
shutdown and app exit belong to every desktop target.

Run:

```bash
cargo test --manifest-path app/Cargo.toml lifecycle_command_tests lifecycle::tests -- --nocapture
```

Expected: FAIL until the platform policy is wired.

- [ ] **Step 2: Gate service-manager behavior, not shared sidecar startup**

On non-macOS:

- `is_run_at_login_enabled` returns `Ok(false)`.
- `set_run_at_login` returns the exact unsupported error without filesystem or
  process-manager writes.
- full quit skips all plist/`launchctl` cleanup, posts `/api/shutdown`, waits,
  and exits the app.

Do not rewrite the clean-start sidecar fallback unless the native Windows run
shows a concrete failure. Preserve the existing stable-target first-run guard.

- [ ] **Step 3: Compile the release target in the Windows workflow**

If and only if `tauri-plugin-mcp` fails Windows release compilation, gate both
its Cargo dependency and debug initialization to supported targets. Do not add
a smoke-only product feature.

- [ ] **Step 4: Run Rust gates**

```bash
cargo fmt --check --all
cargo test --manifest-path app/Cargo.toml --lib
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: PASS with compile-time sidecar placeholders locally.

- [ ] **Step 5: Commit**

```bash
git add app/src/lifecycle.rs app/src/search.rs app/Cargo.toml app/src/lib.rs
git commit -m "fix: make lifecycle commands portable"
```

## Task 4: Build a native evidence harness with positive controls

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `scripts/windows/native-smoke-evidence.mjs`
- Create: `scripts/windows/native-smoke-evidence.test.ts`
- Create: `scripts/windows/process-evidence.ps1`
- Create: `scripts/windows/native-smoke.mjs`

- [ ] **Step 1: Pin the light standalone client**

```bash
pnpm add -D webdriverio@9.29.1
```

Do not add the WebdriverIO test runner, Cucumber, Mocha, or an RDP dependency.

- [ ] **Step 2: Write RED evidence-validator tests**

`validateNativeSmokeEvidence(evidence, expected)` must reject fixtures with a
wrong backend PPID, wrong backend executable, wrong `onnxruntime.dll` module
path, wrong backend marker, missing UI marker, missing screenshot, or a backend
still alive after close. Include one complete passing fixture.

Run:

```bash
pnpm exec vitest run scripts/windows/native-smoke-evidence.test.ts
```

Expected: FAIL because the validator does not exist.

- [ ] **Step 3: Implement process and module collection**

`process-evidence.ps1` emits JSON from `Get-CimInstance Win32_Process` and
`Get-Process -Module`, including PID, PPID, executable path, command line, and
loaded module paths for the app and backend.

- [ ] **Step 4: Implement the standalone native flow**

`native-smoke.mjs` accepts:

```text
--app <release exe>
--evidence-dir <directory>
```

It must:

1. fail if `127.0.0.1:7878` is occupied;
2. copy the target-suffixed staged sidecars plus `onnxruntime.dll` next to the
   release executable under their runtime names;
3. open the native application through `tauri-driver`;
4. require the first-run welcome button and save `01-welcome.png`;
5. poll `/api/health`, then require app/backend PID, PPID, executable, and
   ONNX module assertions;
6. click visible `Get started`, then `Skip` on intelligence, import, and
   connect; wait for `[data-testid="task-status-daemon"]` to read `Running`;
   click `Continue`, then `Open Wenlan`, and save `02-app-ready.png`;
7. POST a unique `WINDOWS_SMOKE_<run-id>_<attempt>` marker to
   `/api/memory/store`, fetch `/api/memory/<source_id>/detail`, and assert the
   marker;
8. type the same marker into `[data-wenlan-search-input]`, open the matching
   visible result, require the marker in the memory dossier, and save
   `03-memory-visible.png`;
9. invoke the registered Tauri command `quit_wenlan_full`, then require both
   app and backend to disappear within 10 seconds before best-effort cleanup;
10. always write the result, logs, process snapshots, health response, staged
    manifest, and any screenshots already captured.

The validator, not screenshot existence alone, decides the final exit code.

- [ ] **Step 5: Run validator tests and frontend build**

```bash
pnpm exec vitest run scripts/windows/native-smoke-evidence.test.ts
pnpm build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml scripts/windows
git commit -m "test: add Windows native smoke harness"
```

## Task 5: Add the manual Windows Server 2022 proof workflow

**Files:**

- Create: `.github/workflows/windows-smoke.yml`
- Modify: `package.json`
- Create: `scripts/windows/workflow-contract.test.ts`

- [ ] **Step 1: Write a RED workflow contract test**

Require `workflow_dispatch`, `windows-2022`, release/no-bundle Tauri build,
strict Windows target, exact `tauri-driver` version, pinned
`msedgedriver-tool` revision, native harness invocation, and
`if: always()` evidence upload. Reject Playwright browser preview, RDP/tunnels,
release publication, signing, deployment, or merge steps.

- [ ] **Step 2: Implement `.github/workflows/windows-smoke.yml`**

The workflow:

1. is callable directly after it reaches the default branch and through the
   existing `ci.yml` manual dispatcher before merge;
2. checks out the branch and installs Node 20, pnpm, Rust stable, and Windows
   WebView2 build prerequisites;
3. installs `tauri-driver` 2.0.6 and `msedgedriver-tool` at
   `8c4b34f51b45f5cf08013366d703de464ab871d1`;
4. records Windows edition/build, runner image, WebView2 version, Edge driver
   version, Rust/Cargo versions, and the release profile/features;
5. sets `TARGET_TRIPLE=x86_64-pc-windows-msvc`,
   `WENLAN_DOWNLOAD_SIDECARS=1`, a fresh `WENLAN_DATA_DIR`, and
   `WENLAN_SIDECAR_MANIFEST`;
6. runs `pnpm tauri build --no-bundle --target x86_64-pc-windows-msvc`;
7. starts `tauri-driver` with the matching EdgeDriver (which it owns), runs
   `pnpm test:native:windows`, and retains their logs;
8. uploads `windows-native-smoke` on success or failure.

The workflow and `result.json` call the claim exactly:

```text
Windows Server 2022 native app with source-built backend smoke
```

- [ ] **Step 3: Run the workflow contract and YAML sanity checks**

```bash
pnpm exec vitest run scripts/windows/workflow-contract.test.ts
pnpm exec tsc -b
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/windows-smoke.yml package.json scripts/windows/workflow-contract.test.ts
git commit -m "ci: prove native Wenlan on Windows"
```

## Task 6: Verify locally, run live CI to green, and close review findings

**Files:**

- Modify: any owning file above only in response to a reproduced failure
- Evidence: GitHub Actions artifact `windows-native-smoke`

- [ ] **Step 1: Run the local gate**

```bash
pnpm exec vitest run scripts
pnpm test -- --maxWorkers=1
pnpm test:i18n
pnpm build
cargo fmt --check --all
cargo test --manifest-path app/Cargo.toml --lib
cargo clippy --workspace --all-targets -- -D warnings
```

Record the pre-existing full-suite concurrency flake separately; do not hide a
deterministic failure with retries.

- [ ] **Step 2: Run standard and adversarial Fable reviews**

Use `cc:review` and `cc:adversarial-review` against the complete diff. Resolve
every high-severity correctness, security, concurrency, evidence-integrity, or
data-loss finding. Re-run the owning tests after every fix.

- [ ] **Step 3: Push a normal branch and open a PR**

```bash
git push -u origin codex/windows-native-smoke
gh pr create --base main --head codex/windows-native-smoke
```

Do not merge, publish a release, sign, deploy, or force-push.

- [ ] **Step 4: Dispatch and inspect the manual workflow**

```bash
gh workflow run windows-smoke.yml --ref codex/windows-native-smoke
gh run list --workflow windows-smoke.yml --branch codex/windows-native-smoke
gh run view <run-id> --log-failed
```

For each failure, reproduce with the smallest owning test where possible, add a
RED regression, fix the product/harness at the correct seam, push normally, and
dispatch a new run. Continue until green.

- [ ] **Step 5: Audit the successful artifact**

Download the artifact and require:

```text
result.json
health.json
processes-before.json
processes-after-launch.json
processes-after-close.json
01-welcome.png
02-app-ready.png
03-memory-visible.png
webdriver.log
app.log
staged-sidecars.json
```

Open all three screenshots. Cross-check their marker against the backend
response and `result.json`; cross-check PID/PPID, executable and module paths;
confirm no fake `Library/LaunchAgents` path and no app/backend process after
full quit.

- [ ] **Step 6: Final verification-before-completion**

Re-run the local gate after the last live-CI fix, verify the PR head SHA equals
the successful run SHA, and report the successful GitHub run URL plus exact
artifact evidence. Completion requires no unresolved high Fable finding and a
green native run; browser preview is not substitute evidence.

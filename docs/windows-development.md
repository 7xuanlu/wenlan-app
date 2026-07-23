# Windows development and native smoke testing

This is the canonical Windows runbook for `wenlan-app`. It covers a source
build of the sibling `7xuanlu/wenlan` backend, a release-profile Tauri build,
and a native WebView2 smoke test. It records what was actually observed on a
physical Windows 11 machine while validating PR #96.

## What this proves

The native smoke proves that one release-profile `wenlan-app.exe`:

1. starts the exact source-built `wenlan-server.exe` as its child process;
2. reaches `/api/health` with an initialized database;
3. loads the staged `onnxruntime.dll`;
4. completes visible first-run onboarding in WebView2;
5. stores a unique memory and retrieves it with a vector-only semantic query;
6. renders that same marker in the native UI; and
7. accepts the full-quit command without leaving the app, backend, or test
   ports alive.

It does **not** prove installer behavior, code signing, updater metadata,
run-at-login integration, ARM64 Windows support, or general production support.
The harness currently hard-codes the CI claim
`Windows Server 2022 native app with source-built backend smoke`. A local
physical-Windows result must therefore be accompanied by separately captured
machine metadata; the claim string alone is not evidence of the operating
system that ran it.

## Verified physical-machine baseline

The 2026-07-22 validation used:

| Item | Verified value |
| --- | --- |
| Operating system | Windows 11 Home, version `10.0.26200`, build `26200`, x86_64 |
| CPU | Intel Core i7-11375H |
| GPUs present | NVIDIA GeForce RTX 3060 Laptop GPU and Intel Iris Xe |
| App revision | `e655fd28f70c6e253744cc2f1fbfc90185480fd9` (PR #96) |
| Backend revision | `c66f9d8e3e2edc991a540a89d3c5f60e2c109a99` |
| Node.js / pnpm | `24.14.0` / `10.28.2` |
| Rust | `rustc 1.95.0`, target `x86_64-pc-windows-msvc` |
| PowerShell | `7.6.3` |
| WebView2 / EdgeDriver | `150.0.4078.83` / `150.0.4078.83` |
| Tauri driver | `2.0.6` |
| ONNX Runtime | CPU package `onnxruntime-win-x64-1.23.2` |

The final native run recorded 33 passing assertions, no failed assertions, a
healthy `0.14.1+gc66f9d8e` backend, three native screenshots, and clean app and
backend exits. The built `wenlan-app.exe` SHA-256 was
`20A352D2039AA48120E83933D21D4E3820468A702CFC3A9B162BF48DAA67256A`.

## Current Windows GPU status

Windows can use a GPU in principle, but the current Wenlan v1 backend does not
compile one into the default Windows build.

The controlling source lives in the sibling repo:

- `../wenlan/crates/wenlan-core/Cargo.toml` selects Metal only for macOS and
  the sampler-only dependency for non-macOS targets;
- `../wenlan/crates/wenlan-core/src/engine.rs` converts missing GPU offload
  support into the CPU plan and `gpu_layers=0`; and
- `../wenlan/scripts/stage-onnxruntime-windows.ps1` pins the CPU Windows ONNX
  Runtime archive.

There are two relevant inference stacks:

- The on-device Qwen model uses `llama-cpp-2`. In the sibling `wenlan` repo,
  macOS enables `["metal", "sampler"]`, while every non-macOS target enables
  only `["sampler"]`. Without a CUDA or Vulkan backend,
  `supports_gpu_offload()` is false, the runtime selects `gpu_layers=0`, and
  Windows runs Qwen on `CPU (OpenMP)`.
- Embeddings use FastEmbed through ONNX Runtime. The Windows staging script
  deliberately downloads `onnxruntime-win-x64-1.23.2`, the CPU package, rather
  than a CUDA or DirectML package. Loading `onnxruntime.dll` proves the bundled
  runtime is used; it does not prove GPU execution.

The RTX 3060 machine therefore used CPU/OpenMP even though an NVIDIA GPU was
present. The Qwen hardware probe passed twice, with inference taking about
11.2 seconds in that focused probe.

Adding Windows GPU support belongs in `7xuanlu/wenlan`, not the Tauri shell. A
safe follow-up needs opt-in CUDA and/or Vulkan Cargo features, corresponding
llama.cpp build prerequisites, distributable runtime libraries, CI compile
coverage, and physical-device probes with an explicit CPU fallback. Merely
changing `gpu_layers` would request a backend that was never compiled.

## Prerequisites

Install the following before building:

- Git for Windows, including Git Bash;
- Node.js 24 and pnpm 10.28.2;
- Rust 1.95.0 with the `x86_64-pc-windows-msvc` target;
- Visual Studio Build Tools with the C++ desktop workload and Windows SDK;
- CMake and Ninja;
- PowerShell 7 (`pwsh`);
- vcpkg with `sqlite3:x64-windows-static-md`;
- LLVM/libclang;
- a full Strawberry Perl distribution; and
- the Evergreen WebView2 Runtime.

The backend source build reached OpenSSL's Perl scripts. Git for Windows'
minimal Perl is insufficient because it lacks modules such as
`Locale::Maketext::Simple`; place Strawberry Perl before Git's Perl in
`PATH`.

Open PowerShell from an x64 Visual Studio developer shell, or import the
environment first:

```powershell
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vsRoot = & $vswhere -latest -products * `
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
  -property installationPath
$vsDevCmd = Join-Path $vsRoot "Common7\Tools\VsDevCmd.bat"

cmd /s /c "`"$vsDevCmd`" -arch=x64 -host_arch=x64 && set" |
  ForEach-Object {
    if ($_ -match "^([^=]+)=(.*)$") {
      Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
    }
  }
```

Install and expose the pinned toolchain:

```powershell
rustup toolchain install 1.95.0 --profile minimal `
  --target x86_64-pc-windows-msvc
$env:RUSTUP_TOOLCHAIN = "1.95.0"

vcpkg install sqlite3:x64-windows-static-md
$env:LIB = "$env:VCPKG_INSTALLATION_ROOT\installed\x64-windows-static-md\lib;$env:LIB"

# Point this at the directory containing libclang.dll.
$env:LIBCLANG_PATH = "C:\path\to\LLVM\bin"
```

## Checkouts and shell behavior

Keep the app and backend as sibling checkouts:

```text
Repos/
|-- wenlan-app/
`-- wenlan/
```

Use LF checkouts for this repo. Several Bash scripts fail with symptoms such as
`pipefail\r` when Git writes CRLF:

```powershell
git -c core.autocrlf=false clone https://github.com/7xuanlu/wenlan-app.git
git -c core.autocrlf=false clone https://github.com/7xuanlu/wenlan.git
git -C .\wenlan-app config core.autocrlf false
git -C .\wenlan config core.autocrlf false
```

Changing `core.autocrlf` does not rewrite files that are already checked out.
Use a fresh checkout, or first preserve local changes and then recreate the
working tree. Do not run a destructive normalization command in a dirty
checkout.

Windows also ships `C:\Windows\System32\bash.exe`, which is the WSL launcher,
not Git Bash. Put Git Bash first and verify it before running any pnpm script
that invokes `bash`:

```powershell
$env:Path = "C:\Program Files\Git\bin;$env:Path"
(Get-Command bash.exe).Source
# Expected: C:\Program Files\Git\bin\bash.exe
```

Pin the checkouts used by PR #96:

```powershell
git -C .\wenlan-app switch pr-96
git -C .\wenlan-app rev-parse HEAD
# e655fd28f70c6e253744cc2f1fbfc90185480fd9

git -C .\wenlan checkout c66f9d8e3e2edc991a540a89d3c5f60e2c109a99
git -C .\wenlan rev-parse HEAD
# c66f9d8e3e2edc991a540a89d3c5f60e2c109a99
```

## Build the source backend and app

From `wenlan-app`, define explicit paths and isolated runtime data:

```powershell
$AppRepo = (Resolve-Path .).Path
$BackendRepo = (Resolve-Path ..\wenlan).Path
$Target = "x86_64-pc-windows-msvc"
$BackendCommit = "c66f9d8e3e2edc991a540a89d3c5f60e2c109a99"
$Evidence = Join-Path $AppRepo "target\windows-native-smoke\physical-run"
$Data = Join-Path $Evidence "data"
$FastEmbedCache = Join-Path $Evidence "fastembed-cache"

New-Item -ItemType Directory -Force -Path $Evidence, $Data, $FastEmbedCache |
  Out-Null

# Prevent the smoke from creating the default %USERPROFILE%\.wenlan\pages.
@{ knowledge_path = (Join-Path $Data "pages") } |
  ConvertTo-Json |
  Set-Content -LiteralPath (Join-Path $Data "config.json") -Encoding utf8

$env:TARGET_TRIPLE = $Target
$env:WENLAN_BACKEND_DIR = $BackendRepo
$env:WENLAN_BACKEND_COMMIT = $BackendCommit
$env:WENLAN_DATA_DIR = $Data
$env:WENLAN_TEST_FASTEMBED_CACHE = $FastEmbedCache
$env:WENLAN_DOWNLOAD_SIDECARS = "1"
$env:WENLAN_PRESTAGED_SIDECARS = "1"
$env:WENLAN_SIDECAR_MANIFEST = Join-Path $Evidence "staged-sidecars.json"
$env:RUST_LOG = "warn,wenlan_lib::lifecycle=info"
```

Install frontend dependencies and stage the locked release baseline:

```powershell
pnpm install --frozen-lockfile
node scripts/download-sidecars.mjs
```

If `gh` returns `401` for public assets, inspect `gh auth status` and `GH_TOKEN`.
A stale or invalid token can make an otherwise public download fail. Fix or
unset the bad credential; do not weaken SHA-256 checks.

Build the exact backend revision and its CPU ONNX Runtime:

```powershell
Push-Location $BackendRepo
try {
  cargo build --locked --release --target $Target `
    -p wenlan -p wenlan-server -p wenlan-mcp

  & .\scripts\stage-onnxruntime-windows.ps1 `
    -DestinationDirectory "target\$Target\release"
}
finally {
  Pop-Location
}

node scripts/windows/stage-backend-build.mjs `
  --backend-dir $BackendRepo `
  --commit $BackendCommit `
  --manifest $env:WENLAN_SIDECAR_MANIFEST
```

Build the release-profile native executable:

```powershell
pnpm build
pnpm tauri build --no-bundle --target $Target
```

Git Bash must still precede the WSL launcher when `pnpm tauri` runs its
sidecar hook. The expected executable is:

```text
target\x86_64-pc-windows-msvc\release\wenlan-app.exe
```

## Prewarm the embedding model

The first daemon start downloads the BGE ONNX model. Prewarm it before the UI
smoke so a network failure is not confused with an app/runtime failure:

```powershell
$BackendExe = Join-Path $BackendRepo "target\$Target\release\wenlan-server.exe"
$PrewarmStdout = Join-Path $Evidence "prewarm.stdout.log"
$PrewarmStderr = Join-Path $Evidence "prewarm.stderr.log"
$prewarm = Start-Process -WindowStyle Hidden -FilePath $BackendExe `
  -RedirectStandardOutput $PrewarmStdout `
  -RedirectStandardError $PrewarmStderr `
  -PassThru

try {
  $deadline = [DateTime]::UtcNow.AddMinutes(5)
  do {
    Start-Sleep -Seconds 1
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:7878/api/health"
    }
    catch {
      $health = $null
    }
  } until ($health.status -eq "ok" -or [DateTime]::UtcNow -ge $deadline)

  if ($health.status -ne "ok") {
    throw "backend prewarm did not become healthy; inspect the prewarm logs"
  }
}
finally {
  if ($prewarm -and -not $prewarm.HasExited) {
    Stop-Process -Id $prewarm.Id -Force
  }
}
```

On the verified machine, `hf-hub 0.4.3` left a complete
`model_optimized.onnx.part`, retried with a range beginning exactly at EOF,
received HTTP 416, and never promoted the file. For the pinned
`Qdrant/bge-base-en-v1.5-onnx-Q` snapshot, the observed complete model was
217,824,172 bytes with SHA-256
`4E556722BC4F65716C544C8A931F1E90FB3F866E5741FD93A96F051D673339C7`.

Safe recovery is either:

- remove only the incomplete `.part` and let FastEmbed download it again; or
- promote it only after its size and SHA-256 match the pinned artifact.

Do not rename an unverified partial download and do not disable model or
sidecar integrity checks.

## Run the native WebView2 smoke

Install the same driver tools as the workflow:

```powershell
cargo install tauri-driver --version 2.0.6 --locked
cargo install --git https://github.com/chippers/msedgedriver-tool `
  --rev 8c4b34f51b45f5cf08013366d703de464ab871d1 --locked

$DriverDir = Join-Path $Evidence "driver"
New-Item -ItemType Directory -Force -Path $DriverDir | Out-Null
Push-Location $DriverDir
try {
  msedgedriver-tool
}
finally {
  Pop-Location
}

& (Join-Path $DriverDir "msedgedriver.exe") --version
```

The EdgeDriver and WebView2 **major** versions must match. The verified machine
used exact version `150.0.4078.83` for both.

Capture physical-machine metadata, start `tauri-driver`, and run the harness:

```powershell
$os = Get-CimInstance Win32_OperatingSystem
[ordered]@{
  caption = $os.Caption
  version = $os.Version
  build_number = $os.BuildNumber
  webview2_version = "record-the-detected-version"
  msedgedriver_version = "record-the-detected-version"
  app_commit = (git rev-parse HEAD)
  backend_commit = (git -C $BackendRepo rev-parse HEAD)
} | ConvertTo-Json -Depth 4 |
  Set-Content -LiteralPath (Join-Path $Evidence "physical-machine.json") `
    -Encoding utf8

$TauriDriver = Join-Path $env:USERPROFILE ".cargo\bin\tauri-driver.exe"
$EdgeDriver = Join-Path $DriverDir "msedgedriver.exe"
$driver = Start-Process -WindowStyle Hidden -FilePath $TauriDriver `
  -ArgumentList @("--native-driver", $EdgeDriver) `
  -RedirectStandardOutput (Join-Path $Evidence "tauri-driver.stdout.log") `
  -RedirectStandardError (Join-Path $Evidence "tauri-driver.stderr.log") `
  -PassThru

try {
  # Wait until tauri-driver is listening on 127.0.0.1:4444.
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 250
    $ready = Test-NetConnection 127.0.0.1 -Port 4444 `
      -InformationLevel Quiet -WarningAction SilentlyContinue
  } until ($ready -or [DateTime]::UtcNow -ge $deadline)
  if (-not $ready) {
    throw "tauri-driver did not listen on port 4444"
  }

  pnpm test:native:windows `
    --app "target\$Target\release\wenlan-app.exe" `
    --evidence-dir $Evidence
  if ($LASTEXITCODE -ne 0) {
    throw "native smoke failed with exit code $LASTEXITCODE"
  }
}
finally {
  if ($driver -and -not $driver.HasExited) {
    Stop-Process -Id $driver.Id -Force -ErrorAction SilentlyContinue
  }
  Get-Process msedgedriver -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
}
```

Do not call an already-exited driver process's `.Kill()` method without first
checking `HasExited`; that cleanup race can turn a successful harness into an
outer PowerShell exit failure.

## Reading the evidence

Treat the run as passed only when all of the following hold:

- `result.json` has `status: "passed"` and `error: null`;
- every entry in `assertions` has `ok: true`;
- `health.json` reports `status: "ok"` and `db_initialized: true`;
- the backend PID is a child of the recorded app PID;
- the backend executable is the staged source-built binary;
- loaded modules include the adjacent staged `onnxruntime.dll`;
- the stored source ID, vector-only semantic-search source ID, and visible UI
  marker agree;
- `01-welcome.png`, `02-app-ready.png`, and `03-memory-visible.png` exist;
- the app log contains `[quit] full quit command accepted`; and
- the app, backend, ports 7878/4444, and WebDriver processes are gone.

The physical run passed all 33 assertions with marker
`WINDOWS_SMOKE_1784773202313_1`. The app warned that the source-built backend
reported `0.14.1+gc66f9d8e` while the PR app still reported `0.14.0`. That is
expected for this deliberate post-release source-build smoke, but it is not
acceptable evidence for a version-matched packaged release.

## Test results and remaining Windows gaps

The following commands were run, not inferred:

| Command or gate | Physical Windows result |
| --- | --- |
| `pnpm build` | Passed; TypeScript and Vite production build completed |
| Full `pnpm test` | Passed after portability fixes: `152` files passed, `1620` tests passed, `2` skipped, `0` failed |
| `cargo test -p wenlan-app --lib --no-run` | Passed |
| Rust library suite with Windows platform-assumption skips | `327 passed`, `0 failed`, `1 ignored`, `24 filtered` |
| Exact backend source build | Passed for all three binaries |
| `pnpm tauri build --no-bundle --target x86_64-pc-windows-msvc` | Passed |
| Qwen hardware/inference probe | Passed twice on CPU/OpenMP |
| Native Tauri/WebView2 smoke | Passed, 33/33 assertions |

The first physical run found 22 Windows portability failures. They are now
resolved, and the Windows workflow runs the complete frontend suite before it
installs Rust or starts the expensive native smoke. The fixes establish these
maintenance rules:

- Read source fixtures through `src/test/sourceText.ts` when exact multiline
  text matters. It normalizes CRLF and lone CR to LF.
- Persist repository-relative keys with forward slashes. Do not compare a
  `node:path.relative` result directly with a checked-in POSIX-style baseline.
- Shell integration tests must use `scripts/test-platform.ts`. On Windows it
  deliberately selects Git for Windows Bash instead of the WSL launcher,
  canonicalizes Bash-visible paths, uses `node:path.delimiter`, and collapses
  the `Path`/`PATH` alias only on Windows.
- Build ZIP fixtures with the pinned pure-JavaScript `fflate` dependency. Do
  not assume a host `zip` executable exists.
- Use the native Windows `tar.exe` for tar archives when a Windows test covers
  a cross-target asset.
- Gate OS-specific assertions with `it.runIf` or an explicit platform check.
  Unix executable mode bits and macOS `xattr` behavior are not Windows
  contracts.
- Await observable UI state such as a checked checkbox or a re-enabled
  mutation control. Merely seeing an element or observing that a mock was
  called does not prove the async state transition has settled.
- Give subprocess-heavy integration suites a timeout sized for full-suite
  contention; do not infer stability from an isolated single-worker run.

The verified post-fix command was plain `pnpm test`, not a filtered invocation:
all 152 test files passed with 1620 passing tests and two intentional
platform-specific skips.

The PR workflow's Rust skip list also misses five `identity_paths` tests whose
fixtures set `HOME`. Windows `dirs::data_local_dir()` and `dirs::home_dir()`
use profile APIs instead, so those tests touch the real user profile and can
poison their shared mutex after the first failure. The five affected tests are:

- `app_data_dir_uses_legacy_default_when_current_absent_and_legacy_has_config`;
- `app_data_dir_uses_legacy_default_when_current_empty_and_legacy_has_config`;
- `app_data_dir_uses_legacy_default_when_current_empty_and_legacy_has_activities`;
- `app_data_dir_uses_wenlan_default_when_current_has_app_state`; and
- `app_data_dir_uses_wenlan_default_when_neither_exists`.

Until their fixtures use an injectable Windows profile root, skip those exact
tests in addition to the workflow list and inspect `%LOCALAPPDATA%\wenlan`,
`%LOCALAPPDATA%\origin`, and `%USERPROFILE%\Library\LaunchAgents` before and
after the suite. Remove only entries proven to have been created by the test.

## Cleanup

The native harness cleans its app-owned processes, but local model caches and
an interrupted run can remain. After preserving evidence:

```powershell
Get-Process wenlan-app,wenlan-server,tauri-driver,msedgedriver `
  -ErrorAction SilentlyContinue
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object LocalPort -in 7878, 4444, 9515, 1420
```

Generated FastEmbed data should live under the ignored `target` evidence
directory or another explicit cache path, not as an untracked
`.fastembed_cache/` at the repository root. Check `git status --short` before
committing, and never delete `%LOCALAPPDATA%` or `%USERPROFILE%\.wenlan`
wholesale; resolve and inspect the exact test-created directory first.

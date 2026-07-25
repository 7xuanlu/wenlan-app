# Windows development and native smoke testing

This is the canonical Windows runbook for `wenlan-app`. It covers a source
build of the sibling `7xuanlu/wenlan` backend, a release-profile Tauri build,
and a native WebView2 smoke test. It records what was actually observed on a
physical Windows 11 machine while validating PR #96.

## What this proves

The native smoke proves that one release-profile `wenlan-app.exe`:

1. starts the exact source-built `wenlan-server.exe` as its child process;
2. reaches `/api/health` with an initialized database;
3. records `/api/status` and, when requested, verifies the expected inference
   backend and physical device;
4. loads the staged `onnxruntime.dll` and, for Vulkan proof, the exact adjacent
   `vulkan-1.dll` whose license travels with it;
5. completes visible first-run onboarding in WebView2;
6. stores a unique memory and retrieves it with a vector-only semantic query;
7. renders that same marker in the native UI; and
8. accepts the full-quit command without leaving the app, backend, or test
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

The final 2026-07-23 Vulkan follow-up used app code revision
`e26209bc3cfe31c8450026608214f2a1ca5c3fc6`, backend revision
`f3edbfe4b51ac3406597463dbfd9ad3632fad141`, and the same Windows 11 /
mixed-GPU hardware. Its native run passed 35/35 assertions and recorded
`vulkan`, device index `1`, `NVIDIA GeForce RTX 3060 Laptop GPU`, and
`gpu_layers=99` from the app-owned daemon. The tested `wenlan-app.exe` had
SHA-256
`CC946B72D1C7ACDBD15EA7778AFD6C9897548B3E6237D188F94DA186EBA4F23F`;
the source-built `wenlan-server.exe` had SHA-256
`9FE6DA49395C5222CE655312D8F0237DB7CFB90390674C3D62DE3E76A861996E`.

The 2026-07-24 main-sync verification used app code revision
`a0f7a6f99529a9d7fb50e1d22048428faef2e33a` and backend code revision
`b4677e277e70613585e37e99fa29721426b2a179`, both after merging their current
`origin/main`. The release app SHA-256 was
`cb4abec322af02efe0edca768cc265afecb219606e2fdbacc4d6fcd96011d5ca`;
the source-built server SHA-256 was
`a38b6c682ea6750ac1802ded0517c6ffe7a3bf2538c1b517e2c6bdeda02f03bf`.
The final native run again passed 35/35 assertions with Vulkan device `1`,
`NVIDIA GeForce RTX 3060 Laptop GPU`, and `gpu_layers=99`.

## Current Windows GPU status

The PR #96 baseline above deliberately used backend revision `c66f9d8e`, which
compiled Qwen for CPU/OpenMP on Windows. The focused probe took about 11.2
seconds even though the machine had an RTX 3060. That historical result remains
useful evidence for PR #96; it is not the current backend direction.

Backend [PR #382](https://github.com/7xuanlu/wenlan/pull/382) compiles
llama.cpp with Vulkan and keeps CPU/OpenMP as an observable fallback. Its
canonical setup, device policy, CI/release contract, and three physical smoke
commands live in `../wenlan/docs/windows-vulkan.md`. The app repo must not
duplicate or bypass that backend policy.

There are two relevant inference stacks:

- The on-device Qwen model uses `llama-cpp-2`. macOS keeps Metal, Windows
  x86_64 uses Vulkan, and stock Linux remains CPU/OpenMP. `WENLAN_LLM_DEVICE`
  accepts `auto`, `cpu`, or a llama.cpp device index. Auto prefers a discrete
  GPU over an integrated GPU or accelerator; model-load and context-allocation
  failures perform a real CPU model reload.
- Embeddings use FastEmbed through ONNX Runtime. The Windows staging script
  deliberately downloads `onnxruntime-win-x64-1.23.2`, the CPU package, rather
  than a CUDA or DirectML package. Loading `onnxruntime.dll` proves the bundled
  runtime is used; it does not prove GPU execution.

The physical follow-up on the same mixed-GPU Windows 11 machine proved:

| Leg | Result |
| --- | --- |
| Vulkan auto | Selected device `1`, `NVIDIA GeForce RTX 3060 Laptop GPU`; offloaded `37/37` layers; valid classification |
| Forced CPU | All KV layers ran on CPU; Vulkan1 device allocation was `0.0000 MiB`; latest valid classification completed in about 11.56 seconds |
| Invalid device `99` | Visible `requested GPU device index 99 is unavailable` reason followed by true CPU-only execution and a valid classification in about 11.95 seconds |
| Warm Vulkan | Latest valid classification completed in about 1.16 seconds; an earlier cold run took about 20.56 seconds while creating shader/pipeline state |
| App-owned backend status | Native Tauri smoke captured `/api/status`: `vulkan`, device `1`, RTX 3060, `gpu_layers=99`; 35/35 assertions passed |

The Vulkan-enabled executable imports `vulkan-1.dll` at process start. A
current vendor GPU driver or Vulkan runtime is therefore required even for the
explicit CPU selector; a missing loader fails before Rust can apply fallback.
The Vulkan SDK itself is only a build prerequisite.

## Prerequisites

Install the following before building:

- Git for Windows, including Git Bash;
- Node.js 24 and pnpm 10.28.2;
- Rust 1.95.0 with the `x86_64-pc-windows-msvc` target;
- Visual Studio Build Tools with the C++ desktop workload and Windows SDK;
- CMake and Ninja;
- Windows PowerShell 5.1 or PowerShell 7;
- vcpkg with `sqlite3:x64-windows-static-md`;
- LLVM/libclang;
- a full Strawberry Perl distribution; and
- the Evergreen WebView2 Runtime;
- a current vendor GPU driver/Vulkan runtime; and
- LunarG Vulkan SDK 1.4.350.0 for backend builds.

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

# From the sibling backend repo. This verifies the official installer hash and
# uses LunarG's non-admin copy_only mode.
& .\scripts\setup-vulkan-sdk-windows.ps1

# Keep nested llama.cpp shader paths short and serialize MSVC PDB writers.
$env:CARGO_TARGET_DIR = "C:\wl-target"
$env:CARGO_BUILD_JOBS = "1"

# Required with Visual Studio 2019 Build Tools. The VS 16 CMake generator
# rejects llama.cpp's Vulkan shader DEPFILE rules.
$env:CMAKE_GENERATOR = "Ninja"
```

Codex workspace “full access” removes Codex approval prompts; it does not
bypass Windows UAC. Prefer the SDK's verified `copy_only=1` setup and portable
LLVM/Perl distributions when elevation is unavailable.

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
not Git Bash. `scripts/run-tauri.mjs` now finds Git for Windows, prepends its
`bin` and `usr\bin` directories, and collapses Windows' case-insensitive
`Path`/`PATH` aliases before running Tauri. For direct Bash commands, still put
Git Bash first and verify it:

```powershell
$env:Path = "C:\Program Files\Git\bin;$env:Path"
(Get-Command bash.exe).Source
# Expected: C:\Program Files\Git\bin\bash.exe
```

`pnpm dev:all` is also supported from Windows once Git Bash is discoverable.
The isolated dev runtime normalizes native `C:\...` inputs at the shell
boundary, selects `wenlan-server.exe`, and uses PowerShell process and listener
inspection when `lsof` is unavailable. Its PID, executable, port, and data-dir
receipt remains worktree-scoped; a reused daemon is accepted only when all four
values still match. Tests that launch these Bash entry points must use
`scripts/test-platform.ts` so Windows' case-insensitive `Path`/`PATH` aliases
and the WSL `bash.exe` launcher cannot change which tools run.

Record the exact checkouts used for evidence:

```powershell
git -C .\wenlan-app rev-parse HEAD
git -C .\wenlan rev-parse HEAD
```

Do not substitute a branch name for a 40-character commit in the staged
sidecar manifest.

## Build the source backend and app

From `wenlan-app`, define explicit paths and isolated runtime data:

```powershell
$AppRepo = (Resolve-Path .).Path
$BackendRepo = (Resolve-Path ..\wenlan).Path
$Target = "x86_64-pc-windows-msvc"
$AppCommit = (git -C $AppRepo rev-parse HEAD).Trim()
$BackendCommit = (git -C $BackendRepo rev-parse HEAD).Trim()
$Evidence = Join-Path $AppRepo "target\windows-native-smoke\physical-run"
$Data = Join-Path $Evidence "data"
$FastEmbedCache = Join-Path $Evidence "fastembed-cache"

New-Item -ItemType Directory -Force -Path $Evidence, $Data, $FastEmbedCache |
  Out-Null

# Prevent the smoke from creating the default profile data. Windows
# PowerShell 5.1's `-Encoding utf8` writes a BOM; use explicit no-BOM UTF-8
# because the daemon's JSON loader does not accept that BOM.
$ConfigJson = @{
  knowledge_path = (Join-Path $Data "pages")
  setup_completed = $false
} | ConvertTo-Json
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
  (Join-Path $Data "config.json"),
  $ConfigJson,
  $Utf8NoBom
)

$env:TARGET_TRIPLE = $Target
$env:WENLAN_BACKEND_DIR = $BackendRepo
$env:WENLAN_WINDOWS_BACKEND_BUILD_DIR = $BackendRepo
$BackendCargoTarget = "C:\wl-target"
$env:CARGO_TARGET_DIR = $BackendCargoTarget
$env:WENLAN_WINDOWS_BACKEND_CARGO_TARGET_DIR = $BackendCargoTarget
$env:WENLAN_BACKEND_COMMIT = $BackendCommit
$env:GITHUB_SHA = $AppCommit
$env:WENLAN_DATA_DIR = $Data
$env:WENLAN_TEST_FASTEMBED_CACHE = $FastEmbedCache
$env:WENLAN_DOWNLOAD_SIDECARS = "1"
$env:WENLAN_PRESTAGED_SIDECARS = "1"
$env:WENLAN_SIDECAR_MANIFEST = Join-Path $Evidence "staged-sidecars.json"
$env:WENLAN_NATIVE_PROFILE_ROOT = Join-Path $Evidence "profile-check"
$env:RUST_LOG = "warn,wenlan_lib::lifecycle=info"
```

`WENLAN_NATIVE_PROFILE_ROOT` changes only the harness's fake
`Library\LaunchAgents` pollution check. Do not change `USERPROFILE` just to
isolate that check: Windows known-folder APIs and the Hugging Face model cache
do not consistently follow a temporary `USERPROFILE`.

`GITHUB_SHA` is also used for local physical runs so `result.json` binds the
tested app binary to its source revision. A pre-warmed FastEmbed cache may be
reused across isolated evidence directories, but do not recursively copy its
Hugging Face snapshot tree: it contains relative symlinks, and changing their
representation can make ONNX Runtime report that an otherwise present model
does not exist. Keep `WENLAN_DATA_DIR` and `WENLAN_NATIVE_PROFILE_ROOT` unique
for every run. Debug startup and `scripts/dev-runtime.sh` both reject data or
state directories under the production `%LOCALAPPDATA%\wenlan` and
`%LOCALAPPDATA%\origin` roots.

For a physical Vulkan run, also set:

```powershell
$env:WENLAN_LLM_DEVICE = "auto"
$env:WENLAN_NATIVE_EXPECT_INFERENCE_BACKEND = "vulkan"
$env:WENLAN_NATIVE_EXPECT_INFERENCE_DEVICE_CONTAINS = "RTX 3060"
$env:WENLAN_NATIVE_EXPECT_INFERENCE_DEVICE_INDEX = "1"
$env:WENLAN_NATIVE_EXPECT_INFERENCE_GPU_LAYERS = "99"
$env:WENLAN_NATIVE_EXPECT_NO_INFERENCE_FALLBACK = "1"
$env:WENLAN_NATIVE_ON_DEVICE_MODEL = "qwen3-4b"
```

Omit the five `WENLAN_NATIVE_EXPECT_*` values when the machine has no supported
GPU. The harness still saves `status.json`; it makes only the explicitly
provided backend, device, device-index, GPU-layer, and no-fallback expectations
mandatory. Invalid numeric or boolean expectation values fail closed.

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
    --jobs 1 -p wenlan -p wenlan-server -p wenlan-mcp

  & .\scripts\stage-onnxruntime-windows.ps1 `
    -DestinationDirectory (Join-Path $BackendCargoTarget "$Target\release")
  & .\scripts\stage-vulkan-loader-windows.ps1 `
    -DestinationDirectory (Join-Path $BackendCargoTarget "$Target\release")
}
finally {
  Pop-Location
}

node scripts/windows/stage-backend-build.mjs `
  --backend-dir $BackendRepo `
  --cargo-target-dir $BackendCargoTarget `
  --commit $BackendCommit `
  --manifest $env:WENLAN_SIDECAR_MANIFEST
```

Build the release-profile native executable:

```powershell
# Keep the backend location for the Tauri hook, but return the app build to its
# normal repository-local target directory.
Remove-Item Env:CARGO_TARGET_DIR
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
$BackendExe = Join-Path $BackendCargoTarget "$Target\release\wenlan-server.exe"
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

  # Select, cache, and hot-load the on-device model through the same API used
  # by Settings. This persists `on_device_model` in the isolated no-BOM config.
  Invoke-RestMethod -Method Post `
    -Uri "http://127.0.0.1:7878/api/on-device-model/download" `
    -ContentType "application/json" `
    -Body '{"model_id":"qwen3-4b"}'

  if ($env:WENLAN_NATIVE_EXPECT_INFERENCE_BACKEND) {
    $deadline = [DateTime]::UtcNow.AddMinutes(3)
    do {
      Start-Sleep -Seconds 1
      $inference = (Invoke-RestMethod `
        "http://127.0.0.1:7878/api/status").on_device_inference
    } until (
      $inference.backend -eq $env:WENLAN_NATIVE_EXPECT_INFERENCE_BACKEND -or
      [DateTime]::UtcNow -ge $deadline
    )
    if ($inference.backend -ne $env:WENLAN_NATIVE_EXPECT_INFERENCE_BACKEND) {
      throw "expected inference backend did not become ready"
    }
  }
}
finally {
  if ($prewarm -and -not $prewarm.HasExited) {
    Stop-Process -Id $prewarm.Id -Force
  }
}
```

When an expected inference backend is configured, the native harness repeats
the model selection/load request after the app-owned daemon reaches health and
then polls `/api/status`. This is intentional: the standalone prewarm proves
the cache and backend, while the second request proves the exact daemon child
started by Tauri. Do not replace it with a fixed sleep for the background
startup scheduler.

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
  app_commit = $AppCommit
  backend_commit = $BackendCommit
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
  $edgeDriverPid = Get-CimInstance Win32_Process |
    Where-Object {
      $_.ParentProcessId -eq $driver.Id -and
      $_.Name -eq "msedgedriver.exe"
    } |
    Select-Object -ExpandProperty ProcessId -First 1

  pnpm test:native:windows `
    --app "target\$Target\release\wenlan-app.exe" `
    --evidence-dir $Evidence
  if ($LASTEXITCODE -ne 0) {
    throw "native smoke failed with exit code $LASTEXITCODE"
  }
}
finally {
  if ($edgeDriverPid) {
    Stop-Process -Id $edgeDriverPid -Force -ErrorAction SilentlyContinue
  }
  if ($driver -and -not $driver.HasExited) {
    Stop-Process -Id $driver.Id -Force -ErrorAction SilentlyContinue
  }
}
```

Do not call an already-exited driver process's `.Kill()` method without first
checking `HasExited`; that cleanup race can turn a successful harness into an
outer PowerShell exit failure. Do not kill every process named
`msedgedriver.exe`; stop only the child PID owned by this driver.

## Reading the evidence

Treat the run as passed only when all of the following hold:

- `app.log` was copied from the native Windows log at
  `%LOCALAPPDATA%\wenlan\logs\wenlan.log` (or the explicit `WENLAN_APP_LOG`);
- `result.json` has `status: "passed"` and `error: null`;
- every entry in `assertions` has `ok: true`;
- `health.json` reports `status: "ok"`, `db_initialized: true`, and the same
  short Git commit as the source-built sidecar manifest, preventing a stale
  target binary from being relabelled;
- `status.json` records the on-device backend; a physical GPU run must match
  the explicit backend, device, device-index, GPU-layer, and no-fallback
  expectations;
- the backend PID is a child of the recorded app PID;
- the backend executable is the staged source-built binary;
- loaded modules include the adjacent staged `onnxruntime.dll`;
- a Vulkan-expected run maps the exact adjacent staged `vulkan-1.dll` in the
  exercised backend process, and the source-build manifest also hashes
  `VulkanRT-License.txt`; a system-wide loader is not accepted as proof;
- the stored source ID, vector-only semantic-search source ID, and visible UI
  marker agree;
- `01-welcome.png`, `02-app-ready.png`, and `03-memory-visible.png` exist;
- the app log contains `[quit] full quit command accepted` with a timestamp no
  earlier than this harness run; and
- the app, backend, ports 7878/4444, and WebDriver processes are gone.

The physical run passed all 33 assertions with marker
`WINDOWS_SMOKE_1784773202313_1`. The app warned that the source-built backend
reported `0.14.1+gc66f9d8e` while the PR app still reported `0.14.0`. That is
expected for this deliberate post-release source-build smoke, but it is not
acceptable evidence for a version-matched packaged release.

The latest main-sync Vulkan evidence is
`target/windows-native-smoke/physical-win11-vulkan-main-sync-final4`. It passed
all 35 assertions with marker `WINDOWS_SMOKE_1784954334839_1`, app commit
`a0f7a6f99529a9d7fb50e1d22048428faef2e33a`, backend commit
`b4677e277e70613585e37e99fa29721426b2a179`, and backend binary SHA-256
`a38b6c682ea6750ac1802ded0517c6ffe7a3bf2538c1b517e2c6bdeda02f03bf`.
The app-owned backend and app both exited cleanly, ports 7878 and 4444 were
clear, and the three screenshots were visually inspected rather than accepted
by file existence alone. The evidence extractor now rejects guarded-quit
breadcrumbs older than the recorded harness start time, so an accumulated log
entry from a previous run cannot satisfy the current lifecycle assertion.

## Test results and remaining Windows gaps

The following commands were run, not inferred:

| Command or gate | Physical Windows result |
| --- | --- |
| `pnpm build` | Passed; TypeScript and Vite production build completed |
| Full `pnpm test` | Passed after the latest main sync and portability fixes: `170` files passed, `1842` tests passed, `2` skipped, `0` failed |
| `cargo test -p wenlan-app --lib --no-run` | Passed |
| Full Rust library suite on Windows, without name-based skips | `381 passed`, `0 failed`, `1 ignored`, `0` filtered |
| Exact backend source build | Passed for all three binaries |
| `pnpm tauri build --no-bundle --target x86_64-pc-windows-msvc` | Passed |
| Qwen hardware/inference probe | PR #96 baseline passed twice on CPU/OpenMP; backend Vulkan follow-up passed auto/discrete, forced CPU, and invalid-device fallback |
| Native Tauri/WebView2 smoke | Historical CPU run passed 33/33; Vulkan app-owned backend run passed 35/35 |

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
- On Windows, invoke inbox `powershell.exe` instead of assuming PowerShell 7's
  `pwsh` exists. Non-Windows script contract tests may continue to use `pwsh`.
- Tauri creates main, toast, and quick-capture WebViews. Native automation must
  select the handle whose URL has neither `#toast` nor `#quick-capture`; window
  creation order is not a stable selector.
- When a PowerShell-generated JSON file is consumed by Rust, write explicit
  UTF-8 without BOM. Windows PowerShell 5.1's `-Encoding utf8` is not no-BOM.
- Treat WebDriver `POST /session` as non-idempotent for Tauri. Keep
  WebdriverIO `connectionRetryCount: 0`; an automatic retry can launch a second
  app and orphan the first app-owned daemon.
- A physical inference expectation must use the Settings
  `/api/on-device-model/download` route after app-owned backend health, then
  poll `/api/status`. Background startup admission is deliberately delayed and
  is not a reliable GPU-readiness trigger for a bounded smoke.
- Keep `WENLAN_NATIVE_PROFILE_ROOT` separate from `USERPROFILE`: the former
  isolates only the macOS-path pollution assertion, while the latter controls
  Windows identity paths and model caches.
- `CARGO_TARGET_DIR` is a valid backend build location. Pass it as
  `--cargo-target-dir` or
  `WENLAN_WINDOWS_BACKEND_CARGO_TARGET_DIR` when staging; never silently stage
  stale payloads from `<backend>\target`.
- Treat `vulkan-1.dll` and `VulkanRT-License.txt` as one optional compatibility
  pair while older CPU-only backend releases remain pinned. If either source
  file exists, both must be non-empty, hashed in the source-build manifest,
  copied beside the app-owned server, and verified by exact loaded-module
  path. When neither exists, remove stale copies rather than borrowing them
  from a previous build.
- `Start-Process -ArgumentList` joins arguments into a Windows command line.
  Prefer direct invocation when an individual argument contains spaces, or
  quote that argument explicitly and verify the child command line.

The verified post-main-sync command was plain `pnpm test`, not a filtered
invocation: all 170 test files passed with 1842 passing tests and two
intentional platform-specific skips.

Five `identity_paths` tests originally set `HOME` and therefore touched the real
Windows profile because `dirs::data_local_dir()` uses the Windows known-folder
API. They now exercise the same selection logic through an explicit temporary
base directory. The Windows suite runs all five; do not add them to the skip
list or reintroduce process-global profile mutation.

The former 19-name Rust skip list is gone. Tests now inject temporary roots
into path-selection helpers, compare `Path` components instead of `/`-joined
strings, JSON-escape Windows vault paths, and give macOS LaunchAgent fixtures
an explicit test-only `HOME` rather than relying on the Windows known-folder
API. The workflow runs the unfiltered library suite and still audits its real
profile for unexpected `Library\LaunchAgents` pollution.

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

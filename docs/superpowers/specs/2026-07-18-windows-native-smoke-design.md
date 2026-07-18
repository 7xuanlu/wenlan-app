# Windows Native Smoke Design

**Status:** design for review  
**Date:** 2026-07-18  
**Repositories:** `7xuanlu/wenlan-app` and `7xuanlu/wenlan`

## Outcome

Prove on a clean GitHub-hosted Windows VM that the native Wenlan Tauri app can
start its pinned Wenlan backend, exchange real data with it, render that data in
the native WebView2 UI, and leave inspectable visual and machine evidence.

The first proof is a manual GitHub Actions workflow. It is intentionally lighter
than maintaining a local Windows VM on an Apple Silicon Mac, but it must test
the actual Windows binaries and native Tauri window rather than the existing
browser preview harness.

## Evidence already established

- The backend repository already builds and tests on `windows-2022`, exercises
  its Windows Task Scheduler background lifecycle, and publishes
  `wenlan-windows-x64.zip`.
- That archive contains `wenlan.exe`, `wenlan-server.exe`, `wenlan-mcp.exe`, and
  `onnxruntime.dll`.
- The app repository's CI and release workflows are macOS-only today.
- The app's pinned-download script hard-codes
  `wenlan-darwin-arm64.tar.gz`; it cannot stage the Windows backend archive.
  Its build-from-source path is already aware of Windows target triples.
- The existing Playwright E2E suite launches the Vite browser harness, so it
  does not prove a native Tauri process, a WebView2 window, or packaged
  sidecars.
- Tauri 2's official WebDriver path supports Windows through `tauri-driver`;
  the official GitHub Actions example uses `msedgedriver-tool`.
- The current clean-Windows startup result is unknown, not known-broken. The
  shared startup path inspects macOS-shaped plist paths, but an absent plist
  makes the preflight succeed; it then attempts the sidecar and hydration.
  The automatic first-run installer rejects `wenlan-app.exe` as a non-macOS
  bundle target before writing a plist or invoking `launchctl`. UI-facing
  run-at-login commands still call the macOS lifecycle seam and need explicit
  Windows behavior.
- The debug build also enables `tauri-plugin-mcp` with a Unix socket path
  (`/tmp/tauri-mcp.sock`). The dependency is unconditional in `app/Cargo.toml`,
  so Windows compilation must establish whether the crate itself is portable
  even when plugin initialization is excluded from release builds.

## Proof boundary

The initial workflow proves:

1. A clean `windows-2022` runner can fetch and verify the exact backend release
   and exact cloudflared release selected by one sidecar lock contract.
2. The real backend executables, `onnxruntime.dll`, and the Windows
   `cloudflared.exe` sidecar are staged with Tauri's required target-triple
   names.
3. The native Tauri executable builds and launches.
4. The app itself owns the successful `wenlan-server.exe` sidecar launch. The
   test must begin with port `7878` unused and must not pre-launch the daemon as
   a substitute.
5. `/api/health` answers from the spawned backend and both the app and backend
   processes are present. The backend's parent PID and executable path match the
   app and staged sidecar, and its loaded `onnxruntime.dll` path matches the
   staged DLL.
6. A unique smoke memory is written through the real backend API and becomes
   visible in the native Tauri UI.
7. A screenshot is taken by native WebDriver before and after the memory is
   visible, and the DOM assertion checks the same unique text.

This is basic native compatibility proof on the exact Windows Server 2022 build
recorded in the artifact. It is not client-Windows or release readiness:
installer behavior, Windows 10/11 coverage, signing, updater metadata,
run-at-login behavior, clean uninstall, and long-running lifecycle remain
separate gates.

## Selected approach

Add a manually dispatched `windows-smoke.yml` workflow on `windows-2022`.
Use Tauri's supported WebDriver stack (`tauri-driver` plus
`msedgedriver-tool`) with a pinned standalone `webdriverio` client and the
repository's pinned pnpm/Rust toolchains. WebdriverIO is the Tauri-documented
client path; Playwright does not speak the `tauri-driver` protocol. Keep the
native smoke separate from the fast browser E2E suite so the evidence boundary
is obvious and failures are diagnosable.

Do not add an RDP tunnel to the hosted runner. A GitHub-hosted runner is an
ephemeral VM, but GitHub does not expose its desktop as an interactive product
surface. Third-party tunnel credentials and session services add security and
flakiness without strengthening the repeatable proof. Screenshots, DOM
assertions, process output, health JSON, and logs are the review surface.

## Runtime changes required before the smoke can pass

### Platform lifecycle seam

Test the existing clean-Windows sidecar fallback before changing it. The absent
plist path currently makes the preflight a no-op, so no speculative startup
rewrite is justified. The Windows runtime must begin with no healthy daemon,
spawn the bundled `wenlan-server` sidecar, and perform health/config hydration.
If live evidence shows a platform-specific failure, separate macOS LaunchAgent
ownership from the cross-platform fallback without changing the proven macOS
behavior.

Run-at-login and full-quit commands must have explicit Windows behavior.
For the first proof, it is acceptable for run-at-login to return a clear
"unsupported on Windows" result if the UI handles it honestly. It is not
acceptable to invoke `launchctl`, create fake `~/Library/LaunchAgents` paths, or
report success.

The existing first-run installer must retain its stable-target guard, which
returns before plist writes or `launchctl` on Windows. The smoke will assert
that no fake `~/Library/LaunchAgents` directory was created.

On Windows, the full-quit command's graceful daemon stop depends on
`POST /api/shutdown`; there is no launchd fallback. A daemon that ignores that
request or remains alive is a backend/product failure, not a harness success.

The existing app log path is macOS-shaped but writable on Windows. The first
smoke may collect it in place. Relocating it to the platform-native log
directory is hygiene, not a prerequisite. Sidecar stdout/stderr is already
folded into the app log with `[daemon]` prefixes; the evidence contract must not
claim a separate daemon log unless the harness explicitly creates one.

### Platform sidecar preparation

Replace the download path's Darwin constants with host/target-aware release
metadata:

| Tauri target | Backend asset | Archive | Required payload |
| --- | --- | --- | --- |
| `aarch64-apple-darwin` | `wenlan-darwin-arm64.tar.gz` | tar.gz | three binaries |
| `x86_64-pc-windows-msvc` | `wenlan-windows-x64.zip` | zip | three `.exe` files plus `onnxruntime.dll` |

Replace the current two-line pin with one sidecar lock file containing exactly
one backend tag, a SHA-256 for every supported backend asset, one exact
cloudflared version, and a SHA-256 for every supported cloudflared asset. Do not
add a second source of truth. The backend tag remains in the existing
app/backend release-version lockstep.

Update every reader and writer in the same change, including
`backend-pin-bump.yml` and `release-version-sync.test.ts`, so an automated pin
bump cannot erase a Windows hash or leave macOS and Windows pinned to different
backend tags. Never reuse one platform's hash for another.

Add script-level tests for asset selection, filename mapping, cloudflared
version/hash verification, missing payload, and checksum mismatch before wiring
CI. Record every staged binary's source version and SHA-256.

The Windows native dependency must end up where `wenlan-server.exe` can load it
at runtime. After health succeeds, enumerate the backend's loaded modules and
assert that `onnxruntime.dll` is loaded from the staged directory, not a system
directory or runner `PATH`. Backend source shows `MemoryDB::new` eagerly
initializes FastEmbed before the HTTP service becomes healthy, so health plus
this module-path assertion proves the staged ONNX runtime was loadable.

### Debug-driver compatibility

Compile on Windows before designing around debug-only plugins. If
`tauri-plugin-mcp` is not Windows-compatible, gate both the Cargo dependency and
its initialization to supported platforms. Do not introduce smoke-only product
features or a bespoke smoke binary.

Run the native smoke against the release profile with the same Tauri product
configuration that the later NSIS workflow will package. Record the Cargo
profile and exact feature set. The native proof uses WebDriver; it must not
depend on the MCP plugin.

### WebView2 and driver preflight

Before building the WebDriver session, assert that the WebView2 Evergreen
runtime is present and record its exact version. Install `msedgedriver` through
the supported Tauri tooling, then assert that its major version matches the
WebView2 runtime major version. Fail with a targeted environment error instead
of retrying an opaque session-creation failure.

## Native test flow

1. Assert that no process is listening on `127.0.0.1:7878`.
2. Record the Windows Server build, WebView2 version, and matching Edge driver
   version.
3. Stage verified backend sidecars, `onnxruntime.dll`, and `cloudflared.exe`
   from the single lock contract.
4. Build the release-profile Tauri executable with no smoke-only features.
5. Start `msedgedriver` and `tauri-driver`, then open a WebDriver session for
   the built executable.
6. Wait for the first-run Setup Wizard and save `01-welcome.png`.
7. Poll `/api/health`; save the exact response as `health.json`.
8. Query `Win32_Process` and loaded modules. Require the backend parent PID to
   equal the app PID, its executable path to equal the staged sidecar path, and
   its loaded `onnxruntime.dll` path to equal the staged DLL path.
9. Drive the real zero-configuration onboarding path through WebDriver: Get
   Started; skip model, import, and client connection; wait for the setting-up
   daemon task to complete; continue; then open Wenlan from the Done step. Save
   `02-app-ready.png`. Do not call `set_setup_completed` behind the UI.
10. Create a memory containing a per-run marker such as
   `WINDOWS_SMOKE_<run-id>_<attempt>` through the daemon's supported API.
11. Fetch the stored memory back through the backend and require the same
    marker.
12. Navigate or refresh through normal UI behavior until that exact marker is
    visible. Assert the DOM text, then save `03-memory-visible.png`.
13. Invoke the product's full-quit command, not a hard process kill. Require the
    app-owned backend to exit within 10 seconds after the app exits. Record this
    result before any best-effort cleanup so retries remain hermetic.

The test must fail if only the browser preview works, if a daemon was started by
the workflow instead of the app, if health succeeds but the marker is absent
from the backend or UI, if a different ONNX runtime is loaded, if the app leaves
an orphaned daemon, or if screenshots are missing.

## Evidence artifact

Upload one artifact on every run, including failures:

```text
windows-native-smoke/
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

`result.json` records commit SHAs for both repositories, the backend tag and
verified archive hash, cloudflared version/hash, Windows Server edition/build and
runner image, WebView2 and driver versions, Cargo profile/features, assertion
results, and artifact paths. Screenshots are evidence only when paired with
exact assertions and process/health records.

## CI rollout

1. Keep the workflow manual while runtime and harness issues are being removed.
2. Require three consecutive green runs, including one cold-cache run, with
   complete evidence artifacts.
3. Then add the native smoke as a pull-request gate for changes to Tauri
   runtime, sidecar preparation, lifecycle, and Windows workflow/test paths.
4. Add a separate installed-NSIS smoke that installs into a clean location,
   launches the installed app, repeats the health/UI marker proof, and
   uninstalls. Only that later gate supports a claim that the Windows package is
   installable.
5. Add Windows release assets, signing, updater metadata, and Windows 11
   validation only after the installed smoke is green.

## Acceptance criteria

- A manual GitHub Actions run is green on `windows-2022`, with the exact Windows
  Server build recorded.
- The evidence artifact contains all three required screenshots and all required
  machine evidence.
- The clean-VM wizard is completed through its visible zero-configuration UI
  path, and the product shell is visible afterward.
- The unique marker is present in the backend response and native UI assertion.
- Process evidence proves the backend parent PID and executable path match the
  app and staged sidecar.
- Module evidence proves the backend loaded the staged `onnxruntime.dll`.
- The full-quit command exits both the app and app-owned backend within
  10 seconds.
- No macOS service-manager command is executed on Windows. Platform-specific
  lifecycle paths return honest Windows behavior, and no fake
  `~/Library/LaunchAgents` directory is created.
- Automated positive controls prove that removing `onnxruntime.dll`, corrupting
  either backend or cloudflared checksums, supplying the wrong parent PID, or
  changing the expected marker makes the owning validator fail in a targeted
  step. Checksum/payload controls are script tests; process/marker controls are
  validator-level fixture tests against recorded evidence, not repeated native
  builds.
- The workflow description and result explicitly say
  "Windows Server 2022 native compatibility smoke", not "Windows release
  supported" or "Windows 11 supported".

## Explicit non-goals for the first proof

- Interactive RDP access to GitHub's hosted runner.
- Windows code signing or public release publication.
- Updater validation.
- Windows Task Scheduler run-at-login integration in the app.
- ARM64 Windows.
- Performance, soak, suspend/resume, multi-user, or enterprise policy testing.

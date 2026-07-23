import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = resolve(
  process.cwd(),
  ".github",
  "workflows",
  "windows-smoke.yml",
);
const CI_WORKFLOW_PATH = resolve(
  process.cwd(),
  ".github",
  "workflows",
  "ci.yml",
);
const APP_CARGO_PATH = resolve(process.cwd(), "app", "Cargo.toml");
const NATIVE_HARNESS_PATH = resolve(
  process.cwd(),
  "scripts",
  "windows",
  "native-smoke.mjs",
);

function workflow(): string {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

function ciWorkflow(): string {
  return readFileSync(CI_WORKFLOW_PATH, "utf8");
}

function appCargo(): string {
  return readFileSync(APP_CARGO_PATH, "utf8");
}

function nativeHarness(): string {
  return readFileSync(NATIVE_HARNESS_PATH, "utf8");
}

describe("Windows native smoke workflow contract", () => {
  it("is a manual, least-privilege Windows Server 2022 proof", () => {
    const text = workflow();

    expect(text).toContain("workflow_dispatch:");
    expect(text).toContain("runs-on: windows-2022");
    expect(text).toContain("contents: read");
    expect(text).toContain(
      "Windows Server 2022 native app with source-built backend smoke",
    );
    expect(text).not.toMatch(/\b(push|pull_request|schedule):/);
  });

  it("can bootstrap a branch run through the default-branch CI dispatcher", () => {
    const windows = workflow();
    const ci = ciWorkflow();

    expect(windows).toContain("workflow_call:");
    expect(ci).toContain("windows_native_smoke:");
    expect(ci).toContain("inputs.windows_native_smoke");
    expect(ci).toContain("uses: ./.github/workflows/windows-smoke.yml");
  });

  it("pins the native driver toolchain and checks WebView2 compatibility", () => {
    const text = workflow();

    expect(text).toContain(
      "cargo install tauri-driver --version 2.0.6 --locked",
    );
    expect(text).toContain(
      "--rev 8c4b34f51b45f5cf08013366d703de464ab871d1",
    );
    expect(text).toContain("msedgedriver-tool");
    expect(text).toContain("WEBVIEW2_VERSION");
    expect(text).toContain("MSEDGEDRIVER_VERSION");
    expect(text).toContain("--native-driver");
  });

  it("runs the complete frontend suite before installing the Rust toolchain", () => {
    const text = workflow();
    const frontendSuite = text.indexOf("run: pnpm test");
    const rustToolchain = text.indexOf("name: Install Rust 1.95.0");

    expect(frontendSuite).toBeGreaterThanOrEqual(0);
    expect(rustToolchain).toBeGreaterThan(frontendSuite);
  });

  it("builds the release-profile native target with an exact source-built backend", () => {
    const text = workflow();

    expect(text).toContain("TARGET_TRIPLE: x86_64-pc-windows-msvc");
    expect(text).toContain("WENLAN_DOWNLOAD_SIDECARS: \"1\"");
    expect(text).toContain(
      "WENLAN_BACKEND_SMOKE_COMMIT: c66f9d8e3e2edc991a540a89d3c5f60e2c109a99",
    );
    expect(text).toContain(
      '"WENLAN_BACKEND_COMMIT=$backendCommit" | Out-File',
    );
    expect(text).toContain("WENLAN_PRESTAGED_SIDECARS: \"1\"");
    expect(text).toContain("repository: 7xuanlu/wenlan");
    expect(text).toContain("ref: ${{ env.WENLAN_BACKEND_SMOKE_COMMIT }}");
    expect(text).toContain("path: windows-smoke-backend");
    expect(text).toContain(
      "cargo build --locked --release --target x86_64-pc-windows-msvc",
    );
    expect(text).toContain("-p wenlan -p wenlan-server -p wenlan-mcp");
    expect(text).toContain("scripts/stage-onnxruntime-windows.ps1");
    expect(text).toContain("node scripts/windows/stage-backend-build.mjs");
    expect(text).toContain("cargo test -p wenlan-app --lib --no-run");
    expect(text).toContain(
      "Run Windows Rust library tests except verified platform-assumption cases",
    );
    expect(text).toContain("cargo test -p wenlan-app --lib --");
    expect(text).toContain(
      '$launchAgentsPath = Join-Path $env:USERPROFILE "Library\\LaunchAgents"',
    );
    expect(text).toContain(
      "Windows Rust test precondition failed: fake LaunchAgents path already exists",
    );
    expect(text).toContain('"rust-test-launchagents.json"');
    expect(text).toContain("Get-ChildItem -LiteralPath $launchAgentsPath -Recurse");
    expect(text).toContain("if ($unexpected.Count -gt 0)");
    expect(text).toContain(
      "Remove-Item -LiteralPath $launchAgentsPath -Recurse -Force",
    );
    expect(text).toContain(
      "$report.cleanup_completed = -not (Test-Path -LiteralPath $launchAgentsPath)",
    );
    expect(text).toContain(
      "Windows Rust test cleanup failed: fake LaunchAgents path remains",
    );
    const platformAssumptionTests = [
      "config::tests::config_knowledge_path_default_uses_legacy_when_only_legacy_exists",
      "config::tests::config_knowledge_path_default_uses_wenlan_when_no_legacy_exists",
      "lifecycle::tests::app_plist_path_uses_wenlan_label",
      "lifecycle::tests::install_app_plist_writes_file_and_calls_launchctl_load",
      "lifecycle::tests::install_app_plist_writes_wenlan_log_paths",
      "lifecycle::tests::legacy_app_plist_ownership_accepts_owned_origin_app_path",
      "lifecycle::tests::legacy_app_plist_path_uses_origin_label",
      "lifecycle::tests::legacy_server_plist_does_not_count_as_current_wenlan_service",
      "lifecycle::tests::legacy_server_plist_ownership_accepts_owned_origin_server_path",
      "lifecycle::tests::opt_out_flag_round_trip",
      "lifecycle::tests::service_management_uses_wenlan_cli_next_to_app_binary",
      "lifecycle::tests::set_run_at_login_false_cleans_legacy_app_and_server_plists",
      "lifecycle::tests::stable_launch_agent_target_accepts_user_wenlan_app_bundle",
      "lifecycle::tests::uninstall_app_plist_removes_file",
      "mcp_config::tests::test_client_config_path_codex_cli",
      "mcp_config::tests::test_client_config_path_gemini_cli",
      "remote_access::tests::test_token_generate_args_include_wenlan_output_path",
      "search::avatar_path_tests::avatar_storage_dir_uses_legacy_default_when_current_empty_and_legacy_has_avatars",
      "sources::obsidian::discover_vaults_tests::vault_path_no_longer_on_disk_is_filtered_out",
    ];
    for (const testName of platformAssumptionTests) {
      expect(text).toContain(`--skip ${testName}`);
    }
    expect(text.match(/--skip /g)).toHaveLength(platformAssumptionTests.length);
    const buildHook = readFileSync(
      resolve(process.cwd(), "scripts", "prepare-tauri-build-sidecars.sh"),
      "utf8",
    );
    expect(buildHook).toContain(
      'exec node "$SCRIPT_DIR/windows/stage-backend-build.mjs" --verify-only',
    );
    expect(text).toContain("WENLAN_DATA_DIR=");
    expect(text).toContain("WENLAN_SIDECAR_MANIFEST=");
    expect(text).toContain(
      'RUST_LOG: "warn,wenlan_lib::lifecycle=info"',
    );
    const extractionProof =
      "pnpm exec vitest run scripts/download-sidecars.test.ts --maxWorkers=1";
    const backendBuild = "cargo build --locked --release";
    const nativeBuild =
      "pnpm tauri build --no-bundle --target x86_64-pc-windows-msvc";
    expect(text).toContain(extractionProof);
    expect(text).toContain(nativeBuild);
    expect(text.indexOf(extractionProof)).toBeLessThan(
      text.indexOf(nativeBuild),
    );
    expect(text.indexOf(backendBuild)).toBeLessThan(text.indexOf(nativeBuild));
    expect(text).toContain("target/x86_64-pc-windows-msvc/release/wenlan-app.exe");
    expect(text).toMatch(
      /node scripts\/download-sidecars\.mjs\s+if \(\$LASTEXITCODE -ne 0\) \{\s+throw "sidecar download failed with exit code \$LASTEXITCODE"/,
    );
    expect(text).toMatch(
      /& scripts\/stage-onnxruntime-windows\.ps1[\s\S]*?if \(-not \$\?\) \{\s+throw "ONNX Runtime staging failed"/,
    );
    expect(text).toMatch(
      /node scripts\/windows\/stage-backend-build\.mjs[\s\S]*?--manifest \$env:WENLAN_SIDECAR_MANIFEST\s+if \(\$LASTEXITCODE -ne 0\) \{\s+throw "backend sidecar staging failed with exit code \$LASTEXITCODE"/,
    );
    expect(text).not.toContain(
      'gh api "repos/7xuanlu/wenlan/commits/$backendTag"',
    );
  });

  it("captures real staging failures inside the harness evidence boundary", () => {
    const text = nativeHarness();
    const mainStateIndex = text.indexOf("let lastWorkloadSnapshot");
    const tryIndex = text.indexOf("try {", mainStateIndex);
    const stageIndex = text.lastIndexOf("stageRuntimeSidecars(args.app)");
    const verifyIndex = text.lastIndexOf("verifySourceBuiltBackend(runtime)");

    expect(mainStateIndex).toBeGreaterThanOrEqual(0);
    expect(tryIndex).toBeGreaterThanOrEqual(0);
    expect(stageIndex).toBeGreaterThan(tryIndex);
    expect(verifyIndex).toBeGreaterThan(stageIndex);
  });

  it("proves the runner profile is clean before app launch and remains clean", () => {
    const text = nativeHarness();
    const beforeIndex = text.indexOf(
      "evidence.lifecycle.fake_launch_agents_before_app_exists = existsSync(",
    );
    const launchIndex = text.indexOf("browser = await remote(");
    const afterCloseIndex = text.indexOf(
      "evidence.processes.after_close = {",
      launchIndex,
    );
    const afterIndex = text.indexOf(
      "evidence.lifecycle.fake_launch_agents_exists = existsSync(",
      launchIndex,
    );

    expect(beforeIndex).toBeGreaterThanOrEqual(0);
    expect(beforeIndex).toBeLessThan(launchIndex);
    expect(afterCloseIndex).toBeGreaterThan(launchIndex);
    expect(afterIndex).toBeGreaterThan(afterCloseIndex);
  });

  it("drives the guarded native quit route instead of bypassing persistence", () => {
    const text = nativeHarness();

    expect(text).toContain('internals.invoke("request_guarded_quit")');
    expect(text).not.toContain('internals.invoke("quit_wenlan_full")');
  });

  it("runs the native harness and always uploads its complete evidence", () => {
    const text = workflow();

    expect(text).toContain("pnpm test:native:windows `");
    expect(text).not.toContain("pnpm test:native:windows --");
    expect(text).toContain("--evidence-dir windows-native-smoke");
    expect(text).toContain('"semantic-search.json"');
    expect(text).toContain('"processes-after-workload.json"');
    expect(text).toContain("if: always()");
    expect(text).toContain("name: windows-native-smoke");
    expect(text).toContain("path: windows-native-smoke");
    expect(text).toContain("if-no-files-found: warn");
  });

  it("does not weaken the proof into preview, remote desktop, or release work", () => {
    const text = workflow().toLowerCase();

    for (const forbidden of [
      "playwright",
      "vite preview",
      "tauri dev",
      "rdp",
      "remote desktop",
      "ngrok",
      "cloudflared tunnel",
      "tauri_signing_private_key",
      "softprops/action-gh-release",
      "deploy-pages",
      "gh pr merge",
    ]) {
      expect(text, `forbidden workflow content: ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });
});

describe("Windows Rust dependency contract", () => {
  it("keeps crates used by cross-platform modules in common dependencies", () => {
    const text = appCargo();
    const macTarget = '[target.\'cfg(target_os = "macos")\'.dependencies]';
    const commonStart = text.indexOf("[dependencies]");
    const macTargetStart = text.indexOf(macTarget);
    const devStart = text.indexOf("[dev-dependencies]");
    expect(commonStart).toBeGreaterThanOrEqual(0);
    expect(macTargetStart).toBeGreaterThan(commonStart);
    expect(devStart).toBeGreaterThan(macTargetStart);

    const common = text.slice(commonStart, macTargetStart);
    const macOnly = text.slice(macTargetStart, devStart);

    for (const dependency of [
      "wenlan-types",
      "sysinfo",
      "pdf-extract",
      "zip",
    ]) {
      expect(common).toMatch(new RegExp(`^${dependency} = `, "m"));
      expect(macOnly).not.toMatch(new RegExp(`^${dependency} = `, "m"));
    }
  });
});

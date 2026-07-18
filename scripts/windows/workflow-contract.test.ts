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

function workflow(): string {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

function ciWorkflow(): string {
  return readFileSync(CI_WORKFLOW_PATH, "utf8");
}

function appCargo(): string {
  return readFileSync(APP_CARGO_PATH, "utf8");
}

describe("Windows native smoke workflow contract", () => {
  it("is a manual, least-privilege Windows Server 2022 proof", () => {
    const text = workflow();

    expect(text).toContain("workflow_dispatch:");
    expect(text).toContain("runs-on: windows-2022");
    expect(text).toContain("contents: read");
    expect(text).toContain("Windows Server 2022 native compatibility smoke");
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

  it("builds the release-profile native target with exact pinned sidecars", () => {
    const text = workflow();

    expect(text).toContain("TARGET_TRIPLE: x86_64-pc-windows-msvc");
    expect(text).toContain("WENLAN_DOWNLOAD_SIDECARS: \"1\"");
    expect(text).toContain("WENLAN_DATA_DIR=");
    expect(text).toContain("WENLAN_SIDECAR_MANIFEST=");
    const extractionProof =
      "pnpm exec vitest run scripts/download-sidecars.test.ts --maxWorkers=1";
    const nativeBuild =
      "pnpm tauri build --no-bundle --target x86_64-pc-windows-msvc";
    expect(text).toContain(extractionProof);
    expect(text).toContain(nativeBuild);
    expect(text.indexOf(extractionProof)).toBeLessThan(
      text.indexOf(nativeBuild),
    );
    expect(text).toContain("target/x86_64-pc-windows-msvc/release/wenlan-app.exe");
  });

  it("runs the native harness and always uploads its complete evidence", () => {
    const text = workflow();

    expect(text).toContain("pnpm test:native:windows `");
    expect(text).not.toContain("pnpm test:native:windows --");
    expect(text).toContain("--evidence-dir windows-native-smoke");
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

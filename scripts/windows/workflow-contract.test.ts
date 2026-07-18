import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = resolve(
  process.cwd(),
  ".github",
  "workflows",
  "windows-smoke.yml",
);

function workflow(): string {
  return readFileSync(WORKFLOW_PATH, "utf8");
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
    expect(text).toContain(
      "pnpm tauri build --no-bundle --target x86_64-pc-windows-msvc",
    );
    expect(text).toContain("target/x86_64-pc-windows-msvc/release/wenlan-app.exe");
  });

  it("runs the native harness and always uploads its complete evidence", () => {
    const text = workflow();

    expect(text).toContain("pnpm test:native:windows --");
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

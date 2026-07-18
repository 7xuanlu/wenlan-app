import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("sidecar lock workflow consumers", () => {
  it("keeps the release workflow on the strict lock and never downloads latest cloudflared", () => {
    const workflow = read(".github/workflows/release.yml");

    expect(workflow).toContain("node scripts/sidecar-lock.mjs get backend_tag");
    expect(workflow).not.toContain("sed -n '1p' .wenlan-backend-version");
    expect(workflow).not.toContain("cloudflare/cloudflared/releases/latest");
    expect(workflow).not.toContain("CLOUDFLARED_BIN:");
    expect(workflow).toContain("WENLAN_DOWNLOAD_SIDECARS: '1'");
  });

  it("makes the macOS download smoke emit and inspect a verified manifest", () => {
    const workflow = read(".github/workflows/ci.yml");

    expect(workflow).toContain("WENLAN_SIDECAR_MANIFEST:");
    expect(workflow).toContain("staged-sidecars.json");
    expect(workflow).toContain("cloudflared-aarch64-apple-darwin");
  });

  it("updates both backend hashes while preserving the cloudflared lock fields", () => {
    const workflow = read(".github/workflows/backend-pin-bump.yml");

    expect(workflow).toContain("node scripts/sidecar-lock.mjs get backend_tag");
    expect(workflow).toContain("wenlan-darwin-arm64.tar.gz");
    expect(workflow).toContain("wenlan-windows-x64.zip");
    expect(workflow).toContain(
      'node scripts/sidecar-lock.mjs update-backend "$LATEST" "$DARWIN_SHA" "$WINDOWS_SHA"',
    );
    expect(workflow).toContain("cloudflared_version");
    expect(workflow).toContain("node scripts/sidecar-lock.mjs get cloudflared_version");
    expect(workflow).not.toContain("printf '%s\\n%s\\n'");
  });

  it("documents the six-key format at the script ownership boundary", () => {
    const instructions = read("scripts/AGENTS.md");

    expect(instructions).toContain("backend_windows_x64_sha256");
    expect(instructions).toContain("cloudflared_windows_x64_sha256");
    expect(instructions).not.toContain("line 1 is the daemon release tag");
    expect(instructions).not.toContain("cloudflared` is optional");
  });
});

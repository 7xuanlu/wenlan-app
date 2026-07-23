import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const TARGET = "x86_64-pc-windows-msvc";
const COMMIT = "b".repeat(40);

type StageOptions = {
  appBinDir: string;
  backendDir: string;
  cargoTargetDir?: string;
  commit: string;
  manifestPath: string;
  resolveCheckoutCommit?: (backendDir: string) => string;
  targetTriple: string;
  verifyOnly?: boolean;
};

type StageModule = {
  resolveBackendDirectory(input: string, repoRoot?: string): string;
  stageSourceBuiltBackend(options: StageOptions): {
    backendServerSha256: string;
  };
};

async function loadStageModule(): Promise<StageModule> {
  const loaded = await import("./stage-backend-build.mjs").catch(() => null);
  expect(
    loaded,
    "scripts/windows/stage-backend-build.mjs must exist",
  ).not.toBeNull();
  return loaded as StageModule;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "wenlan-stage-backend-"));
  const backendDir = resolve(root, "backend");
  const sourceDir = resolve(backendDir, "target", TARGET, "release");
  const appBinDir = resolve(root, "app", "binaries");
  const manifestPath = resolve(root, "evidence", "staged-sidecars.json");
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(appBinDir, { recursive: true });
  mkdirSync(resolve(root, "evidence"), { recursive: true });

  const sources = {
    "wenlan.exe": "source cli",
    "wenlan-server.exe": "source server",
    "wenlan-mcp.exe": "source mcp",
    "onnxruntime.dll": "source ort",
  };
  for (const [name, content] of Object.entries(sources)) {
    writeFileSync(resolve(sourceDir, name), content);
  }

  const destinations = [
    `wenlan-${TARGET}.exe`,
    `wenlan-server-${TARGET}.exe`,
    `wenlan-mcp-${TARGET}.exe`,
    `cloudflared-${TARGET}.exe`,
    "onnxruntime.dll",
  ];
  for (const name of destinations) {
    writeFileSync(resolve(appBinDir, name), `release ${name}`);
  }
  writeFileSync(
    manifestPath,
    JSON.stringify({
      target_triple: TARGET,
      backend: {
        tag: "v0.13.0",
        repo: "7xuanlu/wenlan",
        asset: "wenlan-windows-x64.zip",
        sha256: "1".repeat(64),
      },
      cloudflared: {
        version: "2026.7.2",
        repo: "cloudflare/cloudflared",
        asset: "cloudflared-windows-amd64.exe",
        sha256: "2".repeat(64),
      },
      staged: destinations.map((name) => ({
        name,
        path: resolve(appBinDir, name),
        sha256: sha256(resolve(appBinDir, name)),
        size: readFileSync(resolve(appBinDir, name)).length,
      })),
    }),
  );

  return { appBinDir, backendDir, manifestPath, sourceDir };
}

describe("Windows source-built backend staging", () => {
  it("replaces only backend payloads and records exact commit and hashes", async () => {
    const { stageSourceBuiltBackend } = await loadStageModule();
    const setup = fixture();
    const cloudflared = resolve(
      setup.appBinDir,
      `cloudflared-${TARGET}.exe`,
    );
    const cloudflaredBefore = readFileSync(cloudflared, "utf8");

    const result = stageSourceBuiltBackend({
      ...setup,
      commit: COMMIT,
      targetTriple: TARGET,
      resolveCheckoutCommit: () => COMMIT,
    });

    const server = resolve(
      setup.appBinDir,
      `wenlan-server-${TARGET}.exe`,
    );
    expect(readFileSync(server, "utf8")).toBe("source server");
    expect(readFileSync(cloudflared, "utf8")).toBe(cloudflaredBefore);
    expect(result.backendServerSha256).toBe(sha256(server));

    const manifest = JSON.parse(readFileSync(setup.manifestPath, "utf8"));
    expect(manifest.backend).toMatchObject({
      source: "source-build",
      repo: "7xuanlu/wenlan",
      commit: COMMIT,
      cargo_profile: "release",
      target_triple: TARGET,
      release_baseline: {
        tag: "v0.13.0",
        asset: "wenlan-windows-x64.zip",
        sha256: "1".repeat(64),
      },
    });
    expect(manifest.staged).toHaveLength(5);
    for (const entry of manifest.staged) {
      expect(entry.sha256).toBe(sha256(entry.path));
    }
  });

  it("verifies the staged result a second time without rewriting it", async () => {
    const { stageSourceBuiltBackend } = await loadStageModule();
    const setup = fixture();
    const options = {
      ...setup,
      commit: COMMIT,
      targetTriple: TARGET,
      resolveCheckoutCommit: () => COMMIT,
    };
    stageSourceBuiltBackend(options);
    const firstManifest = readFileSync(setup.manifestPath, "utf8");

    const verified = stageSourceBuiltBackend({
      ...options,
      verifyOnly: true,
    });

    expect(readFileSync(setup.manifestPath, "utf8")).toBe(firstManifest);
    expect(verified.backendServerSha256).toBe(
      sha256(resolve(setup.appBinDir, `wenlan-server-${TARGET}.exe`)),
    );
  });

  it("stages from an explicit short Cargo target directory", async () => {
    const { stageSourceBuiltBackend } = await loadStageModule();
    const setup = fixture();
    const cargoTargetDir = resolve(setup.backendDir, "..", "wl-target");
    const releaseDir = resolve(cargoTargetDir, TARGET, "release");
    mkdirSync(releaseDir, { recursive: true });
    for (const [name, content] of Object.entries({
      "wenlan.exe": "short target cli",
      "wenlan-server.exe": "short target server",
      "wenlan-mcp.exe": "short target mcp",
      "onnxruntime.dll": "short target ort",
    })) {
      writeFileSync(resolve(releaseDir, name), content);
    }

    stageSourceBuiltBackend({
      ...setup,
      cargoTargetDir,
      commit: COMMIT,
      targetTriple: TARGET,
      resolveCheckoutCommit: () => COMMIT,
    });

    expect(
      readFileSync(
        resolve(setup.appBinDir, `wenlan-server-${TARGET}.exe`),
        "utf8",
      ),
    ).toBe("short target server");
  });

  it("resolves a hook-relative backend checkout from the repository root", async () => {
    const { resolveBackendDirectory } = await loadStageModule();

    expect(resolveBackendDirectory("windows-smoke-backend", "/repo")).toBe(
      resolve("/repo", "windows-smoke-backend"),
    );
  });

  it("rejects a checkout that differs from the immutable commit", async () => {
    const { stageSourceBuiltBackend } = await loadStageModule();
    const setup = fixture();

    expect(() =>
      stageSourceBuiltBackend({
        ...setup,
        commit: COMMIT,
        targetTriple: TARGET,
        resolveCheckoutCommit: () => "c".repeat(40),
      }),
    ).toThrow("backend checkout commit");
  });

  it("rejects a build missing the required ONNX Runtime DLL", async () => {
    const { stageSourceBuiltBackend } = await loadStageModule();
    const setup = fixture();
    writeFileSync(resolve(setup.sourceDir, "onnxruntime.dll.missing"), "");
    const dll = resolve(setup.sourceDir, "onnxruntime.dll");
    expect(existsSync(dll)).toBe(true);
    // Emptying the required payload catches a build/stager that produced no DLL.
    writeFileSync(dll, "");

    expect(() =>
      stageSourceBuiltBackend({
        ...setup,
        commit: COMMIT,
        targetTriple: TARGET,
        resolveCheckoutCommit: () => COMMIT,
      }),
    ).toThrow("required backend build payload");
  });
});

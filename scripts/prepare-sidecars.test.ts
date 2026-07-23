import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  bashExecutable,
  canonicalBashPath,
  canonicalizePathEnvironment,
  minimalBashPath,
  prependNativePath,
} from "./test-platform";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = resolve(root, "scripts/prepare-sidecars.sh");
const tauriBuildScriptPath = resolve(root, "scripts/prepare-tauri-build-sidecars.sh");
const resolverScriptPath = resolve(root, "scripts/resolve-backend-dir.sh");
const lockScriptPath = resolve(root, "scripts/sidecar-lock.mjs");
const downloadScriptPath = resolve(root, "scripts/download-sidecars.mjs");
const extractZipScriptPath = resolve(root, "scripts/extract-zip.ps1");
const tempRoots: string[] = [];
const pathOverrideEnvKeys = new Set([
  "WENLAN_BACKEND_DIR",
  "CARGO_TARGET_DIR",
  "TARGET_TRIPLE",
  "TAURI_ENV_DEBUG",
  "TAURI_ENV_TARGET_TRIPLE",
  "WENLAN_GH_NODE_SCRIPT",
]);

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { force: true, recursive: true, maxRetries: 20, retryDelay: 250 });
  }
});

function makeTempRoot(): string {
  const dir = realpathSync(mkdtempSync(resolve(tmpdir(), "wenlan-app-sidecars-")));
  tempRoots.push(dir);
  return dir;
}

function writeBackendRepo(path: string): void {
  mkdirSync(resolve(path, "crates/wenlan-server"), { recursive: true });
  mkdirSync(resolve(path, "crates/wenlan-mcp"), { recursive: true });
  mkdirSync(resolve(path, "crates/wenlan-cli"), { recursive: true });
  writeFileSync(resolve(path, "Cargo.toml"), "[workspace]\n");
}

function writeExecutable(path: string, content = "#!/usr/bin/env bash\nexit 0\n"): void {
  writeFileSync(path, content, { mode: 0o755 });
}

function writeAppScripts(appRoot: string): void {
  mkdirSync(resolve(appRoot, "scripts"), { recursive: true });
  copyFileSync(scriptPath, resolve(appRoot, "scripts/prepare-sidecars.sh"));
  copyFileSync(tauriBuildScriptPath, resolve(appRoot, "scripts/prepare-tauri-build-sidecars.sh"));
  copyFileSync(resolverScriptPath, resolve(appRoot, "scripts/resolve-backend-dir.sh"));
  copyFileSync(lockScriptPath, resolve(appRoot, "scripts/sidecar-lock.mjs"));
  if (existsSync(downloadScriptPath)) {
    copyFileSync(downloadScriptPath, resolve(appRoot, "scripts/download-sidecars.mjs"));
  }
  if (existsSync(extractZipScriptPath)) {
    copyFileSync(extractZipScriptPath, resolve(appRoot, "scripts/extract-zip.ps1"));
  }
  const testBin = resolve(appRoot, ".test-bin");
  mkdirSync(testBin, { recursive: true });
  writeExecutable(
    resolve(testBin, "rustc"),
    "#!/usr/bin/env bash\nprintf 'host: aarch64-apple-darwin\\n'\n",
  );
}

function childEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (pathOverrideEnvKeys.has(key)) {
      continue;
    }
    childEnv[key] = value;
  }
  return canonicalizePathEnvironment({ ...childEnv, ...overrides });
}

function appChildEnv(
  appRoot: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const inheritedPath = overrides.PATH ?? process.env.PATH ?? "";
  return childEnv({
    ...overrides,
    PATH: prependNativePath(resolve(appRoot, ".test-bin"), inheritedPath),
  });
}

function printPaths(appRoot: string, env: Record<string, string> = {}): string {
  return execFileSync(bashExecutable(), ["scripts/prepare-sidecars.sh", "--print-paths"], {
    cwd: appRoot,
    encoding: "utf8",
    env: appChildEnv(appRoot, env),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function printTauriBuildPaths(appRoot: string, env: Record<string, string> = {}): string {
  return execFileSync(bashExecutable(), ["scripts/prepare-tauri-build-sidecars.sh", "--print-paths"], {
    cwd: appRoot,
    encoding: "utf8",
    env: appChildEnv(appRoot, env),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveBackend(appRoot: string, env: Record<string, string> = {}): string {
  return execFileSync(bashExecutable(), ["scripts/resolve-backend-dir.sh"], {
    cwd: appRoot,
    encoding: "utf8",
    env: childEnv(env),
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("prepare-sidecars backend discovery", () => {
  it("discovers a sibling wenlan backend from a standalone wenlan-app checkout", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    const backendRoot = resolve(base, "wenlan");
    writeAppScripts(appRoot);
    writeBackendRepo(backendRoot);

    const output = printPaths(appRoot);
    const backendPath = canonicalBashPath(backendRoot);

    expect(output).toContain(`server_src=${backendPath}/target/debug/wenlan-server`);
    expect(output).toContain(`mcp_src=${backendPath}/target/debug/wenlan-mcp`);
    expect(output).toContain(`cli_src=${backendPath}/target/debug/wenlan`);
  });

  it("discovers a sibling wenlan backend from a project-local worktree checkout", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app/.worktrees/launch-smoke");
    const backendRoot = resolve(base, "wenlan");
    writeAppScripts(appRoot);
    writeBackendRepo(backendRoot);

    const output = printPaths(appRoot);
    const backendPath = canonicalBashPath(backendRoot);

    expect(output).toContain(`server_src=${backendPath}/target/debug/wenlan-server`);
    expect(output).toContain(`mcp_src=${backendPath}/target/debug/wenlan-mcp`);
    expect(output).toContain(`cli_src=${backendPath}/target/debug/wenlan`);
  });

  it("keeps relative WENLAN_BACKEND_DIR overrides relative to the app checkout", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    const backendRoot = resolve(appRoot, "local-backend");
    writeAppScripts(appRoot);
    writeBackendRepo(backendRoot);

    const output = printPaths(appRoot, { WENLAN_BACKEND_DIR: "local-backend" });
    const backendPath = canonicalBashPath(backendRoot);

    expect(output).toContain(`server_src=${backendPath}/target/debug/wenlan-server`);
    expect(output).toContain(`mcp_src=${backendPath}/target/debug/wenlan-mcp`);
    expect(output).toContain(`cli_src=${backendPath}/target/debug/wenlan`);
  });

  it("uses Tauri target triples when Tauri runs sidecar prep for target builds", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    const backendRoot = resolve(base, "wenlan");
    writeAppScripts(appRoot);
    writeBackendRepo(backendRoot);

    const output = printPaths(appRoot, {
      TAURI_ENV_TARGET_TRIPLE: "x86_64-apple-darwin",
    });
    const appPath = canonicalBashPath(appRoot);
    const backendPath = canonicalBashPath(backendRoot);

    expect(output).toContain(`server_src=${backendPath}/target/x86_64-apple-darwin/debug/wenlan-server`);
    expect(output).toContain(`mcp_src=${backendPath}/target/x86_64-apple-darwin/debug/wenlan-mcp`);
    expect(output).toContain(`cli_src=${backendPath}/target/x86_64-apple-darwin/debug/wenlan`);
    expect(output).toContain(`server_dest=${appPath}/app/binaries/wenlan-server-x86_64-apple-darwin`);
    expect(output).toContain(`mcp_dest=${appPath}/app/binaries/wenlan-mcp-x86_64-apple-darwin`);
    expect(output).toContain(`cli_dest=${appPath}/app/binaries/wenlan-x86_64-apple-darwin`);
  });

  it("uses release sidecars when Tauri runs sidecar prep for release builds", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    const backendRoot = resolve(base, "wenlan");
    writeAppScripts(appRoot);
    writeBackendRepo(backendRoot);

    const output = printPaths(appRoot, {
      TAURI_ENV_DEBUG: "false",
    });
    const backendPath = canonicalBashPath(backendRoot);

    expect(output).toContain(`server_src=${backendPath}/target/release/wenlan-server`);
    expect(output).toContain(`mcp_src=${backendPath}/target/release/wenlan-mcp`);
    expect(output).toContain(`cli_src=${backendPath}/target/release/wenlan`);
  });

  it("uses release sidecars by default from the Tauri build hook", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    const backendRoot = resolve(base, "wenlan");
    writeAppScripts(appRoot);
    writeBackendRepo(backendRoot);

    const output = printTauriBuildPaths(appRoot);
    const backendPath = canonicalBashPath(backendRoot);

    expect(output).toContain(`server_src=${backendPath}/target/release/wenlan-server`);
    expect(output).toContain(`mcp_src=${backendPath}/target/release/wenlan-mcp`);
    expect(output).toContain(`cli_src=${backendPath}/target/release/wenlan`);
  });

  it("uses debug sidecars from the Tauri build hook when Tauri is building debug", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    const backendRoot = resolve(base, "wenlan");
    writeAppScripts(appRoot);
    writeBackendRepo(backendRoot);

    const output = printTauriBuildPaths(appRoot, {
      TAURI_ENV_DEBUG: "true",
    });
    const backendPath = canonicalBashPath(backendRoot);

    expect(output).toContain(`server_src=${backendPath}/target/debug/wenlan-server`);
    expect(output).toContain(`mcp_src=${backendPath}/target/debug/wenlan-mcp`);
    expect(output).toContain(`cli_src=${backendPath}/target/debug/wenlan`);
  });

  it("ignores inherited path overrides while testing default discovery", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    const backendRoot = resolve(base, "wenlan");
    writeAppScripts(appRoot);
    writeBackendRepo(backendRoot);

    const originalBackendDir = process.env.WENLAN_BACKEND_DIR;
    const originalCargoTargetDir = process.env.CARGO_TARGET_DIR;
    const originalTargetTriple = process.env.TARGET_TRIPLE;
    process.env.WENLAN_BACKEND_DIR = resolve(base, "not-a-backend");
    process.env.CARGO_TARGET_DIR = resolve(base, "custom-target");
    process.env.TARGET_TRIPLE = "x86_64-unknown-linux-gnu";
    try {
      const output = printPaths(appRoot);
      const backendPath = canonicalBashPath(backendRoot);

      expect(output).toContain(`server_src=${backendPath}/target/debug/wenlan-server`);
      expect(output).toContain(`mcp_src=${backendPath}/target/debug/wenlan-mcp`);
      expect(output).toContain(`cli_src=${backendPath}/target/debug/wenlan`);
    } finally {
      restoreEnv("WENLAN_BACKEND_DIR", originalBackendDir);
      restoreEnv("CARGO_TARGET_DIR", originalCargoTargetDir);
      restoreEnv("TARGET_TRIPLE", originalTargetTriple);
    }
  });

  it("fails loud for invalid WENLAN_BACKEND_DIR overrides", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    writeAppScripts(appRoot);

    let error: unknown;
    try {
      printPaths(appRoot, { WENLAN_BACKEND_DIR: "not-a-backend" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeTruthy();
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    expect(stderr).toContain("WENLAN_BACKEND_DIR is not a Wenlan backend checkout");
  });

  it("exposes the same backend resolver for dev scripts", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    const backendRoot = resolve(base, "wenlan");
    writeAppScripts(appRoot);
    writeBackendRepo(backendRoot);

    expect(resolveBackend(appRoot)).toBe(canonicalBashPath(backendRoot));
  });

  it("uses the shared backend resolver from dev:daemon", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const devDaemon = String(packageJson.scripts["dev:daemon"]);

    expect(devDaemon).toContain("scripts/resolve-backend-dir.sh");
    expect(devDaemon).toContain("BACKEND=$(bash scripts/resolve-backend-dir.sh) && cargo build");
    expect(devDaemon).not.toContain("${WENLAN_BACKEND_DIR:-../..}");
  });

  it("uses the release-aware sidecar prep wrapper from Tauri build config", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const tauri = JSON.parse(readFileSync(resolve(root, "app/tauri.conf.json"), "utf8"));

    expect(packageJson.scripts["prepare:sidecars:tauri-build"]).toBe(
      "bash scripts/prepare-tauri-build-sidecars.sh",
    );
    expect(tauri.build.beforeDevCommand).toContain("pnpm prepare:sidecars");
    expect(tauri.build.beforeBuildCommand).toContain("pnpm prepare:sidecars:tauri-build");
  });

  it("does not reach cargo when dev:daemon backend resolution fails", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const devDaemon = String(packageJson.scripts["dev:daemon"]);
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    const binRoot = resolve(base, "bin");
    writeAppScripts(appRoot);
    mkdirSync(binRoot, { recursive: true });
    writeFileSync(resolve(binRoot, "cargo"), "#!/usr/bin/env bash\necho cargo should not run >&2\nexit 99\n", { mode: 0o755 });

    const result = spawnSync(bashExecutable(), ["-c", devDaemon], {
      cwd: appRoot,
      encoding: "utf8",
      env: childEnv({
        WENLAN_BACKEND_DIR: "not-a-backend",
        PATH: prependNativePath(binRoot),
      }),
    });

    expect(
      result.status,
      `stdout: ${result.stdout ?? ""}\nstderr: ${result.stderr ?? ""}`,
    ).toBe(1);
    expect(result.stderr).toContain("WENLAN_BACKEND_DIR is not a Wenlan backend checkout");
    expect(result.stderr).not.toContain("cargo should not run");
  });

  it("fails loud when cloudflared is required but missing", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    const backendRoot = resolve(base, "wenlan");
    const binRoot = resolve(base, "bin");
    writeAppScripts(appRoot);
    writeBackendRepo(backendRoot);
    mkdirSync(resolve(backendRoot, "target/debug"), { recursive: true });
    writeExecutable(resolve(backendRoot, "target/debug/wenlan-server"));
    writeExecutable(resolve(backendRoot, "target/debug/wenlan-mcp"));
    writeExecutable(resolve(backendRoot, "target/debug/wenlan"));
    mkdirSync(binRoot, { recursive: true });
    writeExecutable(
      resolve(binRoot, "rustc"),
      "#!/usr/bin/env bash\nprintf 'host: aarch64-apple-darwin\\n'\n",
    );

    const result = spawnSync(bashExecutable(), ["scripts/prepare-sidecars.sh"], {
      cwd: appRoot,
      encoding: "utf8",
      env: childEnv({
        PATH: prependNativePath(binRoot, minimalBashPath()),
      }),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cloudflared not found in PATH");
    expect(result.stderr).toContain("Required by Tauri externalBin");
  }, 15_000);
});

const DARWIN_DEST_NAMES = [
  "wenlan-aarch64-apple-darwin",
  "wenlan-server-aarch64-apple-darwin",
  "wenlan-mcp-aarch64-apple-darwin",
  "cloudflared-aarch64-apple-darwin",
];

function fakeBinaryContents(name: string): string {
  return `#!/usr/bin/env bash\necho fake-${name}\n`;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

interface FakeAssets {
  paths: Record<string, string>;
  hashes: {
    backendDarwin: string;
    backendWindows: string;
    cloudflaredDarwin: string;
    cloudflaredWindows: string;
  };
}

function buildFakeAssets(dir: string, options: { omitWindowsDll?: boolean } = {}): FakeAssets {
  const darwinContents = resolve(dir, "darwin-contents");
  mkdirSync(darwinContents, { recursive: true });
  for (const name of ["wenlan", "wenlan-server", "wenlan-mcp"]) {
    writeFileSync(resolve(darwinContents, name), fakeBinaryContents(name), { mode: 0o755 });
  }
  const darwinBackend = resolve(dir, "wenlan-darwin-arm64.tar.gz");
  execFileSync("tar", [
    "czf",
    darwinBackend,
    "-C",
    darwinContents,
    "wenlan",
    "wenlan-server",
    "wenlan-mcp",
  ]);

  const darwinCloudContents = resolve(dir, "darwin-cloud-contents");
  mkdirSync(darwinCloudContents, { recursive: true });
  writeFileSync(
    resolve(darwinCloudContents, "cloudflared"),
    fakeBinaryContents("cloudflared"),
    { mode: 0o755 },
  );
  const darwinCloudflared = resolve(dir, "cloudflared-darwin-arm64.tgz");
  execFileSync("tar", [
    "czf",
    darwinCloudflared,
    "-C",
    darwinCloudContents,
    "cloudflared",
  ]);

  const windowsContents = resolve(dir, "windows-contents");
  mkdirSync(windowsContents, { recursive: true });
  for (const name of ["wenlan.exe", "wenlan-server.exe", "wenlan-mcp.exe"]) {
    writeFileSync(resolve(windowsContents, name), `fake-${name}\n`);
  }
  if (!options.omitWindowsDll) {
    writeFileSync(resolve(windowsContents, "onnxruntime.dll"), "fake-onnxruntime\n");
  }
  const windowsBackend = resolve(dir, "wenlan-windows-x64.zip");
  const windowsPayload = ["wenlan.exe", "wenlan-server.exe", "wenlan-mcp.exe"];
  if (!options.omitWindowsDll) windowsPayload.push("onnxruntime.dll");
  const windowsArchive = Object.fromEntries(
    windowsPayload.map((name) => [
      name,
      new Uint8Array(readFileSync(resolve(windowsContents, name))),
    ]),
  );
  writeFileSync(windowsBackend, zipSync(windowsArchive));

  const windowsCloudflared = resolve(dir, "cloudflared-windows-amd64.exe");
  writeFileSync(windowsCloudflared, "fake-cloudflared-windows\n");

  return {
    paths: {
      "wenlan-darwin-arm64.tar.gz": darwinBackend,
      "wenlan-windows-x64.zip": windowsBackend,
      "cloudflared-darwin-arm64.tgz": darwinCloudflared,
      "cloudflared-windows-amd64.exe": windowsCloudflared,
    },
    hashes: {
      backendDarwin: sha256(darwinBackend),
      backendWindows: sha256(windowsBackend),
      cloudflaredDarwin: sha256(darwinCloudflared),
      cloudflaredWindows: sha256(windowsCloudflared),
    },
  };
}

function writeSidecarLock(
  appRoot: string,
  assets: FakeAssets,
  overrides: Partial<FakeAssets["hashes"]> = {},
): void {
  const hashes = { ...assets.hashes, ...overrides };
  writeFileSync(
    resolve(appRoot, ".wenlan-backend-version"),
    [
      "backend_tag=v0.9.5",
      `backend_darwin_arm64_sha256=${hashes.backendDarwin}`,
      `backend_windows_x64_sha256=${hashes.backendWindows}`,
      "cloudflared_version=2026.7.2",
      `cloudflared_darwin_arm64_sha256=${hashes.cloudflaredDarwin}`,
      `cloudflared_windows_x64_sha256=${hashes.cloudflaredWindows}`,
      "",
    ].join("\n"),
  );
}

function writeFakeGh(
  binDir: string,
  opts: { assets?: Record<string, string>; exitCode?: number },
): void {
  mkdirSync(binDir, { recursive: true });
  if (!opts.assets) {
    const exitCode = opts.exitCode ?? 1;
    writeFileSync(resolve(binDir, "fake-gh.cjs"), `process.exit(${exitCode});\n`);
    return;
  }

  const scriptBody = [
    'const { copyFileSync, mkdirSync } = require("node:fs");',
    `const assets = ${JSON.stringify(opts.assets)};`,
    "const args = process.argv.slice(2);",
    'const pattern = args[args.indexOf("--pattern") + 1];',
    'const dir = args[args.indexOf("--dir") + 1];',
    "if (!pattern || !dir || !assets[pattern]) {",
    '  console.error(`fake-gh: unsupported download ${pattern ?? "<missing>"}`);',
    "  process.exit(17);",
    "}",
    "mkdirSync(dir, { recursive: true });",
    'copyFileSync(assets[pattern], `${dir}/${pattern}`);',
    "",
  ].join("\n");
  const scriptPath = resolve(binDir, "fake-gh.cjs");
  writeFileSync(scriptPath, scriptBody);
}

function writeFakeXattr(binDir: string, logPath: string): void {
  mkdirSync(binDir, { recursive: true });
  writeFileSync(resolve(binDir, "xattr"), `#!/usr/bin/env bash\necho "$@" >> "${logPath}"\n`, {
    mode: 0o755,
  });
}

function runDownload(appRoot: string, env: Record<string, string> = {}) {
  return spawnSync(bashExecutable(), ["scripts/prepare-sidecars.sh", "--download"], {
    cwd: appRoot,
    encoding: "utf8",
    env: childEnv(env),
  });
}

function withFakeBin(fakeBinDir: string): Record<string, string> {
  return {
    PATH: prependNativePath(fakeBinDir),
    WENLAN_GH_NODE_SCRIPT: resolve(fakeBinDir, "fake-gh.cjs"),
  };
}

function wrongHash(hash: string): string {
  return hash.slice(0, -1) + (hash.endsWith("0") ? "1" : "0");
}

describe("prepare-sidecars --download mode", () => {
  it("installs verified Darwin backend and cloudflared sidecars", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    writeAppScripts(appRoot);

    const assets = buildFakeAssets(base);
    writeSidecarLock(appRoot, assets);

    const fakeBinDir = resolve(base, "fake-bin");
    writeFakeGh(fakeBinDir, { assets: assets.paths });

    const result = runDownload(appRoot, {
      ...withFakeBin(fakeBinDir),
      TARGET_TRIPLE: "aarch64-apple-darwin",
    });

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    for (const destName of DARWIN_DEST_NAMES) {
      const dest = resolve(appRoot, "app/binaries", destName);
      expect(existsSync(dest), dest).toBe(true);
      if (process.platform !== "win32") {
        expect(statSync(dest).mode & 0o777).toBe(0o755);
      }
    }
    expect(
      readFileSync(
        resolve(appRoot, "app/binaries/wenlan-server-aarch64-apple-darwin"),
        "utf8",
      ),
    ).toBe(fakeBinaryContents("wenlan-server"));
    expect(
      readFileSync(
        resolve(appRoot, "app/binaries/cloudflared-aarch64-apple-darwin"),
        "utf8",
      ),
    ).toBe(fakeBinaryContents("cloudflared"));
  });

  it("installs the Windows executables and onnxruntime.dll with the required names", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    writeAppScripts(appRoot);

    const assets = buildFakeAssets(base);
    writeSidecarLock(appRoot, assets);
    const fakeBinDir = resolve(base, "fake-bin");
    writeFakeGh(fakeBinDir, { assets: assets.paths });
    const manifestPath = resolve(base, "staged-sidecars.json");

    const result = runDownload(appRoot, {
      ...withFakeBin(fakeBinDir),
      TARGET_TRIPLE: "x86_64-pc-windows-msvc",
      WENLAN_SIDECAR_MANIFEST: manifestPath,
    });

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    const expected = [
      "wenlan-x86_64-pc-windows-msvc.exe",
      "wenlan-server-x86_64-pc-windows-msvc.exe",
      "wenlan-mcp-x86_64-pc-windows-msvc.exe",
      "cloudflared-x86_64-pc-windows-msvc.exe",
      "onnxruntime.dll",
    ];
    for (const name of expected) {
      expect(existsSync(resolve(appRoot, "app/binaries", name)), name).toBe(true);
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest).toMatchObject({
      target_triple: "x86_64-pc-windows-msvc",
      backend: {
        tag: "v0.9.5",
        asset: "wenlan-windows-x64.zip",
        sha256: assets.hashes.backendWindows,
      },
      cloudflared: {
        version: "2026.7.2",
        asset: "cloudflared-windows-amd64.exe",
        sha256: assets.hashes.cloudflaredWindows,
      },
    });
    expect(manifest.staged).toHaveLength(5);
    expect(
      manifest.staged.every((entry: { sha256?: string }) =>
        /^[0-9a-f]{64}$/.test(entry.sha256 ?? ""),
      ),
    ).toBe(true);
  }, 15_000);

  it("fails loud and installs nothing when a release asset download fails", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    writeAppScripts(appRoot);

    const assets = buildFakeAssets(base);
    writeSidecarLock(appRoot, assets);
    const fakeBinDir = resolve(base, "fake-bin");
    writeFakeGh(fakeBinDir, { exitCode: 17 });

    const result = runDownload(appRoot, {
      ...withFakeBin(fakeBinDir),
      TARGET_TRIPLE: "aarch64-apple-darwin",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("failed to download");
    for (const destName of DARWIN_DEST_NAMES) {
      expect(existsSync(resolve(appRoot, "app/binaries", destName))).toBe(false);
    }
  });

  it.each([
    ["backend", "backendDarwin"],
    ["cloudflared", "cloudflaredDarwin"],
  ] as const)("fails loud on a corrupt %s checksum and installs nothing", (_, key) => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    writeAppScripts(appRoot);

    const assets = buildFakeAssets(base);
    writeSidecarLock(appRoot, assets, { [key]: wrongHash(assets.hashes[key]) });
    const fakeBinDir = resolve(base, "fake-bin");
    writeFakeGh(fakeBinDir, { assets: assets.paths });

    const result = runDownload(appRoot, {
      ...withFakeBin(fakeBinDir),
      TARGET_TRIPLE: "aarch64-apple-darwin",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("sha256 mismatch");
    for (const destName of DARWIN_DEST_NAMES) {
      expect(existsSync(resolve(appRoot, "app/binaries", destName))).toBe(false);
    }
  });

  it("fails before staging when the Windows archive omits onnxruntime.dll", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    writeAppScripts(appRoot);

    const assets = buildFakeAssets(base, { omitWindowsDll: true });
    writeSidecarLock(appRoot, assets);
    const fakeBinDir = resolve(base, "fake-bin");
    writeFakeGh(fakeBinDir, { assets: assets.paths });

    const result = runDownload(appRoot, {
      ...withFakeBin(fakeBinDir),
      TARGET_TRIPLE: "x86_64-pc-windows-msvc",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing required payload onnxruntime.dll");
    expect(existsSync(resolve(appRoot, "app/binaries"))).toBe(false);
  });

  it("downloads sidecars from the Tauri build hook when WENLAN_DOWNLOAD_SIDECARS=1", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    writeAppScripts(appRoot);

    const assets = buildFakeAssets(base);
    writeSidecarLock(appRoot, assets);
    const fakeBinDir = resolve(base, "fake-bin");
    writeFakeGh(fakeBinDir, { assets: assets.paths });

    const result = spawnSync(bashExecutable(), ["scripts/prepare-tauri-build-sidecars.sh"], {
      cwd: appRoot,
      encoding: "utf8",
      env: childEnv({
        ...withFakeBin(fakeBinDir),
        WENLAN_DOWNLOAD_SIDECARS: "1",
        TARGET_TRIPLE: "x86_64-pc-windows-msvc",
      }),
    });

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(
      existsSync(
        resolve(
          appRoot,
          "app/binaries/wenlan-server-x86_64-pc-windows-msvc.exe",
        ),
      ),
    ).toBe(true);
    expect(existsSync(resolve(appRoot, "app/binaries/onnxruntime.dll"))).toBe(true);
  });

  it("fails closed if a source-build manifest survives but its prestaged flag is lost", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    writeAppScripts(appRoot);
    const manifestPath = resolve(base, "staged-sidecars.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        target_triple: "x86_64-pc-windows-msvc",
        backend: {
          source: "source-build",
          commit: "b".repeat(40),
        },
      }),
    );

    const result = spawnSync(bashExecutable(), ["scripts/prepare-tauri-build-sidecars.sh"], {
      cwd: appRoot,
      encoding: "utf8",
      env: appChildEnv(appRoot, {
        WENLAN_DOWNLOAD_SIDECARS: "1",
        WENLAN_SIDECAR_MANIFEST: manifestPath,
      }),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "source-built sidecar manifest requires WENLAN_PRESTAGED_SIDECARS=1",
    );
  });

  it.runIf(process.platform === "darwin")(
    "strips quarantine via xattr -cr on each installed Darwin sidecar",
    () => {
      const base = makeTempRoot();
      const appRoot = resolve(base, "wenlan-app");
      writeAppScripts(appRoot);

      const assets = buildFakeAssets(base);
      writeSidecarLock(appRoot, assets);
      const fakeBinDir = resolve(base, "fake-bin");
      writeFakeGh(fakeBinDir, { assets: assets.paths });
      const xattrLog = resolve(base, "xattr.log");
      writeFakeXattr(fakeBinDir, xattrLog);

      const result = runDownload(appRoot, {
        ...withFakeBin(fakeBinDir),
        TARGET_TRIPLE: "aarch64-apple-darwin",
      });

      expect(result.status, `stderr: ${result.stderr}`).toBe(0);
      const log = readFileSync(xattrLog, "utf8");
      for (const destName of DARWIN_DEST_NAMES) {
        expect(log).toContain(`-cr ${resolve(appRoot, "app/binaries", destName)}`);
      }
    },
  );
});

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET = "x86_64-pc-windows-msvc";
const PROFILE = "release";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function checkoutCommit(backendDir) {
  const result = spawnSync(
    "git",
    ["-C", backendDir, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `could not resolve backend checkout commit: ${String(result.stderr || result.stdout).trim()}`,
    );
  }
  return String(result.stdout).trim().toLowerCase();
}

function parseManifest(path) {
  if (!existsSync(path)) {
    throw new Error(`release-baseline sidecar manifest does not exist: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(
      `could not parse release-baseline sidecar manifest ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function requiredFile(path) {
  if (!existsSync(path) || statSync(path).size <= 0) {
    throw new Error(`required backend build payload is missing or empty: ${path}`);
  }
}

export function resolveBackendDirectory(input, repoRoot = REPO_ROOT) {
  return resolve(isAbsolute(input) ? input : resolve(repoRoot, input));
}

function resolveCargoTargetDirectory(input, backendDir) {
  if (!input) return resolve(backendDir, "target");
  return resolve(isAbsolute(input) ? input : resolve(backendDir, input));
}

export function stageSourceBuiltBackend(options) {
  const backendDir = resolveBackendDirectory(options.backendDir);
  const cargoTargetDir = resolveCargoTargetDirectory(
    options.cargoTargetDir,
    backendDir,
  );
  const appBinDir = resolve(
    options.appBinDir || resolve(REPO_ROOT, "app", "binaries"),
  );
  const manifestPath = resolve(options.manifestPath);
  const targetTriple = options.targetTriple || TARGET;
  const expectedCommit = String(options.commit || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
    throw new Error("backend commit must be an exact lowercase 40-character SHA");
  }
  if (targetTriple !== TARGET) {
    throw new Error(`unsupported source-built backend target ${targetTriple}`);
  }

  const resolveCheckoutCommit =
    options.resolveCheckoutCommit || checkoutCommit;
  const actualCommit = String(resolveCheckoutCommit(backendDir))
    .trim()
    .toLowerCase();
  if (actualCommit !== expectedCommit) {
    throw new Error(
      `backend checkout commit ${actualCommit || "<empty>"} does not match pinned ${expectedCommit}`,
    );
  }

  const manifest = parseManifest(manifestPath);
  if (manifest.target_triple !== targetTriple) {
    throw new Error(
      `sidecar manifest target ${manifest.target_triple || "<missing>"} does not match ${targetTriple}`,
    );
  }
  if (!manifest.cloudflared || !Array.isArray(manifest.staged)) {
    throw new Error("sidecar manifest is missing cloudflared or staged payloads");
  }
  const verifyOnly = options.verifyOnly === true;
  const releaseBaseline = verifyOnly
    ? manifest.backend?.release_baseline
    : manifest.backend;
  if (
    !releaseBaseline ||
    !releaseBaseline.tag ||
    !releaseBaseline.asset ||
    !releaseBaseline.sha256
  ) {
    throw new Error("sidecar manifest is missing its release backend baseline");
  }
  if (
    verifyOnly &&
    (manifest.backend?.source !== "source-build" ||
      manifest.backend?.commit !== expectedCommit ||
      manifest.backend?.cargo_profile !== PROFILE ||
      manifest.backend?.target_triple !== targetTriple)
  ) {
    throw new Error(
      `sidecar manifest does not match source-built backend commit ${expectedCommit}`,
    );
  }

  const sourceDir = resolve(
    cargoTargetDir,
    targetTriple,
    PROFILE,
  );
  const payloads = [
    ["wenlan.exe", `wenlan-${targetTriple}.exe`],
    ["wenlan-server.exe", `wenlan-server-${targetTriple}.exe`],
    ["wenlan-mcp.exe", `wenlan-mcp-${targetTriple}.exe`],
    ["onnxruntime.dll", "onnxruntime.dll"],
  ];

  if (verifyOnly) {
    const expectedNames = new Set([
      ...payloads.map(([, destinationName]) => destinationName),
      `cloudflared-${targetTriple}.exe`,
    ]);
    if (
      manifest.staged.length !== expectedNames.size ||
      manifest.staged.some((entry) => !expectedNames.has(entry?.name))
    ) {
      throw new Error("sidecar manifest staged payload set is not exact");
    }
    for (const [sourceName, destinationName] of payloads) {
      const source = resolve(sourceDir, sourceName);
      const destination = resolve(appBinDir, destinationName);
      requiredFile(source);
      requiredFile(destination);
      const entry = manifest.staged.find(
        (candidate) => candidate?.name === destinationName,
      );
      if (
        !entry ||
        entry.path !== destination ||
        entry.sha256 !== sha256(source) ||
        entry.sha256 !== sha256(destination) ||
        entry.size !== statSync(destination).size
      ) {
        throw new Error(
          `staged backend payload diverged from manifest: ${destinationName}`,
        );
      }
    }
    const cloudflaredName = `cloudflared-${targetTriple}.exe`;
    const cloudflaredPath = resolve(appBinDir, cloudflaredName);
    requiredFile(cloudflaredPath);
    const cloudflared = manifest.staged.find(
      (entry) => entry?.name === cloudflaredName,
    );
    if (
      !cloudflared ||
      cloudflared.path !== cloudflaredPath ||
      cloudflared.sha256 !== sha256(cloudflaredPath) ||
      cloudflared.size !== statSync(cloudflaredPath).size
    ) {
      throw new Error("staged cloudflared payload diverged from manifest");
    }
    const server = manifest.staged.find(
      (entry) => entry.name === `wenlan-server-${targetTriple}.exe`,
    );
    return {
      backendServerSha256: server.sha256,
      commit: expectedCommit,
      manifestPath,
    };
  }

  mkdirSync(appBinDir, { recursive: true });
  for (const [sourceName, destinationName] of payloads) {
    const source = resolve(sourceDir, sourceName);
    requiredFile(source);
    copyFileSync(source, resolve(appBinDir, destinationName));
  }

  const requiredDestinations = [
    `wenlan-${targetTriple}.exe`,
    `wenlan-server-${targetTriple}.exe`,
    `wenlan-mcp-${targetTriple}.exe`,
    `cloudflared-${targetTriple}.exe`,
    "onnxruntime.dll",
  ];
  const staged = requiredDestinations.map((name) => {
    const path = resolve(appBinDir, name);
    requiredFile(path);
    return {
      name,
      path,
      sha256: sha256(path),
      size: statSync(path).size,
    };
  });

  const recordedReleaseBaseline = {
    tag: releaseBaseline.tag,
    repo: releaseBaseline.repo,
    asset: releaseBaseline.asset,
    sha256: releaseBaseline.sha256,
  };
  manifest.backend = {
    source: "source-build",
    repo: "7xuanlu/wenlan",
    commit: expectedCommit,
    cargo_profile: PROFILE,
    target_triple: targetTriple,
    release_baseline: recordedReleaseBaseline,
  };
  manifest.staged = staged;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const serverName = `wenlan-server-${targetTriple}.exe`;
  const server = staged.find((entry) => entry.name === serverName);
  return {
    backendServerSha256: server.sha256,
    commit: expectedCommit,
    manifestPath,
  };
}

function parseArgs(argv) {
  const parsed = {
    appBinDir: "",
    backendDir: process.env.WENLAN_WINDOWS_BACKEND_BUILD_DIR || "",
    cargoTargetDir:
      process.env.WENLAN_WINDOWS_BACKEND_CARGO_TARGET_DIR || "",
    commit:
      process.env.WENLAN_BACKEND_SMOKE_COMMIT ||
      process.env.WENLAN_BACKEND_COMMIT ||
      "",
    manifestPath: process.env.WENLAN_SIDECAR_MANIFEST || "",
    targetTriple: process.env.TARGET_TRIPLE || TARGET,
    verifyOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--verify-only") {
      parsed.verifyOnly = true;
      continue;
    }
    if (arg === "--backend-dir" && next) parsed.backendDir = next;
    else if (arg === "--cargo-target-dir" && next) {
      parsed.cargoTargetDir = next;
    } else if (arg === "--commit" && next) parsed.commit = next;
    else if (arg === "--manifest" && next) parsed.manifestPath = next;
    else if (arg === "--app-bin-dir" && next) parsed.appBinDir = next;
    else if (arg === "--target" && next) parsed.targetTriple = next;
    else {
      throw new Error(
        "usage: node scripts/windows/stage-backend-build.mjs --backend-dir <path> --commit <sha> --manifest <path> [--cargo-target-dir <path>] [--app-bin-dir <path>] [--target <triple>] [--verify-only]",
      );
    }
    index += 1;
  }
  if (!parsed.backendDir || !parsed.commit || !parsed.manifestPath) {
    throw new Error(
      "backend directory, exact commit, and sidecar manifest are required",
    );
  }
  return parsed;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    const result = stageSourceBuiltBackend(parseArgs(process.argv.slice(2)));
    console.log(
      `Staged Windows backend commit ${result.commit} (wenlan-server sha256 ${result.backendServerSha256})`,
    );
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

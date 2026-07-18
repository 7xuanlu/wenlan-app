import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  readSidecarLock,
  sidecarSpecForTarget,
} from "./sidecar-lock.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const BIN_DIR = resolve(REPO_ROOT, "app", "binaries");

function parseArgs(argv) {
  const parsed = {
    target: process.env.TARGET_TRIPLE || process.env.TAURI_ENV_TARGET_TRIPLE || "",
    manifest: process.env.WENLAN_SIDECAR_MANIFEST || "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--target" && argv[index + 1]) {
      parsed.target = argv[index + 1];
      index += 1;
    } else if (argument === "--manifest" && argv[index + 1]) {
      parsed.manifest = argv[index + 1];
      index += 1;
    } else {
      throw new Error(
        "usage: node scripts/download-sidecars.mjs [--target <triple>] [--manifest <path>]",
      );
    }
  }
  return parsed;
}

function command(commandName, args, failureMessage) {
  const result = spawnSync(commandName, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(`${failureMessage}${detail ? `: ${detail}` : ""}`);
  }
  return String(result.stdout || "");
}

function hostTriple() {
  const output = command("rustc", ["-vV"], "failed to resolve rustc host triple");
  const match = /^host:\s+(\S+)$/m.exec(output);
  if (!match) {
    throw new Error("rustc -vV did not report a host triple");
  }
  return match[1];
}

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function verifySha256(path, expected, asset) {
  const actual = fileSha256(path);
  if (actual !== expected) {
    throw new Error(
      `sha256 mismatch for ${asset} (pinned ${expected}, got ${actual})`,
    );
  }
}

function downloadReleaseAsset(product, destination) {
  command(
    "gh",
    [
      "release",
      "download",
      product.tag,
      "--repo",
      product.repo,
      "--pattern",
      product.asset,
      "--dir",
      destination,
      "--clobber",
    ],
    `failed to download ${product.asset} from ${product.repo} release ${product.tag}`,
  );
  const path = resolve(destination, product.asset);
  if (!existsSync(path)) {
    throw new Error(
      `${product.asset} was not present after downloading ${product.repo} release ${product.tag}`,
    );
  }
  verifySha256(path, product.sha256, product.asset);
  return path;
}

function findByBasename(root, expectedName) {
  const matches = [];
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) {
        visit(child);
      } else if (entry.isFile() && entry.name === expectedName) {
        matches.push(child);
      }
    }
  };
  visit(root);
  if (matches.length === 0) {
    throw new Error(`missing required payload ${expectedName}`);
  }
  if (matches.length > 1) {
    throw new Error(`archive contains duplicate payload ${expectedName}`);
  }
  return matches[0];
}

function resolvePayload(product, downloadedPath, extractRoot) {
  if (product.format === "file") {
    const expected = product.payload[0];
    if (basename(downloadedPath) !== expected.source) {
      throw new Error(`missing required payload ${expected.source}`);
    }
    return [{ ...expected, sourcePath: downloadedPath }];
  }

  mkdirSync(extractRoot, { recursive: true });
  command(
    "tar",
    ["-xf", downloadedPath, "-C", extractRoot],
    `failed to extract ${product.asset}`,
  );
  return product.payload.map((entry) => ({
    ...entry,
    sourcePath: findByBasename(extractRoot, entry.source),
  }));
}

function stripQuarantine(path) {
  if (process.platform !== "darwin") return;
  const result = spawnSync("xattr", ["-cr", path], { encoding: "utf8" });
  if (
    result.error &&
    "code" in result.error &&
    result.error.code === "ENOENT"
  ) {
    return;
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || "").trim();
    throw new Error(`xattr -cr failed for ${path}${detail ? `: ${detail}` : ""}`);
  }
}

function stagePayload(payload, stagingRoot) {
  mkdirSync(stagingRoot, { recursive: true });
  return payload.map((entry) => {
    const stagedPath = resolve(stagingRoot, entry.destination);
    copyFileSync(entry.sourcePath, stagedPath);
    chmodSync(stagedPath, 0o755);
    return {
      ...entry,
      stagedPath,
      sha256: fileSha256(stagedPath),
      size: statSync(stagedPath).size,
    };
  });
}

function installPayload(staged) {
  mkdirSync(BIN_DIR, { recursive: true });
  for (const entry of staged) {
    const destinationPath = resolve(BIN_DIR, entry.destination);
    rmSync(destinationPath, { force: true });
    renameSync(entry.stagedPath, destinationPath);
    stripQuarantine(destinationPath);
    entry.destinationPath = destinationPath;
  }
}

function writeManifest(path, spec, staged) {
  if (!path) return;
  const manifestPath = resolve(path);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        target_triple: spec.targetTriple,
        backend: {
          tag: spec.backend.tag,
          repo: spec.backend.repo,
          asset: spec.backend.asset,
          sha256: spec.backend.sha256,
        },
        cloudflared: {
          version: spec.cloudflared.tag,
          repo: spec.cloudflared.repo,
          asset: spec.cloudflared.asset,
          sha256: spec.cloudflared.sha256,
        },
        staged: staged.map((entry) => ({
          name: entry.destination,
          path: entry.destinationPath,
          sha256: entry.sha256,
          size: entry.size,
        })),
      },
      null,
      2,
    )}\n`,
  );
}

export function prepareDownloadedSidecars(options = {}) {
  const target = options.target || hostTriple();
  const lock = readSidecarLock();
  const spec = sidecarSpecForTarget(lock, target);
  const tempRoot = mkdtempSync(resolve(tmpdir(), "wenlan-sidecars-"));
  try {
    const backendPath = downloadReleaseAsset(
      spec.backend,
      resolve(tempRoot, "downloads", "backend"),
    );
    const cloudflaredPath = downloadReleaseAsset(
      spec.cloudflared,
      resolve(tempRoot, "downloads", "cloudflared"),
    );
    const payload = [
      ...resolvePayload(
        spec.backend,
        backendPath,
        resolve(tempRoot, "extracted", "backend"),
      ),
      ...resolvePayload(
        spec.cloudflared,
        cloudflaredPath,
        resolve(tempRoot, "extracted", "cloudflared"),
      ),
    ];
    const staged = stagePayload(payload, resolve(tempRoot, "staged"));
    installPayload(staged);
    writeManifest(options.manifest, spec, staged);
    return spec;
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const spec = prepareDownloadedSidecars({
      target: options.target || hostTriple(),
      manifest: options.manifest,
    });
    console.log(
      `Prepared verified sidecars in ${BIN_DIR} for ${spec.targetTriple} (${spec.backend.tag}, cloudflared ${spec.cloudflared.tag})`,
    );
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

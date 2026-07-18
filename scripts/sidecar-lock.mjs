import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_SIDECAR_LOCK_KEYS = Object.freeze([
  "backend_tag",
  "backend_darwin_arm64_sha256",
  "backend_windows_x64_sha256",
  "cloudflared_version",
  "cloudflared_darwin_arm64_sha256",
  "cloudflared_windows_x64_sha256",
]);

const LOCK_KEY_SET = new Set(REQUIRED_SIDECAR_LOCK_KEYS);
const SHA_KEYS = REQUIRED_SIDECAR_LOCK_KEYS.filter((key) => key.endsWith("_sha256"));
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOCK_PATH = resolve(SCRIPT_DIR, "..", ".wenlan-backend-version");

export function parseSidecarLock(text) {
  const lock = {};
  const lines = text.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    if (rawLine === "") continue;
    const match = /^([a-z0-9_]+)=([^\s=]+)$/.exec(rawLine);
    if (!match) {
      throw new Error(`malformed line ${index + 1} in sidecar lock`);
    }
    const [, key, value] = match;
    if (!LOCK_KEY_SET.has(key)) {
      throw new Error(`unknown key ${key} in sidecar lock`);
    }
    if (Object.hasOwn(lock, key)) {
      throw new Error(`duplicate key ${key} in sidecar lock`);
    }
    lock[key] = value;
  }

  for (const key of REQUIRED_SIDECAR_LOCK_KEYS) {
    if (!Object.hasOwn(lock, key)) {
      throw new Error(`missing required key ${key} in sidecar lock`);
    }
  }
  for (const key of SHA_KEYS) {
    if (!/^[0-9a-f]{64}$/.test(lock[key])) {
      throw new Error(`${key} must be a lowercase SHA-256`);
    }
  }
  if (!/^v[0-9][0-9A-Za-z._+-]*$/.test(lock.backend_tag)) {
    throw new Error("backend_tag must start with v");
  }
  if (!/^[0-9A-Za-z._+-]+$/.test(lock.cloudflared_version)) {
    throw new Error("cloudflared_version contains unsafe path characters");
  }

  return Object.freeze(lock);
}

export function readSidecarLock(path = DEFAULT_LOCK_PATH) {
  return parseSidecarLock(readFileSync(path, "utf8"));
}

function backendPayload(targetTriple, extension) {
  return ["wenlan", "wenlan-server", "wenlan-mcp"].map((name) => ({
    source: `${name}${extension}`,
    destination: `${name}-${targetTriple}${extension}`,
  }));
}

export function sidecarSpecForTarget(lock, targetTriple) {
  if (targetTriple === "aarch64-apple-darwin") {
    return {
      targetTriple,
      backend: {
        repo: "7xuanlu/wenlan",
        tag: lock.backend_tag,
        asset: "wenlan-darwin-arm64.tar.gz",
        sha256: lock.backend_darwin_arm64_sha256,
        format: "tar",
        payload: backendPayload(targetTriple, ""),
      },
      cloudflared: {
        repo: "cloudflare/cloudflared",
        tag: lock.cloudflared_version,
        asset: "cloudflared-darwin-arm64.tgz",
        sha256: lock.cloudflared_darwin_arm64_sha256,
        format: "tar",
        payload: [
          {
            source: "cloudflared",
            destination: `cloudflared-${targetTriple}`,
          },
        ],
      },
    };
  }

  if (targetTriple === "x86_64-pc-windows-msvc") {
    return {
      targetTriple,
      backend: {
        repo: "7xuanlu/wenlan",
        tag: lock.backend_tag,
        asset: "wenlan-windows-x64.zip",
        sha256: lock.backend_windows_x64_sha256,
        format: "zip",
        payload: [
          ...backendPayload(targetTriple, ".exe"),
          { source: "onnxruntime.dll", destination: "onnxruntime.dll" },
        ],
      },
      cloudflared: {
        repo: "cloudflare/cloudflared",
        tag: lock.cloudflared_version,
        asset: "cloudflared-windows-amd64.exe",
        sha256: lock.cloudflared_windows_x64_sha256,
        format: "file",
        payload: [
          {
            source: "cloudflared-windows-amd64.exe",
            destination: `cloudflared-${targetTriple}.exe`,
          },
        ],
      },
    };
  }

  throw new Error(`unsupported sidecar target ${targetTriple}`);
}

function runCli(argv) {
  const [command, argument] = argv;
  const lock = readSidecarLock();
  if (command === "get" && argument && LOCK_KEY_SET.has(argument)) {
    process.stdout.write(`${lock[argument]}\n`);
    return;
  }
  if (command === "spec" && argument) {
    process.stdout.write(`${JSON.stringify(sidecarSpecForTarget(lock, argument), null, 2)}\n`);
    return;
  }
  throw new Error(
    "usage: node scripts/sidecar-lock.mjs get <key> | spec <target-triple>",
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

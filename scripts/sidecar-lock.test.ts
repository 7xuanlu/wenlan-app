import { describe, expect, it } from "vitest";

type SidecarLock = Record<string, string>;
type SidecarSpec = {
  targetTriple: string;
  backend: {
    asset: string;
    format: "tar" | "zip";
    payload: Array<{ source: string; destination: string }>;
    repo: string;
    sha256: string;
    tag: string;
  };
  cloudflared: {
    asset: string;
    format: "file" | "tar";
    payload: Array<{ source: string; destination: string }>;
    repo: string;
    sha256: string;
    tag: string;
  };
};

type LockModule = {
  parseSidecarLock(text: string): SidecarLock;
  sidecarSpecForTarget(lock: SidecarLock, targetTriple: string): SidecarSpec;
};

const VALID_LOCK = [
  "backend_tag=v0.13.0",
  `backend_darwin_arm64_sha256=${"a".repeat(64)}`,
  `backend_windows_x64_sha256=${"b".repeat(64)}`,
  "cloudflared_version=2026.7.2",
  `cloudflared_darwin_arm64_sha256=${"c".repeat(64)}`,
  `cloudflared_windows_x64_sha256=${"d".repeat(64)}`,
  "",
].join("\n");

async function loadLockModule(): Promise<LockModule> {
  const loaded = await import("./sidecar-lock.mjs").catch(() => null);
  expect(loaded, "scripts/sidecar-lock.mjs must exist").not.toBeNull();
  return loaded as LockModule;
}

describe("sidecar lock", () => {
  it("parses the one strict six-key contract", async () => {
    const { parseSidecarLock } = await loadLockModule();

    expect(parseSidecarLock(VALID_LOCK)).toEqual({
      backend_tag: "v0.13.0",
      backend_darwin_arm64_sha256: "a".repeat(64),
      backend_windows_x64_sha256: "b".repeat(64),
      cloudflared_version: "2026.7.2",
      cloudflared_darwin_arm64_sha256: "c".repeat(64),
      cloudflared_windows_x64_sha256: "d".repeat(64),
    });
  });

  it.each([
    {
      name: "missing key",
      text: VALID_LOCK.replace(/^backend_windows_x64_sha256=.*\n/m, ""),
      message: "missing required key backend_windows_x64_sha256",
    },
    {
      name: "duplicate key",
      text: `${VALID_LOCK}backend_tag=v0.13.0\n`,
      message: "duplicate key backend_tag",
    },
    {
      name: "unknown key",
      text: `${VALID_LOCK}backend_linux_x64_sha256=${"e".repeat(64)}\n`,
      message: "unknown key backend_linux_x64_sha256",
    },
    {
      name: "malformed line",
      text: VALID_LOCK.replace("backend_tag=v0.13.0", "backend_tag v0.13.0"),
      message: "malformed line 1",
    },
    {
      name: "bad hash",
      text: VALID_LOCK.replace("a".repeat(64), "not-a-sha"),
      message: "backend_darwin_arm64_sha256 must be a lowercase SHA-256",
    },
    {
      name: "bad backend tag",
      text: VALID_LOCK.replace("backend_tag=v0.13.0", "backend_tag=0.13.0"),
      message: "backend_tag must start with v",
    },
    {
      name: "unsafe cloudflared version",
      text: VALID_LOCK.replace("cloudflared_version=2026.7.2", "cloudflared_version=../latest"),
      message: "cloudflared_version contains unsafe path characters",
    },
  ])("rejects a $name", async ({ text, message }) => {
    const { parseSidecarLock } = await loadLockModule();

    expect(() => parseSidecarLock(text)).toThrow(message);
  });
});

describe("sidecar target mapping", () => {
  it("maps Apple Silicon to the pinned Darwin archives and target-suffixed binaries", async () => {
    const { parseSidecarLock, sidecarSpecForTarget } = await loadLockModule();
    const spec = sidecarSpecForTarget(
      parseSidecarLock(VALID_LOCK),
      "aarch64-apple-darwin",
    );

    expect(spec).toMatchObject({
      targetTriple: "aarch64-apple-darwin",
      backend: {
        repo: "7xuanlu/wenlan",
        tag: "v0.13.0",
        asset: "wenlan-darwin-arm64.tar.gz",
        sha256: "a".repeat(64),
        format: "tar",
      },
      cloudflared: {
        repo: "cloudflare/cloudflared",
        tag: "2026.7.2",
        asset: "cloudflared-darwin-arm64.tgz",
        sha256: "c".repeat(64),
        format: "tar",
      },
    });
    expect(spec.backend.payload).toEqual([
      { source: "wenlan", destination: "wenlan-aarch64-apple-darwin" },
      {
        source: "wenlan-server",
        destination: "wenlan-server-aarch64-apple-darwin",
      },
      { source: "wenlan-mcp", destination: "wenlan-mcp-aarch64-apple-darwin" },
    ]);
    expect(spec.cloudflared.payload).toEqual([
      {
        source: "cloudflared",
        destination: "cloudflared-aarch64-apple-darwin",
      },
    ]);
  });

  it("maps Windows x64 to the pinned zip, DLL, and executable sidecars", async () => {
    const { parseSidecarLock, sidecarSpecForTarget } = await loadLockModule();
    const spec = sidecarSpecForTarget(
      parseSidecarLock(VALID_LOCK),
      "x86_64-pc-windows-msvc",
    );

    expect(spec).toMatchObject({
      targetTriple: "x86_64-pc-windows-msvc",
      backend: {
        asset: "wenlan-windows-x64.zip",
        sha256: "b".repeat(64),
        format: "zip",
      },
      cloudflared: {
        asset: "cloudflared-windows-amd64.exe",
        sha256: "d".repeat(64),
        format: "file",
      },
    });
    expect(spec.backend.payload).toEqual([
      {
        source: "wenlan.exe",
        destination: "wenlan-x86_64-pc-windows-msvc.exe",
      },
      {
        source: "wenlan-server.exe",
        destination: "wenlan-server-x86_64-pc-windows-msvc.exe",
      },
      {
        source: "wenlan-mcp.exe",
        destination: "wenlan-mcp-x86_64-pc-windows-msvc.exe",
      },
      { source: "onnxruntime.dll", destination: "onnxruntime.dll" },
    ]);
    expect(spec.cloudflared.payload).toEqual([
      {
        source: "cloudflared-windows-amd64.exe",
        destination: "cloudflared-x86_64-pc-windows-msvc.exe",
      },
    ]);
  });

  it("rejects unsupported targets instead of borrowing another platform asset", async () => {
    const { parseSidecarLock, sidecarSpecForTarget } = await loadLockModule();

    expect(() =>
      sidecarSpecForTarget(
        parseSidecarLock(VALID_LOCK),
        "x86_64-unknown-linux-gnu",
      ),
    ).toThrow("unsupported sidecar target x86_64-unknown-linux-gnu");
  });
});

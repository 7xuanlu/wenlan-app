import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const tempRoots: string[] = [];

afterEach(() => {
  for (const path of tempRoots.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("scoped dev runtime", () => {
  it("routes dev lifecycle commands through worktree-owned scripts", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const scripts = packageJson.scripts as Record<string, string>;

    expect(scripts["dev:daemon"]).toBe("bash scripts/dev-runtime.sh start");
    expect(scripts["clean:dev"]).toBe("bash scripts/dev-runtime.sh stop");
    expect(scripts["dev:all"]).toBe("bash scripts/dev-all.sh");

    const lifecycleCommands = [
      scripts["dev:daemon"],
      scripts["clean:dev"],
      scripts["dev:all"],
    ].join("\n");
    expect(lifecycleCommands).not.toContain("pkill");
    expect(lifecycleCommands).not.toContain("lsof -ti :7878");
    expect(lifecycleCommands).not.toContain("kill -9");
  });

  it("defaults to an isolated non-production port and data directory", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "wenlan-app-dev-test-"));
    tempRoots.push(tempRoot);

    const result = spawnSync("bash", ["scripts/dev-runtime.sh", "print-config"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        TMPDIR: `${tempRoot}/`,
      },
    });

    expect(result.status, result.stderr).toBe(0);
    const config = Object.fromEntries(
      result.stdout
        .trim()
        .split("\n")
        .map((line) => line.split("=", 2)),
    );
    expect(config.WENLAN_PORT).toMatch(/^\d+$/);
    expect(config.WENLAN_PORT).not.toBe("7878");
    expect(config.WENLAN_DEV_UI_PORT).toMatch(/^\d+$/);
    expect(config.WENLAN_DEV_UI_PORT).not.toBe("1420");
    expect(config.WENLAN_DEV_APP_ID).toMatch(/^com\.wenlan\.desktop\.dev\.\d+$/);
    expect(config.WENLAN_DEV_TAURI_MCP_SOCKET).toContain(tempRoot);
    expect(config.WENLAN_DEV_TAURI_MCP_SOCKET).toMatch(/tauri-mcp\.sock$/);
    expect(config.WENLAN_DATA_DIR).toContain(tempRoot);
    expect(config.WENLAN_DATA_DIR).toContain("wenlan-app-dev");
  });

  it("detaches the daemon from the lifecycle command", () => {
    const script = readFileSync(resolve(root, "scripts/dev-runtime.sh"), "utf8");

    expect(script).toContain("nohup env");
    expect(script).toContain("</dev/null");
  });

  it("passes sidecar flags through pnpm without a literal separator", () => {
    const script = readFileSync(resolve(root, "scripts/dev-all.sh"), "utf8");

    expect(script).toContain("pnpm prepare:sidecars --force-build");
    expect(script).not.toContain("pnpm prepare:sidecars -- --force-build");
  });

  it("dev:all leaves a pre-existing worktree daemon running", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "wenlan-dev-owner-test-"));
    tempRoots.push(tempRoot);
    const backend = resolve(tempRoot, "wenlan");
    const server = resolve(backend, "target/debug/wenlan-server");
    const stateDir = resolve(tempRoot, "state");
    const fakeBin = resolve(tempRoot, "bin");
    const pnpmEnvLog = resolve(tempRoot, "pnpm-env.log");

    mkdirSync(resolve(backend, "crates/wenlan-server"), { recursive: true });
    mkdirSync(resolve(backend, "crates/wenlan-mcp"), { recursive: true });
    mkdirSync(resolve(backend, "crates/wenlan-cli"), { recursive: true });
    mkdirSync(resolve(backend, "target/debug"), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(resolve(backend, "Cargo.toml"), "[workspace]\n");
    symlinkSync("/bin/sleep", server);
    writeFileSync(
      resolve(fakeBin, "pnpm"),
      '#!/usr/bin/env bash\nprintf \'%s\\n\' "${WENLAN_DEV_PRESERVE_DAEMON_ON_QUIT:-unset}" >> "$FAKE_PNPM_ENV_LOG"\nexit 0\n',
    );
    chmodSync(resolve(fakeBin, "pnpm"), 0o755);

    const daemon = spawn(server, ["60"], { stdio: "ignore" });
    expect(daemon.pid).toBeDefined();
    writeFileSync(resolve(stateDir, "wenlan-server.pid"), `${daemon.pid}\n`);
    writeFileSync(resolve(stateDir, "wenlan-server.path"), `${server}\n`);

    try {
      const result = spawnSync("bash", ["scripts/dev-all.sh"], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          WENLAN_BACKEND_DIR: backend,
          WENLAN_DEV_STATE_DIR: stateDir,
          WENLAN_DEV_PORT: "27991",
          WENLAN_DEV_UI_PORT: "28991",
          FAKE_PNPM_ENV_LOG: pnpmEnvLog,
        },
      });

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(() => process.kill(daemon.pid!, 0)).not.toThrow();
      expect(readFileSync(pnpmEnvLog, "utf8").trim().split("\n")).toContain("1");
    } finally {
      daemon.kill("SIGKILL");
    }
  }, 10_000);

  it("routes Vite and Tauri through the worktree-owned UI port", () => {
    const devAll = readFileSync(resolve(root, "scripts/dev-all.sh"), "utf8");
    const viteConfig = readFileSync(resolve(root, "vite.config.ts"), "utf8");

    expect(devAll).toContain("WENLAN_PORT|WENLAN_DEV_UI_PORT|");
    expect(devAll).toContain("WENLAN_DEV_APP_ID|");
    expect(devAll).toContain("WENLAN_DEV_TAURI_MCP_SOCKET|");
    expect(devAll).toContain('[[ -S "$WENLAN_DEV_TAURI_MCP_SOCKET" ]]');
    expect(devAll).toContain('rm -f "$WENLAN_DEV_TAURI_MCP_SOCKET"');
    expect(devAll).toContain('identifier\\":\\"$WENLAN_DEV_APP_ID');
    expect(devAll).toContain('devUrl\\":\\"http://localhost:$WENLAN_DEV_UI_PORT');
    expect(viteConfig).toContain("process.env.WENLAN_DEV_UI_PORT");
  });
});

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = resolve(root, "scripts/prepare-sidecars.sh");
const tempRoots: string[] = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
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

function writeAppScript(appRoot: string): void {
  mkdirSync(resolve(appRoot, "scripts"), { recursive: true });
  copyFileSync(scriptPath, resolve(appRoot, "scripts/prepare-sidecars.sh"));
}

function printPaths(appRoot: string, env: Record<string, string> = {}): string {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === "WENLAN_BACKEND_DIR" || key === "CARGO_TARGET_DIR" || key === "TARGET_TRIPLE") {
      continue;
    }
    childEnv[key] = value;
  }

  return execFileSync("bash", ["scripts/prepare-sidecars.sh", "--print-paths"], {
    cwd: appRoot,
    encoding: "utf8",
    env: { ...childEnv, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
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
    writeAppScript(appRoot);
    writeBackendRepo(backendRoot);

    const output = printPaths(appRoot);

    expect(output).toContain(`server_src=${backendRoot}/target/debug/wenlan-server`);
    expect(output).toContain(`mcp_src=${backendRoot}/target/debug/wenlan-mcp`);
    expect(output).toContain(`cli_src=${backendRoot}/target/debug/wenlan`);
  });

  it("discovers a sibling wenlan backend from a project-local worktree checkout", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app/.worktrees/launch-smoke");
    const backendRoot = resolve(base, "wenlan");
    writeAppScript(appRoot);
    writeBackendRepo(backendRoot);

    const output = printPaths(appRoot);

    expect(output).toContain(`server_src=${backendRoot}/target/debug/wenlan-server`);
    expect(output).toContain(`mcp_src=${backendRoot}/target/debug/wenlan-mcp`);
    expect(output).toContain(`cli_src=${backendRoot}/target/debug/wenlan`);
  });

  it("keeps relative WENLAN_BACKEND_DIR overrides relative to the app checkout", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    const backendRoot = resolve(appRoot, "local-backend");
    writeAppScript(appRoot);
    writeBackendRepo(backendRoot);

    const output = printPaths(appRoot, { WENLAN_BACKEND_DIR: "local-backend" });

    expect(output).toContain(`server_src=${backendRoot}/target/debug/wenlan-server`);
    expect(output).toContain(`mcp_src=${backendRoot}/target/debug/wenlan-mcp`);
    expect(output).toContain(`cli_src=${backendRoot}/target/debug/wenlan`);
  });

  it("ignores inherited path overrides while testing default discovery", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    const backendRoot = resolve(base, "wenlan");
    writeAppScript(appRoot);
    writeBackendRepo(backendRoot);

    const originalBackendDir = process.env.WENLAN_BACKEND_DIR;
    const originalCargoTargetDir = process.env.CARGO_TARGET_DIR;
    const originalTargetTriple = process.env.TARGET_TRIPLE;
    process.env.WENLAN_BACKEND_DIR = resolve(base, "not-a-backend");
    process.env.CARGO_TARGET_DIR = resolve(base, "custom-target");
    process.env.TARGET_TRIPLE = "x86_64-unknown-linux-gnu";
    try {
      const output = printPaths(appRoot);

      expect(output).toContain(`server_src=${backendRoot}/target/debug/wenlan-server`);
      expect(output).toContain(`mcp_src=${backendRoot}/target/debug/wenlan-mcp`);
      expect(output).toContain(`cli_src=${backendRoot}/target/debug/wenlan`);
    } finally {
      restoreEnv("WENLAN_BACKEND_DIR", originalBackendDir);
      restoreEnv("CARGO_TARGET_DIR", originalCargoTargetDir);
      restoreEnv("TARGET_TRIPLE", originalTargetTriple);
    }
  });

  it("fails loud for invalid WENLAN_BACKEND_DIR overrides", () => {
    const base = makeTempRoot();
    const appRoot = resolve(base, "wenlan-app");
    writeAppScript(appRoot);

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
});

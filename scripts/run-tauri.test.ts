import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type LauncherModule = {
  createTauriInvocation(
    args: string[],
    repoRoot?: string,
  ): { appPath: string; args: string[] };
  createTauriEnvironment(
    environment?: Record<string, string | undefined>,
    options?: {
      platform?: NodeJS.Platform;
      gitBashDirectories?: string[];
      pathExists?: (path: string) => boolean;
    },
  ): Record<string, string>;
};

describe("cross-platform Tauri launcher", () => {
  it("targets app/ through the current Tauri app-path contract", async () => {
    const loaded = await import("./run-tauri.mjs").catch(() => null);
    expect(loaded, "scripts/run-tauri.mjs must exist").not.toBeNull();

    const invocation = (loaded as LauncherModule).createTauriInvocation(
      ["build", "--no-bundle"],
      "C:\\repo\\wenlan-app",
    );

    expect(invocation).toEqual({
      appPath: resolve("C:\\repo\\wenlan-app", "app"),
      args: ["build", "--no-bundle"],
    });
  });

  it("pins the local CLI and does not rely on POSIX env assignment", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    );

    expect(packageJson.scripts.tauri).toBe("node scripts/run-tauri.mjs");
    expect(packageJson.devDependencies["@tauri-apps/cli"]).toBe("2.11.4");
    expect(JSON.stringify(packageJson)).not.toContain("TAURI_DIR=app tauri");
  });

  it("puts native Git Bash before the WSL launcher for Tauri hooks", async () => {
    const loaded = await import("./run-tauri.mjs") as LauncherModule;
    const gitBashDirectory = String.raw`C:\Program Files\Git\bin`;
    const environment = loaded.createTauriEnvironment(
      {
        Path: String.raw`C:\Windows\System32;C:\Tools`,
        ProgramFiles: String.raw`C:\Program Files`,
      },
      {
        platform: "win32",
        gitBashDirectories: [gitBashDirectory],
        pathExists: () => true,
      },
    );

    expect(environment.PATH.split(";")).toEqual([
      gitBashDirectory,
      resolve(gitBashDirectory, "..", "usr", "bin"),
      String.raw`C:\Windows\System32`,
      String.raw`C:\Tools`,
    ]);
    expect(environment).not.toHaveProperty("Path");
  });
});

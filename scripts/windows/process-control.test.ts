import { describe, expect, it } from "vitest";

type ProcessControlModule = {
  appLogCandidates(
    environment: Record<string, string | undefined>,
  ): string[];
  cleanupProcessInvocation(
    appExecutable: string,
    backendExecutable: string,
    scriptPath: string,
  ): { args: string[]; command: string };
};

describe("Windows native smoke process cleanup", () => {
  it("passes executable paths as literal process arguments", async () => {
    const loaded = await import("./process-control.mjs").catch(() => null);
    expect(loaded, "scripts/windows/process-control.mjs must exist").not.toBeNull();

    const app = "C:\\Program Files\\Wenlan\\wenlan-app.exe";
    const backend = "C:\\Program Files\\Wenlan\\wenlan-server.exe";
    const script = "C:\\repo\\scripts\\windows\\cleanup-processes.ps1";
    const invocation = (loaded as ProcessControlModule).cleanupProcessInvocation(
      app,
      backend,
      script,
    );

    expect(invocation).toEqual({
      command: "pwsh",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-AppExecutable",
        app,
        "-BackendExecutable",
        backend,
      ],
    });
  });

  it("checks both Windows profile and HOME for the app's actual log layout", async () => {
    const loaded = (await import("./process-control.mjs")) as ProcessControlModule;

    expect(
      loaded.appLogCandidates({
        HOME: "/git-home",
        USERPROFILE: "/windows-profile",
        WENLAN_APP_LOG: "/explicit/wenlan.log",
      }),
    ).toEqual([
      "/explicit/wenlan.log",
      "/windows-profile/Library/Logs/com.wenlan.desktop/wenlan.log",
      "/git-home/Library/Logs/com.wenlan.desktop/wenlan.log",
    ]);
  });
});

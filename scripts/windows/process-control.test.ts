import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type ProcessControlModule = {
  appLogCandidates(
    environment: Record<string, string | undefined>,
    platform?: NodeJS.Platform,
  ): string[];
  cleanupProcessInvocation(
    appExecutable: string,
    backendExecutable: string,
    scriptPath: string,
    platform?: NodeJS.Platform,
  ): { args: string[]; command: string };
  latestMatchingLogLine(
    log: string,
    breadcrumb: string,
    notBefore?: string,
  ): string;
  powerShellCommand(platform?: NodeJS.Platform): string;
};

describe("Windows native smoke process cleanup", () => {
  it("uses inbox Windows PowerShell without requiring pwsh", async () => {
    const loaded = (await import("./process-control.mjs")) as ProcessControlModule;

    expect(loaded.powerShellCommand("win32")).toBe("powershell.exe");
    expect(loaded.powerShellCommand("linux")).toBe("pwsh");
  });

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
      "win32",
    );

    expect(invocation).toEqual({
      command: "powershell.exe",
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

  it("uses the platform-native Windows app-data log layout", async () => {
    const loaded = (await import("./process-control.mjs")) as ProcessControlModule;

    expect(
      loaded.appLogCandidates({
        HOME: "/git-home",
        LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
        USERPROFILE: "/windows-profile",
        WENLAN_APP_LOG: "/explicit/wenlan.log",
      }, "win32"),
    ).toEqual([
      "/explicit/wenlan.log",
      resolve(
        "C:\\Users\\tester\\AppData\\Local",
        "wenlan",
        "logs",
        "wenlan.log",
      ),
    ]);
  });

  it("uses the current run's last matching lifecycle breadcrumb", async () => {
    const loaded = (await import(
      "./process-control.mjs"
    )) as ProcessControlModule;
    const breadcrumb = "[quit] full quit command accepted";

    expect(
      loaded.latestMatchingLogLine(
        [
          `2026-07-23T02:20:14Z INFO ${breadcrumb}`,
          "2026-07-25T04:36:56Z INFO backend ready",
          `2026-07-25T04:37:02Z INFO ${breadcrumb}`,
          "",
        ].join("\r\n"),
        breadcrumb,
        "2026-07-25T04:36:56Z",
      ),
    ).toBe(`2026-07-25T04:37:02Z INFO ${breadcrumb}`);
  });

  it("rejects a matching lifecycle breadcrumb from an earlier run", async () => {
    const loaded = (await import(
      "./process-control.mjs"
    )) as ProcessControlModule;
    const breadcrumb = "[quit] full quit command accepted";

    expect(
      loaded.latestMatchingLogLine(
        `2026-07-23T02:20:14Z INFO ${breadcrumb}\r\n`,
        breadcrumb,
        "2026-07-25T04:36:56Z",
      ),
    ).toBe("");
  });

  it("rejects empty cleanup paths before enumerating system processes", () => {
    const script = readFileSync(
      resolve(process.cwd(), "scripts", "windows", "cleanup-processes.ps1"),
      "utf8",
    );

    expect(script.match(/\[ValidateNotNullOrEmpty\(\)\]/g)).toHaveLength(2);
  });
});

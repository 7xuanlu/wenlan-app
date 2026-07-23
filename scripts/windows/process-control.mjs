import { resolve } from "node:path";

export function appLogCandidates(environment = process.env) {
  const profileLogs = [environment.USERPROFILE, environment.HOME]
    .filter(Boolean)
    .map((home) =>
      resolve(home, "Library", "Logs", "com.wenlan.desktop", "wenlan.log"),
    );
  return [
    ...new Set(
      [environment.WENLAN_APP_LOG, ...profileLogs].filter(Boolean),
    ),
  ];
}

export function powerShellCommand(platform = process.platform) {
  return platform === "win32" ? "powershell.exe" : "pwsh";
}

export function cleanupProcessInvocation(
  appExecutable,
  backendExecutable,
  scriptPath,
  platform = process.platform,
) {
  return {
    command: powerShellCommand(platform),
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-AppExecutable",
      appExecutable,
      "-BackendExecutable",
      backendExecutable,
    ],
  };
}

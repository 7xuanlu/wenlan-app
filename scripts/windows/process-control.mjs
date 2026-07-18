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

export function cleanupProcessInvocation(
  appExecutable,
  backendExecutable,
  scriptPath,
) {
  return {
    command: "pwsh",
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

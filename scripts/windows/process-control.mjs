import { resolve } from "node:path";

export function appLogCandidates(
  environment = process.env,
  platform = process.platform,
) {
  const profileLogs =
    platform === "win32"
      ? [
          environment.LOCALAPPDATA ||
            (environment.USERPROFILE
              ? resolve(environment.USERPROFILE, "AppData", "Local")
              : ""),
        ]
          .filter(Boolean)
          .map((base) => resolve(base, "wenlan", "logs", "wenlan.log"))
      : [environment.USERPROFILE, environment.HOME]
          .filter(Boolean)
          .map((home) =>
            resolve(
              home,
              "Library",
              "Logs",
              "com.wenlan.desktop",
              "wenlan.log",
            ),
          );
  return [
    ...new Set(
      [environment.WENLAN_APP_LOG, ...profileLogs].filter(Boolean),
    ),
  ];
}

function lineTimestampMilliseconds(line) {
  const timestamp = line.match(/^(\S+)/)?.[1] || "";
  const milliseconds = Date.parse(timestamp);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function latestMatchingLogLine(log, breadcrumb, notBefore = "") {
  const cutoff = notBefore ? Date.parse(notBefore) : null;
  if (notBefore && !Number.isFinite(cutoff)) {
    throw new Error(`invalid lifecycle cutoff timestamp ${notBefore}`);
  }
  return (
    log
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.includes(breadcrumb) &&
          (cutoff === null ||
            (lineTimestampMilliseconds(line) ?? Number.NEGATIVE_INFINITY) >=
              cutoff),
      )
      .at(-1) || ""
  );
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

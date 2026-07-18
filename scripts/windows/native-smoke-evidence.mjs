const CLAIM = "Windows Server 2022 native compatibility smoke";

export class NativeSmokeEvidenceError extends Error {
  constructor(message, assertions) {
    super(message);
    this.name = "NativeSmokeEvidenceError";
    this.assertions = assertions;
  }
}

function normalizeWindowsPath(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("/", "\\")
    .replace(/\\+/g, "\\")
    .replace(/\\$/, "")
    .toLowerCase();
}

function sameWindowsPath(actual, expected) {
  return (
    normalizeWindowsPath(actual) !== "" &&
    normalizeWindowsPath(actual) === normalizeWindowsPath(expected)
  );
}

function describeValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function validateNativeSmokeEvidence(evidence, expected) {
  const assertions = [];
  const check = (name, ok, detail) => {
    assertions.push({ name, ok: Boolean(ok), detail });
  };

  const app = evidence?.processes?.after_launch?.app;
  const backend = evidence?.processes?.after_launch?.backend;
  const marker = expected?.marker;
  const screenshots = evidence?.screenshots;

  check(
    "claim-boundary",
    evidence?.claim === CLAIM,
    `expected ${describeValue(CLAIM)}, got ${describeValue(evidence?.claim)}`,
  );
  check(
    "port-7878-unused",
    evidence?.processes?.before?.port_7878_in_use === false,
    "127.0.0.1:7878 was occupied before the Tauri application launched",
  );
  check(
    "backend-health",
    evidence?.health?.ok === true &&
      evidence?.health?.response &&
      typeof evidence.health.response === "object",
    `health evidence was ${describeValue(evidence?.health)}`,
  );
  check(
    "app-pid",
    Number.isInteger(app?.pid) && app.pid > 0,
    `invalid app PID ${describeValue(app?.pid)}`,
  );
  check(
    "app-executable",
    sameWindowsPath(app?.executable_path, expected?.appExecutable),
    `expected ${describeValue(expected?.appExecutable)}, got ${describeValue(app?.executable_path)}`,
  );
  check(
    "backend-pid",
    Number.isInteger(backend?.pid) && backend.pid > 0,
    `invalid backend PID ${describeValue(backend?.pid)}`,
  );
  check(
    "backend-parent-pid",
    Number.isInteger(app?.pid) && backend?.parent_pid === app.pid,
    `expected backend parent ${describeValue(app?.pid)}, got ${describeValue(backend?.parent_pid)}`,
  );
  check(
    "backend-executable",
    sameWindowsPath(backend?.executable_path, expected?.backendExecutable),
    `expected ${describeValue(expected?.backendExecutable)}, got ${describeValue(backend?.executable_path)}`,
  );
  check(
    "onnxruntime-module",
    Array.isArray(backend?.loaded_modules) &&
      backend.loaded_modules.some((modulePath) =>
        sameWindowsPath(modulePath, expected?.onnxruntimeDll),
      ),
    `expected loaded module ${describeValue(expected?.onnxruntimeDll)}, got ${describeValue(backend?.loaded_modules)}`,
  );
  check(
    "marker-contract",
    typeof marker === "string" &&
      marker.startsWith("WINDOWS_SMOKE_") &&
      evidence?.marker?.expected === marker,
    `expected marker ${describeValue(marker)}, evidence recorded ${describeValue(evidence?.marker?.expected)}`,
  );
  check(
    "stored-source-id",
    typeof evidence?.marker?.stored_source_id === "string" &&
      evidence.marker.stored_source_id.length > 0,
    "store response did not include a source id",
  );
  check(
    "backend-marker",
    typeof evidence?.marker?.backend_content === "string" &&
      evidence.marker.backend_content.includes(marker),
    `backend content did not contain ${describeValue(marker)}`,
  );
  check(
    "ui-marker",
    typeof evidence?.marker?.ui_text === "string" &&
      evidence.marker.ui_text.includes(marker),
    `native UI text did not contain ${describeValue(marker)}`,
  );

  for (const [key, name] of [
    ["welcome", "screenshot-welcome"],
    ["app_ready", "screenshot-app-ready"],
    ["memory_visible", "screenshot-memory-visible"],
  ]) {
    const screenshot = screenshots?.[key];
    check(
      name,
      screenshot?.exists === true &&
        typeof screenshot?.path === "string" &&
        screenshot.path.length > 0,
      `missing screenshot evidence for ${key}`,
    );
  }

  check(
    "full-quit-invoked",
    evidence?.lifecycle?.full_quit_invoked === true,
    "the registered full-quit command was not invoked",
  );
  check(
    "no-fake-launchagents",
    evidence?.lifecycle?.fake_launch_agents_exists === false,
    "a Windows run created a fake Library/LaunchAgents path",
  );
  check(
    "app-exited",
    evidence?.processes?.after_close?.app_alive === false,
    "the Tauri application was still alive after full quit",
  );
  check(
    "backend-exited",
    evidence?.processes?.after_close?.backend_alive === false,
    "the app-owned backend was still alive after full quit",
  );

  const failures = assertions.filter((assertion) => !assertion.ok);
  if (failures.length > 0) {
    throw new NativeSmokeEvidenceError(
      failures
        .map((failure) => `[${failure.name}] ${failure.detail}`)
        .join("\n"),
      assertions,
    );
  }

  return { ok: true, assertions };
}

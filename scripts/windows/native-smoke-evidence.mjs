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

export function sameWindowsPath(actual, expected) {
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
  const workloadApp = evidence?.processes?.after_workload?.app;
  const workloadBackend = evidence?.processes?.after_workload?.backend;
  const marker = expected?.marker;
  const screenshots = evidence?.screenshots;

  check(
    "claim-boundary",
    evidence?.claim === CLAIM,
    `expected ${describeValue(CLAIM)}, got ${describeValue(evidence?.claim)}`,
  );
  check(
    "backend-commit-pinned",
    evidence?.metadata?.backend_source === "source-build" &&
      typeof expected?.backendCommit === "string" &&
      /^[0-9a-f]{40}$/.test(expected.backendCommit) &&
      evidence?.metadata?.backend_commit === expected.backendCommit,
    `expected source-built backend commit ${describeValue(expected?.backendCommit)}, got ${describeValue(evidence?.metadata)}`,
  );
  check(
    "backend-binary-hash",
    typeof expected?.backendServerSha256 === "string" &&
      /^[0-9a-f]{64}$/.test(expected.backendServerSha256) &&
      evidence?.metadata?.backend_server_sha256 ===
        expected.backendServerSha256,
    `expected backend sha256 ${describeValue(expected?.backendServerSha256)}, got ${describeValue(evidence?.metadata?.backend_server_sha256)}`,
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
    "workload-app-pid",
    Number.isInteger(app?.pid) && workloadApp?.pid === app.pid,
    `expected workload app PID ${describeValue(app?.pid)}, got ${describeValue(workloadApp?.pid)}`,
  );
  check(
    "workload-backend-pid",
    Number.isInteger(backend?.pid) && workloadBackend?.pid === backend.pid,
    `expected workload backend PID ${describeValue(backend?.pid)}, got ${describeValue(workloadBackend?.pid)}`,
  );
  check(
    "workload-backend-parent-pid",
    Number.isInteger(app?.pid) && workloadBackend?.parent_pid === app.pid,
    `expected workload backend parent ${describeValue(app?.pid)}, got ${describeValue(workloadBackend?.parent_pid)}`,
  );
  check(
    "workload-backend-executable",
    sameWindowsPath(workloadBackend?.executable_path, expected?.backendExecutable),
    `expected ${describeValue(expected?.backendExecutable)}, got ${describeValue(workloadBackend?.executable_path)}`,
  );
  check(
    "onnxruntime-module",
    Array.isArray(workloadBackend?.loaded_modules) &&
      workloadBackend.loaded_modules.some((modulePath) =>
        sameWindowsPath(modulePath, expected?.onnxruntimeDll),
      ),
    `expected loaded module ${describeValue(expected?.onnxruntimeDll)}, got ${describeValue(workloadBackend?.loaded_modules)}`,
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
    "stored-embedded-chunks",
    Number.isInteger(evidence?.marker?.stored_chunks_created) &&
      evidence.marker.stored_chunks_created > 0,
    `store created ${describeValue(evidence?.marker?.stored_chunks_created)} embedded chunks`,
  );
  check(
    "semantic-query-contract",
    typeof expected?.semanticQuery === "string" &&
      expected.semanticQuery.length > 0 &&
      evidence?.marker?.semantic_query === expected.semanticQuery &&
      !expected.semanticQuery.includes(marker),
    `expected vector-only query ${describeValue(expected?.semanticQuery)}, got ${describeValue(evidence?.marker?.semantic_query)}`,
  );
  check(
    "semantic-backend-source",
    typeof evidence?.marker?.stored_source_id === "string" &&
      evidence.marker.stored_source_id.length > 0 &&
      evidence?.marker?.semantic_source_id ===
        evidence.marker.stored_source_id,
    `expected semantic search source ${describeValue(evidence?.marker?.stored_source_id)}, got ${describeValue(evidence?.marker?.semantic_source_id)}`,
  );
  check(
    "semantic-backend-marker",
    typeof evidence?.marker?.semantic_backend_content === "string" &&
      evidence.marker.semantic_backend_content.includes(marker),
    `semantic backend result did not contain ${describeValue(marker)}`,
  );
  check(
    "ui-marker",
    typeof evidence?.marker?.ui_text === "string" &&
      evidence.marker.ui_text.includes(marker),
    `native UI text did not contain ${describeValue(marker)}`,
  );
  check(
    "ui-positive-result",
    typeof expected?.sourceAgent === "string" &&
      expected.sourceAgent.length > 0 &&
      typeof evidence?.marker?.ui_text === "string" &&
      evidence.marker.ui_text.includes(expected.sourceAgent),
    `native UI result did not contain source agent ${describeValue(expected?.sourceAgent)}`,
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
    "full-quit-requested",
    evidence?.lifecycle?.full_quit_requested === true,
    "the WebView did not dispatch the registered full-quit command",
  );
  check(
    "full-quit-command-accepted",
    typeof expected?.fullQuitBreadcrumb === "string" &&
      expected.fullQuitBreadcrumb.length > 0 &&
      typeof evidence?.lifecycle?.full_quit_log === "string" &&
      evidence.lifecycle.full_quit_log.includes(
        expected.fullQuitBreadcrumb,
      ),
    `app log did not contain ${describeValue(expected?.fullQuitBreadcrumb)}`,
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

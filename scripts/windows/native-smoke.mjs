import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { remote } from "webdriverio";
import { readSidecarLock } from "../sidecar-lock.mjs";
import {
  sameWindowsPath,
  validateNativeSmokeEvidence,
} from "./native-smoke-evidence.mjs";
import {
  appLogCandidates,
  cleanupProcessInvocation,
  powerShellCommand,
} from "./process-control.mjs";

const CLAIM = "Windows Server 2022 native app with source-built backend smoke";
const SOURCE_AGENT = "windows-native-smoke";
const TARGET_TRIPLE = "x86_64-pc-windows-msvc";
const FULL_QUIT_BREADCRUMB = "[quit] full quit command accepted";
const SEMANTIC_QUERY = "blue lamp adjusts ocean timepieces";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const CLEANUP_SCRIPT = resolve(SCRIPT_DIR, "cleanup-processes.ps1");
const PROCESS_SCRIPT = resolve(SCRIPT_DIR, "process-evidence.ps1");

function parseArgs(argv) {
  const parsed = { app: "", evidenceDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--app" && argv[index + 1]) {
      parsed.app = resolve(argv[index + 1]);
      index += 1;
    } else if (argument === "--evidence-dir" && argv[index + 1]) {
      parsed.evidenceDir = resolve(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(
        "usage: node scripts/windows/native-smoke.mjs --app <release-exe> --evidence-dir <directory>",
      );
    }
  }
  if (!parsed.app || !parsed.evidenceDir) {
    throw new Error("--app and --evidence-dir are required");
  }
  return parsed;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonIfMissing(path, value) {
  if (!existsSync(path)) {
    writeJson(path, value);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function poll(label, callback, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const suffix = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`timed out waiting for ${label}${suffix}`);
}

function isPortOpen(port) {
  return new Promise((resolvePromise) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (open) => {
      socket.destroy();
      resolvePromise(open);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function stageRuntimeSidecars(appExecutable) {
  const runtimeDir = dirname(appExecutable);
  const mappings = [
    [`wenlan-${TARGET_TRIPLE}.exe`, "wenlan.exe"],
    [`wenlan-server-${TARGET_TRIPLE}.exe`, "wenlan-server.exe"],
    [`wenlan-mcp-${TARGET_TRIPLE}.exe`, "wenlan-mcp.exe"],
    [`cloudflared-${TARGET_TRIPLE}.exe`, "cloudflared.exe"],
    ["onnxruntime.dll", "onnxruntime.dll"],
  ];
  for (const [sourceName, destinationName] of mappings) {
    const source = resolve(REPO_ROOT, "app", "binaries", sourceName);
    if (!existsSync(source)) {
      throw new Error(`missing staged sidecar ${source}`);
    }
    copyFileSync(source, resolve(runtimeDir, destinationName));
  }
  return {
    backendExecutable: resolve(runtimeDir, "wenlan-server.exe"),
    onnxruntimeDll: resolve(runtimeDir, "onnxruntime.dll"),
  };
}

function verifySourceBuiltBackend(runtime) {
  const manifestPath = process.env.WENLAN_SIDECAR_MANIFEST;
  const expectedCommit = process.env.WENLAN_BACKEND_COMMIT || "";
  if (!manifestPath) {
    throw new Error("WENLAN_SIDECAR_MANIFEST is required for native smoke");
  }
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
    throw new Error("WENLAN_BACKEND_COMMIT must be an exact lowercase commit SHA");
  }
  const manifest = readJson(manifestPath);
  if (
    manifest?.backend?.source !== "source-build" ||
    manifest.backend.commit !== expectedCommit
  ) {
    throw new Error(
      `sidecar manifest backend does not prove source-built commit ${expectedCommit}`,
    );
  }
  const serverName = `wenlan-server-${TARGET_TRIPLE}.exe`;
  const stagedServer = manifest?.staged?.find(
    (entry) => entry?.name === serverName,
  );
  if (!stagedServer || !/^[0-9a-f]{64}$/.test(stagedServer.sha256 || "")) {
    throw new Error(`sidecar manifest omitted the ${serverName} hash`);
  }
  const sourceServer = resolve(
    REPO_ROOT,
    "app",
    "binaries",
    serverName,
  );
  const stagedHash = fileSha256(sourceServer);
  const runtimeHash = fileSha256(runtime.backendExecutable);
  if (
    stagedHash !== stagedServer.sha256 ||
    runtimeHash !== stagedServer.sha256
  ) {
    throw new Error(
      `runtime backend hash diverged from staged manifest ${stagedServer.sha256}`,
    );
  }
  return {
    commit: expectedCommit,
    serverSha256: stagedServer.sha256,
    source: manifest.backend.source,
  };
}

function collectProcessEvidence(
  appExecutable,
  backendExecutable,
  outputPath,
) {
  const result = spawnSync(
    powerShellCommand(),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      PROCESS_SCRIPT,
      "-AppExecutable",
      appExecutable,
      "-BackendExecutable",
      backendExecutable,
      "-OutputPath",
      outputPath,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `process evidence collection failed: ${String(result.stderr || result.stdout).trim()}`,
    );
  }
  return readJson(outputPath);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(5_000),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${url} returned non-JSON HTTP ${response.status}: ${text}`);
  }
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}: ${text}`);
  }
  return body;
}

async function waitForButton(browser, text, timeout = 30_000) {
  const button = await browser.$(
    `//button[normalize-space(.)=${JSON.stringify(text)}]`,
  );
  await button.waitForDisplayed({ timeout });
  return button;
}

async function driveZeroConfigurationOnboarding(browser, log) {
  await (await waitForButton(browser, "Get started")).click();
  for (let index = 0; index < 3; index += 1) {
    const skip = await waitForButton(browser, "Skip");
    await skip.click();
  }

  const daemonStatus = await browser.$('[data-testid="task-status-daemon"]');
  await daemonStatus.waitForDisplayed({ timeout: 30_000 });
  await browser.waitUntil(
    async () => (await daemonStatus.getText()).trim() === "Running",
    {
      timeout: 180_000,
      interval: 1_000,
      timeoutMsg: "onboarding daemon task never reached visible Running state",
    },
  );
  log("visible onboarding daemon task reached Running");

  await (await waitForButton(browser, "Continue")).click();
  await (await waitForButton(browser, "Open Wenlan")).click();
  const search = await browser.$("[data-wenlan-search-input]");
  await search.waitForDisplayed({ timeout: 30_000 });
}

async function invokeGuardedQuit(browser) {
  return browser.execute(() => {
    const internals = globalThis.__TAURI_INTERNALS__;
    if (!internals || typeof internals.invoke !== "function") {
      throw new Error("Tauri invoke internals are unavailable");
    }
    // This enters the same Rust request_full_quit -> quit-requested ->
    // frontend persistence guard used by tray and native exit requests. Do not
    // await: successful teardown exits this WebView before IPC can settle.
    void internals.invoke("request_guarded_quit");
    return true;
  });
}

function copyAppLog(evidenceDir) {
  const candidates = appLogCandidates();
  const destination = resolve(evidenceDir, "app.log");
  const source = candidates.find((candidate) => existsSync(candidate));
  if (source) {
    copyFileSync(source, destination);
  } else if (!existsSync(destination)) {
    writeFileSync(
      destination,
      `app log not found; checked: ${candidates.join(", ")}\n`,
    );
  }
}

function bestEffortCleanup(appExecutable, backendExecutable) {
  const invocation = cleanupProcessInvocation(
    appExecutable,
    backendExecutable,
    CLEANUP_SCRIPT,
  );
  spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.evidenceDir, { recursive: true });
  const webdriverLog = resolve(args.evidenceDir, "webdriver.log");
  const log = (message) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    console.log(line);
    appendFileSync(webdriverLog, `${line}\n`);
  };

  const lock = readSidecarLock();
  const resultPath = resolve(args.evidenceDir, "result.json");
  const healthPath = resolve(args.evidenceDir, "health.json");
  const statusPath = resolve(args.evidenceDir, "status.json");
  const semanticSearchPath = resolve(
    args.evidenceDir,
    "semantic-search.json",
  );
  const beforePath = resolve(args.evidenceDir, "processes-before.json");
  const launchPath = resolve(
    args.evidenceDir,
    "processes-after-launch.json",
  );
  const workloadPath = resolve(
    args.evidenceDir,
    "processes-after-workload.json",
  );
  const closePath = resolve(args.evidenceDir, "processes-after-close.json");
  const welcomePath = resolve(args.evidenceDir, "01-welcome.png");
  const appReadyPath = resolve(args.evidenceDir, "02-app-ready.png");
  const memoryVisiblePath = resolve(
    args.evidenceDir,
    "03-memory-visible.png",
  );
  const fakeLaunchAgentsPath = resolve(
    process.env.USERPROFILE || process.env.HOME || "",
    "Library",
    "LaunchAgents",
  );
  const runtime = {
    backendExecutable: resolve(dirname(args.app), "wenlan-server.exe"),
    onnxruntimeDll: resolve(dirname(args.app), "onnxruntime.dll"),
  };
  let backendProof = {
    commit: "",
    serverSha256: "",
    source: "",
  };
  const marker = `WINDOWS_SMOKE_${process.env.GITHUB_RUN_ID || Date.now()}_${process.env.GITHUB_RUN_ATTEMPT || 1}`;
  const inferenceExpectation = {
    inferenceBackend:
      process.env.WENLAN_NATIVE_EXPECT_INFERENCE_BACKEND?.trim() || "",
    inferenceDeviceContains:
      process.env.WENLAN_NATIVE_EXPECT_INFERENCE_DEVICE_CONTAINS?.trim() || "",
  };

  const evidence = {
    claim: CLAIM,
    status: "running",
    metadata: {
      app_commit: process.env.GITHUB_SHA || "",
      backend_commit: "",
      backend_source: "",
      backend_server_sha256: "",
      backend_tag: lock.backend_tag,
      backend_release_baseline_sha256: lock.backend_windows_x64_sha256,
      cloudflared_version: lock.cloudflared_version,
      cloudflared_windows_sha256: lock.cloudflared_windows_x64_sha256,
      cargo_profile: "release",
      cargo_features: "default",
      runner_image: process.env.ImageVersion || "",
      windows_build: process.env.WINDOWS_BUILD || "",
      webview2_version: process.env.WEBVIEW2_VERSION || "",
      msedgedriver_version: process.env.MSEDGEDRIVER_VERSION || "",
      tauri_driver_version: process.env.TAURI_DRIVER_VERSION || "",
    },
    health: { ok: false, response: {} },
    inference: {
      backend: "not-captured",
      device: null,
      device_index: null,
      fallback_reason: null,
    },
    lifecycle: {
      fake_launch_agents_before_app_exists: false,
      fake_launch_agents_exists: false,
      full_quit_log: "",
      full_quit_requested: false,
    },
    marker: {
      expected: marker,
      stored_source_id: "",
      stored_chunks_created: 0,
      backend_content: "",
      semantic_query: SEMANTIC_QUERY,
      semantic_source_id: "",
      semantic_backend_content: "",
      ui_text: "",
    },
    processes: {
      before: { port_7878_in_use: true },
      after_launch: {
        app: { pid: 0, executable_path: "" },
        backend: {
          pid: 0,
          parent_pid: 0,
          executable_path: "",
          loaded_modules: [],
        },
      },
      after_workload: {
        app: { pid: 0, executable_path: "" },
        backend: {
          pid: 0,
          parent_pid: 0,
          executable_path: "",
          loaded_modules: [],
        },
      },
      after_close: { app_alive: true, backend_alive: true },
    },
    screenshots: {
      welcome: { exists: false, path: welcomePath },
      app_ready: { exists: false, path: appReadyPath },
      memory_visible: { exists: false, path: memoryVisiblePath },
    },
    assertions: [],
    error: null,
  };

  let browser;
  let workloadPollState = "not-started";
  let lastWorkloadSnapshot = null;
  try {
    Object.assign(runtime, stageRuntimeSidecars(args.app));
    backendProof = verifySourceBuiltBackend(runtime);
    Object.assign(evidence.metadata, {
      backend_commit: backendProof.commit,
      backend_source: backendProof.source,
      backend_server_sha256: backendProof.serverSha256,
    });

    const portOccupied = await isPortOpen(7878);
    evidence.processes.before.port_7878_in_use = portOccupied;
    const before = collectProcessEvidence(
      args.app,
      runtime.backendExecutable,
      beforePath,
    );
    if (portOccupied || before.app.length > 0 || before.backend.length > 0) {
      throw new Error(
        "clean-run precondition failed: port 7878 or Wenlan processes already present",
      );
    }
    log("clean-run process and port precondition passed");
    evidence.lifecycle.fake_launch_agents_before_app_exists = existsSync(
      fakeLaunchAgentsPath,
    );
    if (evidence.lifecycle.fake_launch_agents_before_app_exists) {
      throw new Error(
        `clean-run precondition failed: fake LaunchAgents path already existed at ${fakeLaunchAgentsPath}`,
      );
    }
    log("clean-run fake LaunchAgents precondition passed");

    browser = await remote({
      hostname: "127.0.0.1",
      port: 4444,
      logLevel: "info",
      capabilities: {
        "tauri:options": {
          application: args.app,
        },
      },
    });

    const welcome = await waitForButton(browser, "Get started", 180_000);
    await welcome.waitForDisplayed();
    await browser.saveScreenshot(welcomePath);
    evidence.screenshots.welcome.exists = existsSync(welcomePath);
    log("captured visible first-run welcome");

    const health = await poll(
      "backend health",
      async () => fetchJson("http://127.0.0.1:7878/api/health"),
      180_000,
      1_000,
    );
    evidence.health = { ok: true, response: health };
    writeJson(healthPath, health);
    const fetchInferenceStatus = async () => {
      const candidate = await fetchJson("http://127.0.0.1:7878/api/status");
      if (!inferenceExpectation.inferenceBackend) return candidate;
      const inference = candidate?.on_device_inference;
      const backendMatches =
        inference?.backend === inferenceExpectation.inferenceBackend;
      const deviceMatches =
        !inferenceExpectation.inferenceDeviceContains ||
        (typeof inference?.device === "string" &&
          inference.device
            .toLowerCase()
            .includes(
              inferenceExpectation.inferenceDeviceContains.toLowerCase(),
            ));
      return backendMatches && deviceMatches ? candidate : null;
    };
    const status = inferenceExpectation.inferenceBackend
      ? await poll("expected on-device inference backend", fetchInferenceStatus, 180_000, 1_000)
      : await fetchInferenceStatus();
    evidence.inference = status?.on_device_inference ?? evidence.inference;
    writeJson(statusPath, status);
    log(
      `captured on-device inference backend ${evidence.inference.backend}` +
        (evidence.inference.device
          ? ` on ${evidence.inference.device}`
          : ""),
    );

    const launched = await poll(
      "exactly one app and app-owned backend process",
      async () => {
        const snapshot = collectProcessEvidence(
          args.app,
          runtime.backendExecutable,
          launchPath,
        );
        return snapshot.app.length === 1 && snapshot.backend.length === 1
          ? snapshot
          : null;
      },
      30_000,
    );
    evidence.processes.after_launch = {
      app: launched.app[0],
      backend: launched.backend[0],
    };

    await driveZeroConfigurationOnboarding(browser, log);
    await browser.saveScreenshot(appReadyPath);
    evidence.screenshots.app_ready.exists = existsSync(appReadyPath);
    log("captured native app-ready shell after visible onboarding");

    const content = `Windows native sidecar and WebView2 smoke proof. Unique marker: ${marker}. A cobalt lantern calibrates tidal clocks during winter.`;
    const stored = await fetchJson("http://127.0.0.1:7878/api/memory/store", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content,
        memory_type: "fact",
        source_agent: SOURCE_AGENT,
        title: marker,
      }),
    });
    if (!stored?.source_id) {
      throw new Error(`store response omitted source_id: ${JSON.stringify(stored)}`);
    }
    evidence.marker.stored_source_id = stored.source_id;
    evidence.marker.stored_chunks_created = stored.chunks_created;

    const detail = await poll(
      "stored marker detail",
      async () => {
        const response = await fetchJson(
          `http://127.0.0.1:7878/api/memory/${encodeURIComponent(stored.source_id)}/detail`,
        );
        return response?.memory?.content?.includes(marker) ? response : null;
      },
      30_000,
    );
    evidence.marker.backend_content = detail.memory.content;

    const semanticSearch = await fetchJson(
      "http://127.0.0.1:7878/api/memory/search",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: SEMANTIC_QUERY,
          limit: 3,
        }),
      },
    );
    writeJson(semanticSearchPath, semanticSearch);
    const semanticHit = semanticSearch?.results?.find(
      (result) =>
        result?.source_id === stored.source_id &&
        result?.content?.includes(marker),
    );
    if (!semanticHit) {
      throw new Error(
        `vector-only semantic search did not return source ${stored.source_id}: ${JSON.stringify(semanticSearch)}`,
      );
    }
    evidence.marker.semantic_source_id = semanticHit.source_id;
    evidence.marker.semantic_backend_content = semanticHit.content;
    log("confirmed vector-only backend search returned the stored marker");

    const search = await browser.$("[data-wenlan-search-input]");
    await search.setValue(marker);
    const positiveResultCard = await browser.$(
      `//p[contains(normalize-space(.), ${JSON.stringify(marker)})]/parent::div[.//span[normalize-space(.)=${JSON.stringify(SOURCE_AGENT)}]]`,
    );
    await positiveResultCard.waitForDisplayed({ timeout: 60_000 });
    evidence.marker.ui_text = await positiveResultCard.getText();
    if (!evidence.marker.ui_text.includes(marker)) {
      throw new Error("visible native search result omitted the unique marker");
    }
    if (!evidence.marker.ui_text.includes(SOURCE_AGENT)) {
      throw new Error("visible native search result omitted its source agent");
    }
    await browser.saveScreenshot(memoryVisiblePath);
    evidence.screenshots.memory_visible.exists = existsSync(memoryVisiblePath);
    log("captured native search result with the backend marker");

    workloadPollState = "polling";
    const exercised = await poll(
      "same app/backend process with bundled onnxruntime.dll loaded",
      async () => {
        const snapshot = collectProcessEvidence(
          args.app,
          runtime.backendExecutable,
          workloadPath,
        );
        lastWorkloadSnapshot = snapshot;
        const app = snapshot.app[0];
        const backend = snapshot.backend[0];
        const sameProcesses =
          snapshot.app.length === 1 &&
          snapshot.backend.length === 1 &&
          app.pid === evidence.processes.after_launch.app.pid &&
          backend.pid === evidence.processes.after_launch.backend.pid;
        const bundledOnnxLoaded = backend?.loaded_modules?.some((modulePath) =>
          sameWindowsPath(modulePath, runtime.onnxruntimeDll),
        );
        return sameProcesses && bundledOnnxLoaded ? snapshot : null;
      },
      60_000,
      500,
    );
    evidence.processes.after_workload = {
      app: exercised.app[0],
      backend: exercised.backend[0],
    };
    workloadPollState = "captured";
    log("confirmed the exercised backend loaded the bundled onnxruntime.dll");

    evidence.lifecycle.full_quit_requested = (await invokeGuardedQuit(browser)) === true;
    log("requested registered guarded quit command");

    const afterClose = await poll(
      "app and backend full quit",
      async () => {
        const snapshot = collectProcessEvidence(
          args.app,
          runtime.backendExecutable,
          closePath,
        );
        return snapshot.app.length === 0 && snapshot.backend.length === 0
          ? snapshot
          : null;
      },
      10_000,
      250,
    ).catch(() =>
      collectProcessEvidence(
        args.app,
        runtime.backendExecutable,
        closePath,
      ),
    );
    evidence.processes.after_close = {
      app_alive: afterClose.app.length > 0,
      backend_alive: afterClose.backend.length > 0,
    };
    evidence.lifecycle.fake_launch_agents_exists = existsSync(
      fakeLaunchAgentsPath,
    );
    copyAppLog(args.evidenceDir);
    const appLog = readFileSync(resolve(args.evidenceDir, "app.log"), "utf8");
    evidence.lifecycle.full_quit_log =
      appLog
        .split(/\r?\n/)
        .find((line) => line.includes(FULL_QUIT_BREADCRUMB)) || "";

    const validation = validateNativeSmokeEvidence(evidence, {
      appExecutable: args.app,
      backendCommit: backendProof.commit,
      backendExecutable: runtime.backendExecutable,
      backendServerSha256: backendProof.serverSha256,
      fullQuitBreadcrumb: FULL_QUIT_BREADCRUMB,
      ...inferenceExpectation,
      onnxruntimeDll: runtime.onnxruntimeDll,
      marker,
      semanticQuery: SEMANTIC_QUERY,
      sourceAgent: SOURCE_AGENT,
    });
    evidence.assertions = validation.assertions;
    evidence.status = "passed";
    log("all native evidence assertions passed");
  } catch (error) {
    evidence.status = "failed";
    evidence.error = error instanceof Error ? error.message : String(error);
    if (error && typeof error === "object" && "assertions" in error) {
      evidence.assertions = error.assertions;
    } else {
      try {
        validateNativeSmokeEvidence(evidence, {
          appExecutable: args.app,
          backendCommit: backendProof.commit,
          backendExecutable: runtime.backendExecutable,
          backendServerSha256: backendProof.serverSha256,
          fullQuitBreadcrumb: FULL_QUIT_BREADCRUMB,
          ...inferenceExpectation,
          onnxruntimeDll: runtime.onnxruntimeDll,
          marker,
          semanticQuery: SEMANTIC_QUERY,
          sourceAgent: SOURCE_AGENT,
        });
      } catch (validationError) {
        if (
          validationError &&
          typeof validationError === "object" &&
          "assertions" in validationError
        ) {
          evidence.assertions = validationError.assertions;
        }
      }
    }
    log(`FAILED: ${evidence.error}`);
  } finally {
    copyAppLog(args.evidenceDir);
    writeJsonIfMissing(healthPath, evidence.health);
    writeJsonIfMissing(statusPath, {
      error: evidence.error || "status was not captured before failure",
      on_device_inference: evidence.inference,
    });
    writeJsonIfMissing(semanticSearchPath, {
      error: evidence.error || "semantic search was not captured before failure",
    });
    writeJsonIfMissing(beforePath, {
      app: [],
      backend: [],
      error: "process evidence was not captured before failure",
    });
    writeJsonIfMissing(launchPath, {
      app: [],
      backend: [],
      error: "process evidence was not captured before failure",
    });
    if (workloadPollState !== "captured") {
      writeJson(workloadPath, {
        status: workloadPollState === "polling" ? "failed" : "not-captured",
        app: lastWorkloadSnapshot?.app ?? [],
        backend: lastWorkloadSnapshot?.backend ?? [],
        error:
          evidence.error ||
          "process evidence was not captured before failure",
      });
    }
    writeJsonIfMissing(closePath, {
      app: [],
      backend: [],
      error: "process evidence was not captured before failure",
    });
    writeJson(resultPath, evidence);
    if (browser) {
      await browser.deleteSession().catch(() => {});
    }
    if (evidence.status !== "passed") {
      bestEffortCleanup(args.app, runtime.backendExecutable);
    }
  }

  if (evidence.status !== "passed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

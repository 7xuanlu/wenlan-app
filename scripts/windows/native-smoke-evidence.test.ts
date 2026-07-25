import { describe, expect, it } from "vitest";

type Evidence = {
  claim: string;
  health: { ok: boolean; response: Record<string, unknown> };
  inference: {
    backend: string;
    device: string | null;
    device_index: number | null;
    fallback_reason: string | null;
    gpu_layers: number | null;
  };
  metadata: {
    backend_commit: string;
    backend_server_sha256: string;
    backend_source: string;
  };
  lifecycle: {
    fake_launch_agents_before_app_exists: boolean;
    fake_launch_agents_exists: boolean;
    full_quit_log: string;
    full_quit_requested: boolean;
    run_started_at: string;
  };
  marker: {
    backend_content: string;
    expected: string;
    semantic_backend_content: string;
    semantic_query: string;
    semantic_source_id: string;
    stored_chunks_created: number;
    stored_source_id: string;
    ui_text: string;
  };
  processes: {
    after_close: { app_alive: boolean; backend_alive: boolean };
    after_launch: {
      app: { executable_path: string; pid: number };
      backend: {
        executable_path: string;
        loaded_modules: string[];
        parent_pid: number;
        pid: number;
      };
    };
    after_workload: {
      app: { executable_path: string; pid: number };
      backend: {
        executable_path: string;
        loaded_modules: string[];
        parent_pid: number;
        pid: number;
      };
    };
    before: { port_7878_in_use: boolean };
  };
  screenshots: Record<
    "welcome" | "app_ready" | "memory_visible",
    { exists: boolean; path: string }
  >;
};

type ExpectedEvidence = {
  appExecutable: string;
  backendCommit: string;
  backendExecutable: string;
  backendServerSha256: string;
  claim: string;
  fullQuitBreadcrumb: string;
  inferenceBackend?: string;
  inferenceDeviceContains?: string;
  inferenceDeviceIndex?: number;
  inferenceGpuLayers?: number;
  marker: string;
  onnxruntimeDll: string;
  requireNoInferenceFallback?: boolean;
  semanticQuery: string;
  sourceAgent: string;
  vulkanLoaderDll?: string;
};

type ValidationResult = {
  assertions: Array<{ name: string; ok: boolean }>;
  ok: true;
};

type EvidenceModule = {
  validateNativeSmokeEvidence(
    evidence: Evidence,
    expected: ExpectedEvidence,
  ): ValidationResult;
};

const MARKER = "WINDOWS_SMOKE_123_1";
const APP_EXE = "C:\\actions\\wenlan\\target\\release\\wenlan-app.exe";
const BACKEND_EXE =
  "C:\\actions\\wenlan\\target\\release\\wenlan-server.exe";
const ONNX_DLL = "C:\\actions\\wenlan\\target\\release\\onnxruntime.dll";
const VULKAN_LOADER = "C:\\actions\\wenlan\\target\\release\\vulkan-1.dll";
const BACKEND_COMMIT = "b".repeat(40);
const BACKEND_SHA256 = "a".repeat(64);
const FULL_QUIT_BREADCRUMB = "[quit] full quit command accepted";
const SEMANTIC_QUERY = "blue lamp adjusts ocean timepieces";
const CLAIM = "Windows Server 2022 native app with source-built backend smoke";

function completeEvidence(): Evidence {
  return {
    claim: CLAIM,
    health: {
      ok: true,
      response: { status: "ok", version: `0.14.1+g${BACKEND_COMMIT.slice(0, 8)}` },
    },
    inference: {
      backend: "vulkan",
      device: "NVIDIA GeForce RTX 3060 Laptop GPU",
      device_index: 1,
      fallback_reason: null,
      gpu_layers: 99,
    },
    metadata: {
      backend_commit: BACKEND_COMMIT,
      backend_server_sha256: BACKEND_SHA256,
      backend_source: "source-build",
    },
    lifecycle: {
      fake_launch_agents_before_app_exists: false,
      fake_launch_agents_exists: false,
      full_quit_log: `2026-07-19T00:00:01Z INFO ${FULL_QUIT_BREADCRUMB}`,
      full_quit_requested: true,
      run_started_at: "2026-07-19T00:00:00Z",
    },
    marker: {
      backend_content: `A native proof containing ${MARKER}`,
      expected: MARKER,
      semantic_backend_content: `A native proof containing ${MARKER}`,
      semantic_query: SEMANTIC_QUERY,
      semantic_source_id: "windows-smoke-source",
      stored_chunks_created: 1,
      stored_source_id: "windows-smoke-source",
      ui_text: `A native proof containing ${MARKER}\nwindows-native-smoke`,
    },
    processes: {
      before: { port_7878_in_use: false },
      after_launch: {
        app: { pid: 4100, executable_path: APP_EXE },
        backend: {
          pid: 4200,
          parent_pid: 4100,
          executable_path: BACKEND_EXE,
          loaded_modules: [
            "C:\\Windows\\System32\\kernel32.dll",
            ONNX_DLL,
            VULKAN_LOADER,
          ],
        },
      },
      after_workload: {
        app: { pid: 4100, executable_path: APP_EXE },
        backend: {
          pid: 4200,
          parent_pid: 4100,
          executable_path: BACKEND_EXE,
          loaded_modules: [
            "C:\\Windows\\System32\\kernel32.dll",
            ONNX_DLL,
            VULKAN_LOADER,
          ],
        },
      },
      after_close: { app_alive: false, backend_alive: false },
    },
    screenshots: {
      welcome: { exists: true, path: "01-welcome.png" },
      app_ready: { exists: true, path: "02-app-ready.png" },
      memory_visible: { exists: true, path: "03-memory-visible.png" },
    },
  };
}

const expected: ExpectedEvidence = {
  appExecutable: APP_EXE,
  backendCommit: BACKEND_COMMIT,
  backendExecutable: BACKEND_EXE,
  backendServerSha256: BACKEND_SHA256,
  claim: CLAIM,
  fullQuitBreadcrumb: FULL_QUIT_BREADCRUMB,
  inferenceBackend: "vulkan",
  inferenceDeviceContains: "RTX 3060",
  inferenceDeviceIndex: 1,
  inferenceGpuLayers: 99,
  marker: MARKER,
  onnxruntimeDll: ONNX_DLL,
  requireNoInferenceFallback: true,
  semanticQuery: SEMANTIC_QUERY,
  sourceAgent: "windows-native-smoke",
  vulkanLoaderDll: VULKAN_LOADER,
};

async function loadEvidenceModule(): Promise<EvidenceModule> {
  const loaded = await import("./native-smoke-evidence.mjs").catch(() => null);
  expect(
    loaded,
    "scripts/windows/native-smoke-evidence.mjs must exist",
  ).not.toBeNull();
  return loaded as EvidenceModule;
}

describe("Windows native smoke evidence validator", () => {
  it("accepts one coherent native app/backend/UI proof", async () => {
    const { validateNativeSmokeEvidence } = await loadEvidenceModule();

    const result = validateNativeSmokeEvidence(completeEvidence(), expected);

    expect(result.ok).toBe(true);
    expect(result.assertions.length).toBeGreaterThanOrEqual(14);
    expect(result.assertions.every((assertion) => assertion.ok)).toBe(true);
  });

  it("binds a physical-run claim supplied by the current runner", async () => {
    const { validateNativeSmokeEvidence } = await loadEvidenceModule();
    const physicalClaim =
      "Physical Windows 11 native app with source-built Vulkan backend smoke";
    const evidence = completeEvidence();
    evidence.claim = physicalClaim;

    const result = validateNativeSmokeEvidence(evidence, {
      ...expected,
      claim: physicalClaim,
    });

    expect(result.ok).toBe(true);
    expect(result.assertions.every((assertion) => assertion.ok)).toBe(true);
  });

  it.each([
    {
      name: "claim not bound to the current runner",
      assertion: "claim-boundary",
      mutate: (evidence: Evidence) => {
        evidence.claim =
          "Physical Windows 11 native app with source-built Vulkan backend smoke";
      },
    },
    {
      name: "unpinned backend commit",
      assertion: "backend-commit-pinned",
      mutate: (evidence: Evidence) => {
        evidence.metadata.backend_commit = "c".repeat(40);
      },
    },
    {
      name: "wrong backend binary hash",
      assertion: "backend-binary-hash",
      mutate: (evidence: Evidence) => {
        evidence.metadata.backend_server_sha256 = "d".repeat(64);
      },
    },
    {
      name: "runtime version from another backend commit",
      assertion: "backend-runtime-version",
      mutate: (evidence: Evidence) => {
        evidence.health.response.version = "0.14.1+gcccccccc";
      },
    },
    {
      name: "occupied port before launch",
      assertion: "port-7878-unused",
      mutate: (evidence: Evidence) => {
        evidence.processes.before.port_7878_in_use = true;
      },
    },
    {
      name: "wrong inference backend",
      assertion: "inference-backend",
      mutate: (evidence: Evidence) => {
        evidence.inference.backend = "cpu";
      },
    },
    {
      name: "wrong inference device",
      assertion: "inference-device",
      mutate: (evidence: Evidence) => {
        evidence.inference.device = "Intel(R) Iris(R) Xe Graphics";
      },
    },
    {
      name: "wrong inference device index",
      assertion: "inference-device-index",
      mutate: (evidence: Evidence) => {
        evidence.inference.device_index = 0;
      },
    },
    {
      name: "wrong inference GPU layer count",
      assertion: "inference-gpu-layers",
      mutate: (evidence: Evidence) => {
        evidence.inference.gpu_layers = 0;
      },
    },
    {
      name: "unexpected inference fallback",
      assertion: "inference-no-fallback",
      mutate: (evidence: Evidence) => {
        evidence.inference.fallback_reason =
          "requested GPU device index 1 is unavailable";
      },
    },
    {
      name: "wrong backend parent",
      assertion: "backend-parent-pid",
      mutate: (evidence: Evidence) => {
        evidence.processes.after_launch.backend.parent_pid = 9999;
      },
    },
    {
      name: "wrong backend executable",
      assertion: "backend-executable",
      mutate: (evidence: Evidence) => {
        evidence.processes.after_launch.backend.executable_path =
          "C:\\other\\wenlan-server.exe";
      },
    },
    {
      name: "wrong ONNX runtime",
      assertion: "onnxruntime-module",
      mutate: (evidence: Evidence) => {
        evidence.processes.after_workload.backend.loaded_modules = [
          "C:\\Windows\\System32\\onnxruntime.dll",
        ];
      },
    },
    {
      name: "Vulkan loader came from the system instead of the staged runtime",
      assertion: "vulkan-loader-module",
      mutate: (evidence: Evidence) => {
        evidence.processes.after_workload.backend.loaded_modules = [
          ONNX_DLL,
          "C:\\Windows\\System32\\vulkan-1.dll",
        ];
      },
    },
    {
      name: "backend PID changed during workload",
      assertion: "workload-backend-pid",
      mutate: (evidence: Evidence) => {
        evidence.processes.after_workload.backend.pid = 9999;
      },
    },
    {
      name: "wrong backend marker",
      assertion: "backend-marker",
      mutate: (evidence: Evidence) => {
        evidence.marker.backend_content = "some other memory";
      },
    },
    {
      name: "store created no embedded chunks",
      assertion: "stored-embedded-chunks",
      mutate: (evidence: Evidence) => {
        evidence.marker.stored_chunks_created = 0;
      },
    },
    {
      name: "wrong semantic query",
      assertion: "semantic-query-contract",
      mutate: (evidence: Evidence) => {
        evidence.marker.semantic_query = MARKER;
      },
    },
    {
      name: "semantic search returned another memory",
      assertion: "semantic-backend-source",
      mutate: (evidence: Evidence) => {
        evidence.marker.semantic_source_id = "some-other-source";
      },
    },
    {
      name: "semantic search response omitted the marker",
      assertion: "semantic-backend-marker",
      mutate: (evidence: Evidence) => {
        evidence.marker.semantic_backend_content = "some other memory";
      },
    },
    {
      name: "wrong UI marker",
      assertion: "ui-marker",
      mutate: (evidence: Evidence) => {
        evidence.marker.ui_text = "some other memory";
      },
    },
    {
      name: "query echoed without a positive result",
      assertion: "ui-positive-result",
      mutate: (evidence: Evidence) => {
        evidence.marker.ui_text = `No captures found for ${MARKER}`;
      },
    },
    {
      name: "missing visible-memory screenshot",
      assertion: "screenshot-memory-visible",
      mutate: (evidence: Evidence) => {
        evidence.screenshots.memory_visible.exists = false;
      },
    },
    {
      name: "orphaned backend",
      assertion: "backend-exited",
      mutate: (evidence: Evidence) => {
        evidence.processes.after_close.backend_alive = true;
      },
    },
    {
      name: "full quit was not requested",
      assertion: "full-quit-requested",
      mutate: (evidence: Evidence) => {
        evidence.lifecycle.full_quit_requested = false;
      },
    },
    {
      name: "full quit command left no Rust breadcrumb",
      assertion: "full-quit-command-accepted",
      mutate: (evidence: Evidence) => {
        evidence.lifecycle.full_quit_log = "";
      },
    },
    {
      name: "full quit breadcrumb predates this run",
      assertion: "full-quit-current-run",
      mutate: (evidence: Evidence) => {
        evidence.lifecycle.run_started_at = "2026-07-20T00:00:00Z";
      },
    },
    {
      name: "fake LaunchAgents directory before app launch",
      assertion: "no-preexisting-fake-launchagents",
      mutate: (evidence: Evidence) => {
        evidence.lifecycle.fake_launch_agents_before_app_exists = true;
      },
    },
    {
      name: "fake LaunchAgents directory",
      assertion: "no-fake-launchagents",
      mutate: (evidence: Evidence) => {
        evidence.lifecycle.fake_launch_agents_exists = true;
      },
    },
  ])("rejects $name with the owning assertion", async ({ assertion, mutate }) => {
    const { validateNativeSmokeEvidence } = await loadEvidenceModule();
    const evidence = completeEvidence();
    mutate(evidence);

    expect(() => validateNativeSmokeEvidence(evidence, expected)).toThrow(
      `[${assertion}]`,
    );
  });
});

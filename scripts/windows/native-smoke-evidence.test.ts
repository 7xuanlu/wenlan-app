import { describe, expect, it } from "vitest";

type Evidence = {
  claim: string;
  health: { ok: boolean; response: Record<string, unknown> };
  metadata: {
    backend_commit: string;
    backend_server_sha256: string;
    backend_source: string;
  };
  lifecycle: {
    fake_launch_agents_exists: boolean;
    full_quit_log: string;
    full_quit_requested: boolean;
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
  fullQuitBreadcrumb: string;
  marker: string;
  onnxruntimeDll: string;
  semanticQuery: string;
  sourceAgent: string;
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
const BACKEND_COMMIT = "b".repeat(40);
const BACKEND_SHA256 = "a".repeat(64);
const FULL_QUIT_BREADCRUMB = "[quit] full quit command accepted";
const SEMANTIC_QUERY = "blue lamp adjusts ocean timepieces";

function completeEvidence(): Evidence {
  return {
    claim: "Windows Server 2022 native compatibility smoke",
    health: { ok: true, response: { status: "ok" } },
    metadata: {
      backend_commit: BACKEND_COMMIT,
      backend_server_sha256: BACKEND_SHA256,
      backend_source: "source-build",
    },
    lifecycle: {
      fake_launch_agents_exists: false,
      full_quit_log: `2026-07-19 INFO ${FULL_QUIT_BREADCRUMB}`,
      full_quit_requested: true,
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
  fullQuitBreadcrumb: FULL_QUIT_BREADCRUMB,
  marker: MARKER,
  onnxruntimeDll: ONNX_DLL,
  semanticQuery: SEMANTIC_QUERY,
  sourceAgent: "windows-native-smoke",
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

  it.each([
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
      name: "occupied port before launch",
      assertion: "port-7878-unused",
      mutate: (evidence: Evidence) => {
        evidence.processes.before.port_7878_in_use = true;
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

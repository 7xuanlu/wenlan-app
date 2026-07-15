// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../../../i18n";

const mocks = vi.hoisted(() => ({
  getApiKey: vi.fn(),
  setApiKey: vi.fn(),
  getModelChoice: vi.fn(),
  setModelChoice: vi.fn(),
  getExternalLlm: vi.fn(),
  setExternalLlm: vi.fn(),
  testExternalLlm: vi.fn(),
  listExternalModels: vi.fn(),
  getExternalLlmKeyConfigured: vi.fn(),
  getDaemonVersion: vi.fn(),
  getOnDeviceModel: vi.fn(),
  getSystemInfo: vi.fn(),
  downloadOnDeviceModel: vi.fn(),
  getSetupStatus: vi.fn(),
}));
vi.mock("../../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/tauri")>();
  return { ...actual, ...mocks };
});

import IntelligenceSection from "./IntelligenceSection";

function renderSection(qc: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={qc}>
      <IntelligenceSection delay={0} />
    </QueryClientProvider>
  );
  return qc;
}

describe("IntelligenceSection", () => {
  // NOTE: reset runs in afterEach, not beforeEach — see
  // src/hooks/useDaemonVersion.test.tsx for why. Resetting a vi.fn() in
  // beforeEach immediately before it's reconfigured with a resolved value
  // and consumed by a react-query queryFn deterministically triggers a
  // false-positive "unhandled rejection" failure on this project's pinned
  // vitest 4.1.5 + @tanstack/react-query 5.100.9 + React 19 combination.
  afterEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
  });

  beforeEach(() => {
    mocks.getApiKey.mockResolvedValue(null);
    mocks.setApiKey.mockResolvedValue(undefined);
    mocks.getModelChoice.mockResolvedValue([null, null]);
    mocks.setModelChoice.mockResolvedValue(undefined);
    mocks.getExternalLlm.mockResolvedValue([null, null]);
    mocks.setExternalLlm.mockResolvedValue(undefined);
    mocks.testExternalLlm.mockResolvedValue({ response: "pong" });
    mocks.listExternalModels.mockResolvedValue([]);
    mocks.getExternalLlmKeyConfigured.mockResolvedValue(false);
    mocks.getDaemonVersion.mockResolvedValue("0.12.0");
    mocks.getOnDeviceModel.mockResolvedValue({ loaded: null, selected: null, models: [] });
    mocks.getSystemInfo.mockResolvedValue({
      total_ram_gb: 16,
      available_ram_gb: 10,
      has_metal: true,
      has_cuda: false,
      os: "macOS",
      arch: "arm64",
      recommended_builtin: "qwen3-4b-instruct-2507",
    });
    mocks.downloadOnDeviceModel.mockResolvedValue(undefined);
    mocks.getSetupStatus.mockResolvedValue({
      anthropic_key_configured: false,
      local_model_loaded: false,
    });
  });

  it("shows both role labels and their model names in the cloud row meta when Anthropic is configured", async () => {
    mocks.getApiKey.mockResolvedValue("sk-ant-***configured");
    mocks.getModelChoice.mockResolvedValue(["claude-opus-4-6", "claude-haiku-4-5-20251001"]);
    renderSection();

    expect(
      await screen.findByText("Anthropic · Everyday model: Opus 4.6 · Synthesis model: Haiku 4.5")
    ).toBeInTheDocument();
  });

  it("attributes an Ollama endpoint to the Local server row, not the Cloud provider row", async () => {
    mocks.getExternalLlm.mockResolvedValue(["http://localhost:11434/v1", "llama3.2:3b"]);
    renderSection();

    // The Everyday/Synthesis job rows also surface "Ollama (local) ·
    // llama3.2:3b" (mix-and-match), so scope to the Local server row itself.
    const localRow = screen.getByText("Local server").closest("button")!;
    expect(await within(localRow).findByText("Ollama (local) · llama3.2:3b")).toBeInTheDocument();
    // Cloud row stays on its unconfigured hint — the same saved slot never
    // shows up in both provider rows.
    const cloudRow = screen.getByText("Cloud provider").closest("button")!;
    expect(within(cloudRow).getByText(/Anthropic, OpenAI, Gemini, Groq, and more/)).toBeInTheDocument();
  });

  // Mutation-proof target: reintroducing the old `!isConfigured &&` gate
  // around the on-device row must make this assertion fail.
  it("keeps the on-device row present even while Anthropic is configured", async () => {
    mocks.getApiKey.mockResolvedValue("sk-ant-***configured");
    renderSection();

    // Wait for the cloud row to render its configured meta, proving
    // isConfigured has resolved true, before checking the on-device row.
    const cloudRow = (await screen.findByText("Cloud provider")).closest("button")!;
    await within(cloudRow).findByText("Anthropic ·", { exact: false });
    expect(screen.getByText("On-device model")).toBeInTheDocument();
  });

  it("hides the provider body until the cloud row is expanded, then reveals its preset chips", async () => {
    renderSection();

    // Wait for the cloud row's meta to settle before asserting absence —
    // asserting before queries resolve would pass regardless of the bug.
    const cloudRow = (await screen.findByText("Cloud provider")).closest("button")!;
    await within(cloudRow).findByText(/Anthropic, OpenAI, Gemini, Groq, and more/);
    expect(screen.queryByRole("group", { name: "Provider" })).not.toBeInTheDocument();

    await userEvent.click(cloudRow);

    expect(await screen.findByRole("group", { name: "Provider" })).toBeInTheDocument();
  });

  // Pins the mix-and-match display logic: the two job rows walk independent
  // priority chains, so their rows can show different sources at once.
  it("shows the Anthropic routine model in the Everyday row's meta when Anthropic is configured", async () => {
    mocks.getApiKey.mockResolvedValue("sk-ant-***configured");
    mocks.getModelChoice.mockResolvedValue(["claude-haiku-4-5-20251001", "claude-sonnet-4-6"]);
    renderSection();

    const everydayRow = (await screen.findByText("Everyday model")).closest("button")!;
    expect(await within(everydayRow).findByText("Anthropic · Haiku 4.5")).toBeInTheDocument();
  });

  it("falls back the Synthesis row to the cloud-required hint, while the Everyday row still shows the on-device model", async () => {
    mocks.getOnDeviceModel.mockResolvedValue({
      loaded: "qwen3-4b-instruct-2507",
      selected: "qwen3-4b-instruct-2507",
      models: [{ id: "qwen3-4b-instruct-2507", display_name: "Qwen3 4B Instruct", cached: true }],
    });
    renderSection();

    // Wait for the on-device query to settle via the Everyday row first —
    // asserting on the Synthesis row before it resolves would pass on the
    // still-loading placeholder regardless of the bug.
    const everydayRow = (await screen.findByText("Everyday model")).closest("button")!;
    expect(await within(everydayRow).findByText("Qwen3 4B Instruct")).toBeInTheDocument();

    const synthesisRow = screen.getByText("Synthesis model").closest("button")!;
    expect(within(synthesisRow).getByText("Page synthesis requires a cloud or local-server model")).toBeInTheDocument();
  });

  it("shows the On-device row's capability hint alongside its state-derived meta", async () => {
    mocks.getOnDeviceModel.mockResolvedValue({
      loaded: "qwen3-4b-instruct-2507",
      selected: "qwen3-4b-instruct-2507",
      models: [{ id: "qwen3-4b-instruct-2507", display_name: "Qwen3 4B Instruct", cached: true }],
    });
    renderSection();

    const onDeviceRow = screen.getByText("On-device model").closest("button")!;
    expect(
      within(onDeviceRow).getByText("Handles everyday tasks entirely on this device — too small for synthesis")
    ).toBeInTheDocument();
    expect(await within(onDeviceRow).findByText("Qwen3 4B Instruct · Running")).toBeInTheDocument();
  });
});

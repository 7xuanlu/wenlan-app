// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import "../../i18n";

const mocks = vi.hoisted(() => ({
  getDaemonVersion: vi.fn(),
  getExternalLlm: vi.fn(),
  setExternalLlm: vi.fn(),
  testExternalLlm: vi.fn(),
  listExternalModels: vi.fn(),
  getExternalLlmKeyConfigured: vi.fn(),
  getApiKey: vi.fn(),
}));
vi.mock("../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/tauri")>();
  return { ...actual, ...mocks };
});

import AnyProviderCard from "./AnyProviderCard";

function renderCard(props: Partial<ComponentProps<typeof AnyProviderCard>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AnyProviderCard {...props} />
    </QueryClientProvider>
  );
}

describe("AnyProviderCard", () => {
  // NOTE: reset runs in afterEach, not beforeEach — see
  // src/hooks/useDaemonVersion.test.tsx for why. Resetting a vi.fn() in
  // beforeEach immediately before it's reconfigured with mockRejectedValue
  // and consumed by a react-query queryFn deterministically triggers a
  // false-positive "unhandled rejection" failure on this project's pinned
  // vitest 4.1.5 + @tanstack/react-query 5.100.9 + React 19 combination.
  afterEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
  });

  beforeEach(() => {
    mocks.getDaemonVersion.mockResolvedValue("0.12.0");
    mocks.getExternalLlm.mockResolvedValue([null, null]);
    mocks.getExternalLlmKeyConfigured.mockResolvedValue(false);
    mocks.getApiKey.mockResolvedValue(null);
    mocks.listExternalModels.mockResolvedValue(["llama3.2:3b"]);
    mocks.setExternalLlm.mockResolvedValue(undefined);
    mocks.testExternalLlm.mockResolvedValue({ response: "pong" });
  });

  it("preset fills the endpoint and discovers models", async () => {
    renderCard();
    await userEvent.selectOptions(await screen.findByLabelText("Provider"), "ollama");
    expect(screen.getByLabelText("Endpoint URL")).toHaveValue("http://localhost:11434/v1");
    await waitFor(() =>
      expect(mocks.listExternalModels).toHaveBeenCalledWith("http://localhost:11434/v1", null)
    );
  });

  it("keyed presets are disabled with explanation below daemon 0.13", async () => {
    renderCard();
    await userEvent.selectOptions(await screen.findByLabelText("Provider"), "openai");
    // Brief's i18n copy reads "API keys ... need Wenlan daemon 0.13+" (correct
    // subject-verb agreement for the plural "API keys"); matching that here.
    expect(await screen.findByText(/need Wenlan daemon 0.13\+/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    // key field hidden below 0.13
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
  });

  it("keyed preset works on 0.13: key field shown, save passes key, Applied note", async () => {
    mocks.getDaemonVersion.mockResolvedValue("0.13.0");
    renderCard();
    await userEvent.selectOptions(await screen.findByLabelText("Provider"), "openai");
    const keyField = await screen.findByLabelText("API key");
    await userEvent.type(keyField, "sk-test");
    await userEvent.type(screen.getByLabelText("Model"), "gpt-4o-mini");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.setExternalLlm).toHaveBeenCalledWith(
        "https://api.openai.com/v1", "gpt-4o-mini", "sk-test"
      )
    );
    expect(await screen.findByText(/Applied/)).toBeInTheDocument();
  });

  it("keyless save on 0.12 omits the key and shows restart note", async () => {
    renderCard();
    await userEvent.selectOptions(await screen.findByLabelText("Provider"), "ollama");
    await userEvent.type(screen.getByLabelText("Model"), "llama3.2:3b");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.setExternalLlm).toHaveBeenCalledWith(
        "http://localhost:11434/v1", "llama3.2:3b", undefined
      )
    );
    expect(await screen.findByText(/Restart Wenlan to apply/)).toBeInTheDocument();
  });

  it("discovery failure falls back to free-text model entry with hint", async () => {
    mocks.listExternalModels.mockRejectedValue(new Error("ECONNREFUSED"));
    renderCard();
    await userEvent.selectOptions(await screen.findByLabelText("Provider"), "ollama");
    expect(await screen.findByText(/type a model name/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toBeEnabled();
  });

  it("test button shows verbatim daemon error", async () => {
    mocks.testExternalLlm.mockRejectedValue(new Error("LLM request failed: 401 Unauthorized"));
    renderCard();
    await userEvent.selectOptions(await screen.findByLabelText("Provider"), "ollama");
    await userEvent.type(screen.getByLabelText("Model"), "llama3.2:3b");
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText(/401 Unauthorized/)).toBeInTheDocument();
  });

  it("shows the Anthropic precedence warning when an Anthropic key is configured", async () => {
    mocks.getApiKey.mockResolvedValue("sk-ant-configured");
    renderCard();
    expect(await screen.findByText(/Anthropic takes precedence/)).toBeInTheDocument();
  });
});

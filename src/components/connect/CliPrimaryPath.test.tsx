// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../i18n";

const mocks = vi.hoisted(() => ({
  getWenlanMcpEntry: vi.fn(),
  clipboardWrite: vi.fn(),
}));
vi.mock("../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/tauri")>();
  return { ...actual, ...mocks };
});

import CliPrimaryPath, { type CliClientType } from "./CliPrimaryPath";

function renderPath(clientType: CliClientType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CliPrimaryPath clientType={clientType} />
    </QueryClientProvider>,
  );
}

const COMMAND1 = "claude plugin marketplace add 7xuanlu/wenlan";
const COMMAND2 = "claude plugin install wenlan@7xuanlu-wenlan";

describe("CliPrimaryPath", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.getWenlanMcpEntry.mockResolvedValue({ command: "npx", args: ["-y", "wenlan-mcp"] });
    mocks.clipboardWrite.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders one copy button per command", async () => {
    renderPath("claude_code");
    const commandCopyButtons = await screen.findAllByRole("button", {
      name: /^Copy command:/,
    });
    expect(commandCopyButtons).toHaveLength(2);
  });

  it("clicking a command's copy button writes exactly that command's text", async () => {
    renderPath("claude_code");
    const buttons = await screen.findAllByRole("button", { name: /^Copy command:/ });

    fireEvent.click(buttons[1]);
    await waitFor(() => {
      expect(mocks.clipboardWrite).toHaveBeenCalledWith(COMMAND2);
    });
    expect(mocks.clipboardWrite).not.toHaveBeenCalledWith(COMMAND1);
  });

  it("does not truncate command text — it wraps instead of clipping", async () => {
    renderPath("claude_code");
    const code = await screen.findByText(COMMAND1);
    expect(code.className).not.toContain("truncate");
  });

  it("a command's Copied state resets after ~2s without affecting a sibling command", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPath("claude_code");
    const buttons = await screen.findAllByRole("button", { name: /^Copy command:/ });

    fireEvent.click(buttons[0]);
    await waitFor(() => expect(mocks.clipboardWrite).toHaveBeenCalledWith(COMMAND1));
    expect(buttons[0]).toHaveTextContent("Copied");
    expect(buttons[1]).toHaveTextContent("Copy");

    act(() => {
      vi.advanceTimersByTime(2100);
    });
    await waitFor(() => expect(buttons[0]).toHaveTextContent("Copy"));
    expect(buttons[0]).not.toHaveTextContent("Copied");
  });

  it("the 'Copy setup prompt' button's Copied state also resets after ~2s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPath("claude_code");
    const promptButton = await screen.findByRole("button", { name: "Copy setup prompt" });

    fireEvent.click(promptButton);
    await waitFor(() => expect(promptButton).toHaveTextContent("Prompt copied"));

    act(() => {
      vi.advanceTimersByTime(2100);
    });
    await waitFor(() => expect(promptButton).toHaveTextContent("Copy setup prompt"));
  });
});

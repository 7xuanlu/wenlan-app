// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../i18n";

const mocks = vi.hoisted(() => ({
  detectMcpClients: vi.fn(),
  writeMcpConfig: vi.fn(),
  getWenlanMcpEntry: vi.fn(),
  clipboardWrite: vi.fn(),
}));
vi.mock("../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/tauri")>();
  return { ...actual, ...mocks };
});

import ClientSetupList from "./ClientSetupList";

const CLIENTS = [
  { name: "Claude Code", client_type: "claude_code", config_path: "~/.claude.json", detected: true, already_configured: false },
  { name: "Codex CLI", client_type: "codex_cli", config_path: "~/.codex/config.toml", detected: true, already_configured: false },
  { name: "Cursor", client_type: "cursor", config_path: "~/.cursor/mcp.json", detected: true, already_configured: false },
  { name: "Claude Desktop", client_type: "claude_desktop", config_path: "~/Library/.../config.json", detected: true, already_configured: false },
  { name: "Gemini CLI", client_type: "gemini_cli", config_path: "~/.gemini/settings.json", detected: true, already_configured: false },
];

function renderList() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ClientSetupList />
    </QueryClientProvider>,
  );
}

describe("ClientSetupList — §9.3 plugin-first matrix", () => {
  afterEach(() => Object.values(mocks).forEach((m) => m.mockReset()));
  beforeEach(() => {
    mocks.detectMcpClients.mockResolvedValue(CLIENTS);
    mocks.getWenlanMcpEntry.mockResolvedValue({ command: "npx", args: ["-y", "wenlan-mcp"] });
    mocks.writeMcpConfig.mockResolvedValue(undefined);
    mocks.clipboardWrite.mockResolvedValue(undefined);
  });

  it("Claude Code leads with the plugin commands", async () => {
    renderList();
    expect(await screen.findByText("claude plugin marketplace add 7xuanlu/wenlan")).toBeInTheDocument();
    expect(screen.getByText("claude plugin install wenlan@7xuanlu")).toBeInTheDocument();
  });

  it("Codex leads with codex mcp add using the real command+args", async () => {
    renderList();
    expect(await screen.findByText("codex mcp add wenlan -- npx -y wenlan-mcp")).toBeInTheDocument();
  });

  it("Copy setup prompt writes the full agent prompt to the clipboard", async () => {
    renderList();
    const buttons = await screen.findAllByRole("button", { name: /Copy setup prompt/ });
    await userEvent.click(buttons[0]); // Claude Code card
    expect(mocks.clipboardWrite).toHaveBeenCalledTimes(1);
    expect(mocks.clipboardWrite.mock.calls[0][0]).toContain("claude plugin install wenlan@7xuanlu");
  });

  it("GUI clients keep the one-click Set up as their primary action", async () => {
    renderList();
    // Cursor / Claude Desktop / Gemini CLI → 3 primary "Set up" buttons.
    const setUps = await screen.findAllByRole("button", { name: "Set up" });
    expect(setUps.length).toBeGreaterThanOrEqual(3);
  });

  it("shipped copy never references .mcpb or .codex-plugin", async () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ClientSetupList />
      </QueryClientProvider>,
    );
    await screen.findByText("claude plugin install wenlan@7xuanlu");
    expect(container.textContent).not.toContain(".mcpb");
    expect(container.textContent).not.toContain(".codex-plugin");
  });
});

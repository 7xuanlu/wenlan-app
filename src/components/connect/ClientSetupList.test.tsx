// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../i18n";
import { resources } from "../../i18n/resources";

const mocks = vi.hoisted(() => ({
  detectMcpClients: vi.fn(),
  writeMcpConfig: vi.fn(),
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

const COMMAND1 = "/plugin marketplace add 7xuanlu/wenlan";
const COMMAND2 = "/plugin install wenlan@7xuanlu-wenlan";
const COMMAND3 = "/setup";

function renderList(qc: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={qc}>
      <ClientSetupList />
    </QueryClientProvider>,
  );
}

/** Finds the row shell (ClientRow's `rounded-xl` wrapper div) for a given
 *  client name, so assertions can be scoped `within` a single card instead
 *  of matching anywhere in the document. */
function rowFor(name: string) {
  return screen.getByText(name).closest("div.rounded-xl") as HTMLElement;
}

function openCommands(row: HTMLElement) {
  return userEvent.click(within(row).getByText("Show terminal commands"));
}

describe("ClientSetupList — plugin-first Claude Code, one-click everyone else", () => {
  afterEach(() => Object.values(mocks).forEach((m) => m.mockReset()));
  beforeEach(() => {
    mocks.detectMcpClients.mockResolvedValue(CLIENTS);
    mocks.writeMcpConfig.mockResolvedValue(undefined);
    mocks.clipboardWrite.mockResolvedValue(undefined);
  });

  it("Claude Code leads with the plugin-install prompt, not a one-click Set up", async () => {
    renderList();
    await screen.findByRole("button", { name: "Copy setup prompt" });
    const row = rowFor("Claude Code");
    expect(within(row).getByRole("button", { name: "Copy setup prompt" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Set up" })).not.toBeInTheDocument();
  });

  it("expanding the disclosure shows all three commands", async () => {
    renderList();
    await screen.findByRole("button", { name: "Copy setup prompt" });
    const row = rowFor("Claude Code");
    await openCommands(row);
    expect(within(row).getByText(COMMAND1)).toBeInTheDocument();
    expect(within(row).getByText(COMMAND2)).toBeInTheDocument();
    expect(within(row).getByText(COMMAND3)).toBeInTheDocument();
  });

  it("Codex CLI behaves like an ordinary GUI client — one-click Set up, no plugin path", async () => {
    renderList();
    await screen.findByText("Codex CLI");
    const row = rowFor("Codex CLI");
    const setUp = within(row).getByRole("button", { name: "Set up" });
    expect(setUp).toBeInTheDocument();
    expect(within(row).queryByText("Show terminal commands")).not.toBeInTheDocument();
    await userEvent.click(setUp);
    expect(mocks.writeMcpConfig).toHaveBeenCalledWith("codex_cli");
  });

  it("'Copy setup prompt' writes the full agent-runnable prompt to the clipboard", async () => {
    renderList();
    await screen.findByRole("button", { name: "Copy setup prompt" });
    const row = rowFor("Claude Code");
    const button = within(row).getByRole("button", { name: "Copy setup prompt" });
    await userEvent.click(button);
    expect(mocks.clipboardWrite).toHaveBeenCalledTimes(1);
    const copied = mocks.clipboardWrite.mock.calls[0][0] as string;
    expect(copied).toContain(COMMAND1);
    expect(copied).toContain(COMMAND2);
    expect(copied).toContain(COMMAND3);
  });

  it("GUI clients keep the one-click Set up as their primary action; Claude Code never gets one outside Advanced", async () => {
    renderList();
    // Codex CLI / Cursor / Claude Desktop / Gemini CLI → 4 primary "Set up" buttons.
    const setUps = await screen.findAllByRole("button", { name: "Set up" });
    expect(setUps).toHaveLength(4);

    const row = rowFor("Claude Code");
    expect(within(row).queryByRole("button", { name: "Set up" })).not.toBeInTheDocument();
    expect(within(row).getByText("Advanced")).toBeInTheDocument();
  });

  it("shipped copy never references .mcpb or .codex-plugin — DOM, the copied prompt, and every locale", async () => {
    const { container } = renderList();
    await screen.findByRole("button", { name: "Copy setup prompt" });
    expect(container.textContent).not.toContain(".mcpb");
    expect(container.textContent).not.toContain(".codex-plugin");

    const row = rowFor("Claude Code");
    const button = within(row).getByRole("button", { name: "Copy setup prompt" });
    await userEvent.click(button);
    expect(mocks.clipboardWrite).toHaveBeenCalledTimes(1);
    const copiedPrompt = mocks.clipboardWrite.mock.calls[0][0] as string;
    expect(copiedPrompt).not.toContain(".mcpb");
    expect(copiedPrompt).not.toContain(".codex-plugin");

    // en is only one of three shipped locales — scan every connectMatrix
    // string in every locale, not just what happened to render/copy in en.
    for (const [locale, bundle] of Object.entries(resources)) {
      const connectMatrix = (bundle.translation as Record<string, unknown>).connectMatrix as Record<
        string,
        string
      >;
      for (const [key, value] of Object.entries(connectMatrix)) {
        expect(value, `${locale}.connectMatrix.${key}`).not.toContain(".mcpb");
        expect(value, `${locale}.connectMatrix.${key}`).not.toContain(".codex-plugin");
      }

      // These are shell commands, not prose — a locale/translation pass must
      // never "localize" a slug. Pin the exact byte value in every locale so
      // a drifted install string fails loudly instead of shipping silently.
      expect(connectMatrix.claudeCodeCommand1, `${locale}.connectMatrix.claudeCodeCommand1`).toBe(
        COMMAND1,
      );
      expect(connectMatrix.claudeCodeCommand2, `${locale}.connectMatrix.claudeCodeCommand2`).toBe(
        COMMAND2,
      );
      expect(connectMatrix.claudeCodeCommand3, `${locale}.connectMatrix.claudeCodeCommand3`).toBe(
        COMMAND3,
      );

      // The copy-pasteable setup-prompt strings embed these same commands
      // verbatim (inside backticks) — pin them there too, so a translation
      // pass can't drift the copy-pasted command while leaving the
      // standalone key alone.
      expect(
        connectMatrix.claudeCodePrompt,
        `${locale}.connectMatrix.claudeCodePrompt`,
      ).toContain(COMMAND1);
      expect(
        connectMatrix.claudeCodePrompt,
        `${locale}.connectMatrix.claudeCodePrompt`,
      ).toContain(COMMAND2);
      expect(
        connectMatrix.claudeCodePrompt,
        `${locale}.connectMatrix.claudeCodePrompt`,
      ).toContain(COMMAND3);
    }
  });

  it("undetected clients show Not installed, not install commands or Set up", async () => {
    mocks.detectMcpClients.mockResolvedValue([
      { name: "Claude Code", client_type: "claude_code", config_path: "~/.claude.json", detected: false, already_configured: false },
      { name: "Codex CLI", client_type: "codex_cli", config_path: "~/.codex/config.toml", detected: false, already_configured: false },
    ]);
    renderList();
    for (const name of ["Claude Code", "Codex CLI"]) {
      const nameEl = await screen.findByText(name);
      const row = nameEl.closest("div.rounded-xl") as HTMLElement;
      expect(within(row).getByText("Not installed")).toBeInTheDocument();
      expect(within(row).queryByText("Advanced")).not.toBeInTheDocument();
      expect(within(row).queryByText(/plugin marketplace add/)).not.toBeInTheDocument();
      expect(within(row).queryByRole("button", { name: "Copy setup prompt" })).not.toBeInTheDocument();
      expect(within(row).queryByRole("button", { name: "Set up" })).not.toBeInTheDocument();
    }
  });

  it("a failed Set up shows the error in the danger-text token, not a raw Tailwind color", async () => {
    mocks.writeMcpConfig.mockRejectedValue(new Error("permission denied"));
    renderList();
    const setUps = await screen.findAllByRole("button", { name: "Set up" });
    await userEvent.click(setUps[0]); // Codex CLI (first GUI-style client)
    const errorEl = await screen.findByRole("alert");
    expect(errorEl).toHaveTextContent(/permission denied/);
    expect(errorEl).toHaveStyle({ color: "var(--mem-status-danger-text)" });
    expect(errorEl.className).not.toContain("text-red-500");
  });

  it("the Advanced one-click button is the Button primitive (secondary/sm) and still writes the config", async () => {
    renderList();
    await screen.findByRole("button", { name: "Copy setup prompt" });
    const row = rowFor("Claude Code");
    await userEvent.click(within(row).getByText("Advanced"));
    const advancedButton = within(row).getByRole("button", { name: "Or write the config for me" });
    // Button primitive's secondary/sm class markers (primitives.tsx BUTTON_VARIANT_CLASS.secondary / BUTTON_SIZE_CLASS.sm) —
    // a mutation back to the old raw <button> loses these.
    expect(advancedButton.className).toContain("border-[var(--mem-border)]");
    expect(advancedButton.className).toContain("h-[26px]");
    await userEvent.click(advancedButton);
    expect(mocks.writeMcpConfig).toHaveBeenCalledWith("claude_code");
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../i18n";

const mocks = vi.hoisted(() => ({
  getRemoteAccessStatus: vi.fn(),
  listAgents: vi.fn(),
  clipboardWrite: vi.fn(),
}));
vi.mock("../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/tauri")>();
  return { ...actual, ...mocks };
});

import WebPlatformCards from "./WebPlatformCards";

function renderCards() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WebPlatformCards />
    </QueryClientProvider>
  );
}

describe("WebPlatformCards", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.listAgents.mockResolvedValue([]);
    mocks.clipboardWrite.mockResolvedValue(undefined);
  });

  // Redesign spec §6/§8: the no-auth warning used to render 3 times (twice
  // here, once in RemoteAccessPanel) — now it renders exactly once, in
  // RemoteAccessPanel only (see RemoteAccessPanel.tsx and
  // AgentsSection.test.tsx for the composed once-only proof). This card no
  // longer carries its own copy of the warning at all.
  it("does not duplicate the no-auth boundary warning — that lives solely in RemoteAccessPanel now", async () => {
    mocks.getRemoteAccessStatus.mockResolvedValue({
      status: "connected", tunnel_url: "https://x.trycloudflare.com", token: "t", relay_url: null,
    });
    renderCards();
    expect(await screen.findByText("Claude.ai")).toBeInTheDocument();
    expect(screen.getByText("ChatGPT.com")).toBeInTheDocument();
    expect(screen.queryByText(/treat it like a password/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no authentication/i)).not.toBeInTheDocument();
  });

  it("shows the connection URL when the tunnel is up", async () => {
    mocks.getRemoteAccessStatus.mockResolvedValue({
      status: "connected", tunnel_url: "https://x.trycloudflare.com", token: "t",
      relay_url: "https://relay.example/abc",
    });
    renderCards();
    // relay URL preferred (what users hand to Claude.ai/ChatGPT)
    expect((await screen.findAllByText("https://relay.example/abc")).length).toBeGreaterThan(0);
  });

  it("prompts to enable Remote Access when the tunnel is off", async () => {
    mocks.getRemoteAccessStatus.mockResolvedValue({ status: "off" });
    renderCards();
    expect((await screen.findAllByText(/Turn on Remote Access/)).length).toBeGreaterThan(0);
  });

  it("copy uses clipboardWrite with the /mcp-suffixed tunnel URL (no relay_url), not the raw clipboard API", async () => {
    mocks.getRemoteAccessStatus.mockResolvedValue({
      status: "connected", tunnel_url: "https://x.trycloudflare.com", token: "t", relay_url: null,
    });
    renderCards();
    const copyButtons = await screen.findAllByRole("button", { name: "Copy URL" });
    fireEvent.click(copyButtons[0]);
    await waitFor(() => {
      expect(mocks.clipboardWrite).toHaveBeenCalledWith("https://x.trycloudflare.com/mcp");
    });
  });

  it("Claude card is install-only — the claude.ai install steps, a relay note, and no connector step", async () => {
    mocks.getRemoteAccessStatus.mockResolvedValue({
      status: "connected", tunnel_url: "https://x.trycloudflare.com", token: "t", relay_url: null,
    });
    renderCards();
    expect(
      await screen.findByText("Step 1 — Add Wenlan to claude.ai"),
    ).toBeInTheDocument();
    // Marketplace repo string, exact li copy. The repo MUST be 7xuanlu/wenlan —
    // its self-hosted marketplace (name "7xuanlu-wenlan") installs the plugin
    // UNPINNED, direct from source, so users track the latest release. Backend
    // 048d77a8 briefly retired it in favour of the 7xuanlu/claude-plugins
    // catalog, but ace7ae18 (2026-07-12) reinstated it deliberately.
    //
    // Do NOT "fix" this to 7xuanlu/claude-plugins. That catalog resolves too,
    // but it pins wenlan to ref v0.12.1 (a frozen release) and describes it as
    // "a personal AI memory layer" — copy this product does not use.
    expect(
      screen.getByText(
        "Enter the marketplace repo 7xuanlu/wenlan and choose Sync",
      ),
    ).toBeInTheDocument();
    // Honesty note: skills in chat, MCP connectors in Cowork. Never calls
    // Wenlan itself "a plugin" (standing copy rule).
    expect(
      screen.getByText(
        "Wenlan's skills work in chat; Cowork also gets the MCP connectors.",
      ),
    ).toBeInTheDocument();
    // The relay note replaces the old Step-2 connector flow: the plugin now
    // reaches memory through the relay, so there is nothing to paste.
    expect(
      screen.getByText(
        "Once Remote access is on, the connector reaches your memory through Wenlan's relay automatically — nothing to paste.",
      ),
    ).toBeInTheDocument();
    // The connector step is gone and must not reappear.
    expect(screen.queryByText("Step 2 — Connect your memory")).not.toBeInTheDocument();
  });

  it("install steps render even when the tunnel is off (install is independent of the connector)", async () => {
    mocks.getRemoteAccessStatus.mockResolvedValue({ status: "off" });
    renderCards();
    expect(
      await screen.findByText("Step 1 — Add Wenlan to claude.ai"),
    ).toBeInTheDocument();
    expect((await screen.findAllByText(/Turn on Remote Access/)).length).toBeGreaterThan(0);
  });

  // Behavior (b), mutation-proof: with remote connected, the URL row lives only
  // in the ChatGPT card. The Claude card is install-only — no URL, no connector
  // step, no connector-settings button. Re-add urlRow("claude") or the connector
  // step and one of these assertions fails.
  it("renders the URL row only in the ChatGPT card, never the Claude card", async () => {
    mocks.getRemoteAccessStatus.mockResolvedValue({
      status: "connected", tunnel_url: "https://x.trycloudflare.com", token: "t",
      relay_url: "https://relay.example/abc",
    });
    renderCards();
    // Wait for the remote-status query to resolve: the URL then appears exactly
    // once — the ChatGPT card only, never the Claude card (getAllByText length 1
    // catches both a missing URL and a duplicated one).
    await waitFor(() => {
      expect(screen.getAllByText("https://relay.example/abc")).toHaveLength(1);
    });
    // The Claude card rendered its install-only relay note (no connector step).
    expect(
      screen.getByText(
        "Once Remote access is on, the connector reaches your memory through Wenlan's relay automatically — nothing to paste.",
      ),
    ).toBeInTheDocument();
    // Exactly one Copy URL button (ChatGPT); none in the Claude card.
    expect(screen.getAllByRole("button", { name: "Copy URL" })).toHaveLength(1);
    // The deleted connector affordances must not reappear.
    expect(screen.queryByText("Step 2 — Connect your memory")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open connector settings" }),
    ).not.toBeInTheDocument();
  });
});

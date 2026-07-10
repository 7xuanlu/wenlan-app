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

  it("both web cards carry the no-auth boundary warning (council change f)", async () => {
    mocks.getRemoteAccessStatus.mockResolvedValue({
      status: "connected", tunnel_url: "https://x.trycloudflare.com", token: "t", relay_url: null,
    });
    renderCards();
    expect(await screen.findByText("Claude.ai")).toBeInTheDocument();
    expect(screen.getByText("ChatGPT.com")).toBeInTheDocument();
    expect(screen.getAllByText(/treat it like a password/)).toHaveLength(2);
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
});

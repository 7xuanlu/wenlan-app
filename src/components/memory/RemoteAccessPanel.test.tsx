import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { i18n } from "../../i18n";
import { RemoteAccessPanel } from "./RemoteAccessPanel";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("../../lib/tauri", () => ({
  toggleRemoteAccess: vi.fn().mockResolvedValue({ status: "starting" }),
  getRemoteAccessStatus: vi.fn().mockResolvedValue({ status: "off" }),
  testRemoteMcpConnection: vi.fn().mockResolvedValue({ ok: true, latency_ms: 42, error: null }),
  clipboardWrite: vi.fn().mockResolvedValue(undefined),
}));

import {
  toggleRemoteAccess,
  getRemoteAccessStatus,
  testRemoteMcpConnection,
  clipboardWrite,
} from "../../lib/tauri";

function renderPanel(mode: "compact" | "full") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<RemoteAccessPanel mode={mode} />, { wrapper: Wrapper });
}

describe("RemoteAccessPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getRemoteAccessStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "off" });
    (toggleRemoteAccess as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "starting" });
    (testRemoteMcpConnection as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      latency_ms: 42,
      error: null,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await i18n.changeLanguage("en");
  });

  // S7-visual: off is a setting the user chose, not something the app
  // probed — the chip-never-lies invariant says a chip's color may only
  // come from an observation, so "off" renders no chip at all (the Toggle
  // already communicates it).
  it("renders no status chip when disabled — the Toggle already says off", async () => {
    renderPanel("compact");
    await waitFor(() => {
      expect(screen.getByText("Share with web-based AI tools")).toBeInTheDocument();
    });
    expect(screen.queryByText("Off")).not.toBeInTheDocument();
  });

  it("states the no-auth URL boundary before Remote Access is enabled", async () => {
    renderPanel("compact");
    await waitFor(() => {
      expect(screen.getByText("Share with web-based AI tools")).toBeInTheDocument();
    });

    expect(screen.queryByText(/secure tunnel/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no authentication/i)).toBeInTheDocument();
    expect(screen.getByText(/anyone with the URL can access Wenlan/i)).toBeInTheDocument();
    expect(screen.getByText(/turn Remote Access off when unused/i)).toBeInTheDocument();
  });

  it("renders 'Connecting…' when starting", async () => {
    (getRemoteAccessStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "starting" });
    renderPanel("compact");
    await waitFor(() => {
      expect(screen.getByText(/Connecting/i)).toBeInTheDocument();
    });
  });

  it("renders 'Connected' and URL when connected", async () => {
    (getRemoteAccessStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "connected",
      tunnel_url: "https://example.trycloudflare.com",
      token: "secret-token",
      relay_url: "https://relay.origin.dev/abcdef/mcp",
    });
    renderPanel("compact");
    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });
    expect(screen.getByText("https://relay.origin.dev/abcdef/mcp")).toBeInTheDocument();
  });

  it("clicking toggle calls toggleRemoteAccess", async () => {
    renderPanel("compact");
    await waitFor(() => {
      expect(screen.getByText("Share with web-based AI tools")).toBeInTheDocument();
    });
    // S7-visual: the hand-rolled role="switch" button became the Toggle
    // primitive, which uses aria-pressed instead (button + aria-pressed,
    // not the switch pattern).
    fireEvent.click(screen.getByRole("button", { pressed: false }));
    await waitFor(() => {
      expect(toggleRemoteAccess).toHaveBeenCalledWith(true);
    });
  });

  it("Copy URL button shows 'Copied!' briefly", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    (getRemoteAccessStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "connected",
      tunnel_url: "https://example.trycloudflare.com",
      token: "secret-token",
      relay_url: null,
    });
    renderPanel("compact");
    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });
    const copyBtn = screen.getByRole("button", { name: /^Copy URL$/i });
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledWith("https://example.trycloudflare.com/mcp");
    });
    expect(screen.getByText(/Copied!/i)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    await waitFor(() => {
      expect(screen.queryByText(/Copied!/i)).not.toBeInTheDocument();
    });
  });

  it("Test connection button calls testRemoteMcpConnection and shows 'Connected (NNN ms)'", async () => {
    (getRemoteAccessStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "connected",
      tunnel_url: "https://example.trycloudflare.com",
      token: "secret-token",
      relay_url: null,
    });
    renderPanel("compact");
    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });
    const testBtn = screen.getByRole("button", { name: /Test connection/i });
    fireEvent.click(testBtn);
    await waitFor(() => {
      expect(testRemoteMcpConnection).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText(/Connected \(42 ms\)/i)).toBeInTheDocument();
    });
  });

  it("Test connection failure shows error message", async () => {
    (testRemoteMcpConnection as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      latency_ms: null,
      error: "timeout after 5s",
    });
    (getRemoteAccessStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "connected",
      tunnel_url: "https://example.trycloudflare.com",
      token: "secret-token",
      relay_url: null,
    });
    renderPanel("compact");
    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Test connection/i }));
    await waitFor(() => {
      expect(screen.getByText(/timeout after 5s/i)).toBeInTheDocument();
    });
  });

  it("compact mode does NOT render Token section", async () => {
    (getRemoteAccessStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "connected",
      tunnel_url: "https://example.trycloudflare.com",
      token: "secret-token",
      relay_url: null,
    });
    renderPanel("compact");
    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Token/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Rotate$/i })).not.toBeInTheDocument();
  });

  it("full mode does not imply that the no-auth URL is token protected", async () => {
    (getRemoteAccessStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "connected",
      tunnel_url: "https://example.trycloudflare.com",
      token: "secret-token",
      relay_url: null,
    });
    renderPanel("full");
    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });
    expect(screen.queryByText(/^Token$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Rotate$/i })).not.toBeInTheDocument();
  });

  // i18n (S7): every string in this file used to be hardcoded English, so a
  // zh-Hans/zh-Hant user saw an English panel. These tests pin that the panel
  // actually renders translated text — not a coincidence of English being the
  // fallback locale — including the security-critical no-auth warning, which
  // must survive translation intact (commit 3a272d0).
  it("off state: renders translated title and warning, no status chip in any locale", async () => {
    await i18n.changeLanguage("zh-Hans");
    renderPanel("compact");

    await waitFor(() => {
      expect(screen.getByText("与网页版 AI 工具共享")).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        "将为 Claude.ai 与 ChatGPT 创建一个无需身份验证的公开 HTTPS 地址。任何拥有该地址的人都能访问 Wenlan；不使用时请关闭远程访问。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Share with web-based AI tools")).not.toBeInTheDocument();
    // No chip in either the fallback English or the translated Chinese —
    // proves "off" really renders nothing, not just an untranslated label.
    expect(screen.queryByText("Off")).not.toBeInTheDocument();
    expect(screen.queryByText("关闭")).not.toBeInTheDocument();
  });

  it("starting state: renders translated 'Connecting…' in zh-Hans", async () => {
    (getRemoteAccessStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "starting" });
    await i18n.changeLanguage("zh-Hans");
    renderPanel("compact");

    await waitFor(() => {
      expect(screen.getByText("正在连接…")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Connecting/i)).not.toBeInTheDocument();
  });

  it("connected state (full mode): renders translated URL label, copy/test/reconnect controls, tunnel note, and instructions in zh-Hans", async () => {
    (getRemoteAccessStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "connected",
      tunnel_url: "https://example.trycloudflare.com",
      token: "secret-token",
      relay_url: null,
    });
    await i18n.changeLanguage("zh-Hans");
    renderPanel("full");

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });
    expect(screen.getByText("你的 MCP 地址")).toBeInTheDocument();

    const copyBtn = screen.getByRole("button", { name: /^复制地址$/ });
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledWith("https://example.trycloudflare.com/mcp");
    });
    expect(screen.getByText("已复制!")).toBeInTheDocument();

    const testBtn = screen.getByRole("button", { name: "测试连接" });
    fireEvent.click(testBtn);
    await waitFor(() => {
      expect(testRemoteMcpConnection).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText("已连接（42 毫秒）")).toBeInTheDocument();
    });

    expect(screen.getByText("重新连接")).toBeInTheDocument();
    expect(
      screen.getByText(
        "此隧道地址会在 Mac 休眠或重启后变化。可在“设置 → Agents”中启用稳定中继,免去重新连接。",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "如何连接 Claude.ai 与 ChatGPT" }));
    expect(screen.getByText("Claude.ai")).toBeInTheDocument();
    expect(screen.getByText("ChatGPT")).toBeInTheDocument();
    expect(
      screen.getByText("Settings → Connectors → Add Custom Connector → Paste URL"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Settings → Apps → Advanced settings → Enable Developer mode → Back → Create app → Paste URL (No Auth)",
      ),
    ).toBeInTheDocument();
  });

  it("connected + stable relay: renders the stable URL label and stable note in zh-Hans", async () => {
    (getRemoteAccessStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "connected",
      tunnel_url: "https://example.trycloudflare.com",
      token: "secret-token",
      relay_url: "https://relay.origin.dev/abcdef/mcp",
    });
    await i18n.changeLanguage("zh-Hans");
    renderPanel("full");

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });
    expect(screen.getByText("你的 MCP 地址（稳定）")).toBeInTheDocument();
    expect(
      screen.getByText("此地址是稳定的——不会在 Mac 休眠或重启后变化。"),
    ).toBeInTheDocument();
  });

  it("error state (full mode): renders translated Retry and Reconnect in zh-Hans", async () => {
    (getRemoteAccessStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "error",
      error: "timeout after 5s",
    });
    await i18n.changeLanguage("zh-Hans");
    renderPanel("full");

    await waitFor(() => {
      expect(screen.getByText("重试")).toBeInTheDocument();
    });
    expect(screen.getByText("重新连接")).toBeInTheDocument();
    expect(screen.queryByText("Retry")).not.toBeInTheDocument();
  });

  // S7-visual mutation-proof (b): the down-state chip must surface the
  // daemon's error text verbatim, not a generic "Error" label.
  it("error state: surfaces the verbatim daemon error text", async () => {
    (getRemoteAccessStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "error",
      error: "connection refused: dial tcp 127.0.0.1:7878",
    });
    renderPanel("full");
    await waitFor(() => {
      expect(
        screen.getByText("connection refused: dial tcp 127.0.0.1:7878"),
      ).toBeInTheDocument();
    });
  });

  // S7-visual mutation-proof (c): raw hex/white are banned outright — the
  // Toggle/Button/StatusChip conversion must remove them from the source,
  // not just hide them behind CSS.
  it("has no raw #ef4444 or color: white left in the source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = path.join(process.cwd(), "src/components/memory/RemoteAccessPanel.tsx");
    const source = await fs.readFile(filePath, "utf-8");
    expect(source).not.toMatch(/#ef4444/i);
    expect(source).not.toMatch(/color:\s*["']white["']/i);
  });
});

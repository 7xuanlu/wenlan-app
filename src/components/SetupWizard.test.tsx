import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SetupWizard } from "./SetupWizard";
import { i18n } from "../i18n";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("../lib/tauri", () => ({
  importMemories: vi.fn(),
  shouldShowWizard: vi.fn().mockResolvedValue(true),
  setSetupCompleted: vi.fn().mockResolvedValue(undefined),
  detectMcpClients: vi.fn().mockResolvedValue([]),
  writeMcpConfig: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
  getWenlanMcpEntry: vi.fn().mockResolvedValue({ command: "npx", args: ["-y", "wenlan-mcp"] }),
  getRemoteAccessStatus: vi.fn().mockResolvedValue({ status: "off" }),
  toggleRemoteAccess: vi.fn().mockResolvedValue({ status: "off" }),
  rotateRemoteToken: vi.fn().mockResolvedValue("new-token"),
  testRemoteMcpConnection: vi.fn().mockResolvedValue({ ok: true, latency_ms: 42, error: null }),
  clipboardWrite: vi.fn().mockResolvedValue(undefined),
  getApiKey: vi.fn().mockResolvedValue(null),
  setApiKey: vi.fn().mockResolvedValue(undefined),
  getModelChoice: vi.fn().mockResolvedValue([null, null]),
  setModelChoice: vi.fn().mockResolvedValue(undefined),
  getOnDeviceModel: vi.fn().mockResolvedValue({
    loaded: null,
    selected: "qwen3-4b-instruct-2507",
    models: [{
      id: "qwen3-4b-instruct-2507",
      display_name: "Qwen3 4B",
      param_count: "4B",
      ram_required_gb: 8,
      file_size_gb: 2.7,
      cached: false,
    }],
  }),
  downloadOnDeviceModel: vi.fn().mockResolvedValue(undefined),
  getSystemInfo: vi.fn().mockResolvedValue({
    total_ram_gb: 16,
    available_ram_gb: 10,
    has_metal: true,
    has_cuda: false,
    os: "macOS",
    arch: "arm64",
    recommended_builtin: "qwen3-4b-instruct-2507",
  }),
  getDaemonVersion: vi.fn().mockResolvedValue("0.12.0"),
  daemonMeetsFloor: vi.fn().mockReturnValue(false),
  getExternalLlm: vi.fn().mockResolvedValue([null, null]),
  setExternalLlm: vi.fn().mockResolvedValue(undefined),
  testExternalLlm: vi.fn().mockResolvedValue({ response: "pong" }),
  listExternalModels: vi.fn().mockResolvedValue([]),
  getExternalLlmKeyConfigured: vi.fn().mockResolvedValue(false),
}));

import {
  detectMcpClients,
  writeMcpConfig,
  listAgents,
  setApiKey,
  clipboardWrite,
} from "../lib/tauri";

function renderWizard(
  props: {
    onComplete?: () => void;
    initialStep?: "welcome" | "intelligence-choice" | "import" | "connect" | "verify" | "done";
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const onComplete = props.onComplete ?? vi.fn();
  return {
    onComplete,
    ...render(
      <QueryClientProvider client={queryClient}>
        <SetupWizard onComplete={onComplete} initialStep={props.initialStep} />
      </QueryClientProvider>,
    ),
  };
}

describe("SetupWizard", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage("en");
    (detectMcpClients as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (writeMcpConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (listAgents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (setApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("renders Welcome step by default", () => {
    renderWizard();
    expect(screen.getByText("Welcome to Wenlan")).toBeInTheDocument();
    const tagline = screen.getByText("A living knowledge base your AI tools build as they work.");
    expect(tagline).toBeInTheDocument();
    // Wiki-pages-first: the welcome step must say what Wenlan produces
    // (source-cited pages), not just gesture at "understanding".
    const body = screen.getByText(
      "Your AI tools write what they learn into source-cited pages that refresh between sessions.",
    );
    expect(body).toBeInTheDocument();
    expect(screen.getByText("Everything stays on your device")).toBeInTheDocument();
    // R3 typography ladder: on-scale size only, never an off-scale 15px.
    expect(tagline).toHaveStyle({ fontSize: "var(--mem-text-lg)" });
    expect(body).toHaveStyle({ fontSize: "var(--mem-text-lg)" });
  });

  it("renders Welcome step in Simplified Chinese when selected", async () => {
    await i18n.changeLanguage("zh-Hans");
    renderWizard();

    expect(screen.getByText("欢迎使用文澜")).toBeInTheDocument();
    expect(screen.getByText("所有内容都留在你的设备上")).toBeInTheDocument();
  });

  it('advances from Welcome to intelligence choice on "Get started" click', () => {
    renderWizard();
    fireEvent.click(screen.getByText("Get started"));
    expect(screen.getByText("Choose how Wenlan thinks")).toBeInTheDocument();
  });

  it("lets users save an API key from the intelligence step", async () => {
    renderWizard();
    fireEvent.click(screen.getByText("Get started"));
    fireEvent.click(screen.getByText("Anthropic API key"));

    fireEvent.change(screen.getByPlaceholderText("sk-ant-api03-..."), {
      target: { value: "sk-ant-test-key" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(setApiKey).toHaveBeenCalledWith("sk-ant-test-key");
    });
  });

  it("intelligence step offers device, cloud, and local server", async () => {
    renderWizard();
    fireEvent.click(screen.getByText("Get started"));

    expect(screen.getByText("On-device model")).toBeInTheDocument();
    expect(screen.getByText("Anthropic API key")).toBeInTheDocument();
    expect(screen.getByText("Your own local server")).toBeInTheDocument();
  });

  it("cloud pane offers only the Anthropic key card — no dead cloud-vendor picker (§5.2 honesty fix)", async () => {
    renderWizard();
    fireEvent.click(screen.getByText("Get started"));
    fireEvent.click(screen.getByText("Anthropic API key"));

    expect(screen.getByPlaceholderText("sk-ant-api03-...")).toBeInTheDocument();
    // The 7 keyed cloud vendors the daemon can't actually authenticate must
    // never appear — no vendor pill row exists in this pane at all.
    expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
    expect(screen.queryByText("Groq")).not.toBeInTheDocument();
  });

  it("local pane offers the local-server card scoped to keyless presets", async () => {
    renderWizard();
    fireEvent.click(screen.getByText("Get started"));
    fireEvent.click(screen.getByText("Your own local server"));

    expect(await screen.findByRole("heading", { name: "Your own local server" })).toBeInTheDocument();
    // No key field for any preset in this pane (none of ollama/lmstudio/custom
    // require a key) — the keyed-vendor story is gone from the wizard too.
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
  });

  it("import step offers chat history and vault side by side", async () => {
    renderWizard();
    fireEvent.click(screen.getByText("Get started"));
    fireEvent.click(screen.getByText("Continue"));

    expect(screen.getByText("Bring what you already know")).toBeInTheDocument();
    expect(screen.getByText("Chat history")).toBeInTheDocument();
    expect(screen.getByText("Import chat history")).toBeInTheDocument();
    // VaultConnectCard (Task 6), rendered inline as the second path. It carries
    // its own title — no separate wrapper heading duplicates it.
    expect(screen.getByText("Connect a notes folder")).toBeInTheDocument();
    expect(screen.queryByText("Obsidian vault / notes folder")).not.toBeInTheDocument();
  });

  it("shows chat-history guidance after choosing the chat path and routes directly to connect", async () => {
    renderWizard();
    fireEvent.click(screen.getByText("Get started"));
    fireEvent.click(screen.getByText("Continue"));

    fireEvent.click(screen.getByText("Import chat history"));

    expect(screen.getByText("Import Memories")).toBeInTheDocument();
    expect(screen.getByText(/Settings > Sources/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Skip"));

    await waitFor(() => {
      expect(screen.getByText("Choose tools to connect")).toBeInTheDocument();
    });
  });

  it("connect step separates detected and supported safe tools", async () => {
    (detectMcpClients as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "Cursor",
        client_type: "cursor",
        config_path: "/path/to/cursor",
        detected: true,
        already_configured: false,
      },
      {
        name: "Claude Code",
        client_type: "claude_code",
        config_path: "/path/to/claude.json",
        detected: false,
        already_configured: false,
      },
    ]);

    renderWizard({ initialStep: "connect" });

    await waitFor(() => {
      expect(screen.getByText("Detected on your Mac")).toBeInTheDocument();
      expect(screen.getByText("Supported tools")).toBeInTheDocument();
    });

    expect(screen.getByText("Cursor")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    const [cursorCheckbox, claudeCheckbox] = screen.getAllByRole("checkbox");
    expect(cursorCheckbox).toBeEnabled();
    expect(claudeCheckbox).toBeDisabled();
  });

  it("undetected CLI clients render the disabled checkbox, not the plugin install path", async () => {
    (detectMcpClients as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "Claude Code",
        client_type: "claude_code",
        config_path: "/path/to/claude.json",
        detected: false,
        already_configured: false,
      },
    ]);

    renderWizard({ initialStep: "connect" });

    await waitFor(() => {
      expect(screen.getByText("Claude Code")).toBeInTheDocument();
    });

    // An undetected CLI client can't run a plugin-install command against a
    // binary that isn't there — it must fall through to the generic
    // description, never the plugin path or its Copy button.
    expect(screen.queryByText(/claude plugin marketplace add/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Copy setup prompt/ }),
    ).not.toBeInTheDocument();
  });

  it("connects selected detected tools on continue", async () => {
    (detectMcpClients as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "Cursor",
        client_type: "cursor",
        config_path: "/path/to/cursor",
        detected: true,
        already_configured: false,
      },
    ]);

    renderWizard({ initialStep: "connect" });

    await waitFor(() => {
      expect(screen.getByText("Cursor")).toBeInTheDocument();
    });

    const [cursorCheckbox] = screen.getAllByRole("checkbox");
    await waitFor(() => {
      expect(cursorCheckbox).toBeChecked();
    });

    fireEvent.click(screen.getByText("Continue"));

    await waitFor(() => {
      expect(writeMcpConfig).toHaveBeenCalledWith("cursor");
      expect(screen.getByText("Waiting for your first agent...")).toBeInTheDocument();
    });
  });

  it("stays on connect step when MCP setup fails", async () => {
    (detectMcpClients as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "Cursor",
        client_type: "cursor",
        config_path: "/path/to/cursor",
        detected: true,
        already_configured: false,
      },
    ]);
    (writeMcpConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("setup failed"));

    renderWizard({ initialStep: "connect" });

    await waitFor(() => {
      expect(screen.getByText("Cursor")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Continue"));

    await waitFor(() => {
      expect(writeMcpConfig).toHaveBeenCalledWith("cursor");
      expect(screen.getByText("Choose tools to connect")).toBeInTheDocument();
      expect(screen.queryByText("Waiting for your first agent...")).not.toBeInTheDocument();
      expect(screen.getByText(/setup failed/i)).toBeInTheDocument();
    });
  });

  it("connect step leads detected CLI clients with the plugin path and unchecks their one-click default", async () => {
    (detectMcpClients as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "Claude Code",
        client_type: "claude_code",
        config_path: "/path/to/claude.json",
        detected: true,
        already_configured: false,
      },
      {
        name: "Cursor",
        client_type: "cursor",
        config_path: "/path/to/cursor",
        detected: true,
        already_configured: false,
      },
    ]);

    renderWizard({ initialStep: "connect" });

    // Primary path: the plugin commands render inside the wizard row.
    expect(
      await screen.findByText("claude plugin marketplace add 7xuanlu/wenlan"),
    ).toBeInTheDocument();
    expect(screen.getByText("claude plugin install wenlan@7xuanlu-wenlan")).toBeInTheDocument();

    // One-click demoted for CLI clients: checkbox defaults OFF; GUI stays ON.
    const cursorCheckbox = screen.getByRole("checkbox", { name: "Cursor" });
    await waitFor(() => expect(cursorCheckbox).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Claude Code" })).not.toBeChecked();
    expect(screen.getByText("Or write the config for me")).toBeInTheDocument();
  });

  it("connect step Copy setup prompt copies the Codex prompt with the real command", async () => {
    (detectMcpClients as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "Codex CLI",
        client_type: "codex_cli",
        config_path: "/path/to/config.toml",
        detected: true,
        already_configured: false,
      },
    ]);

    renderWizard({ initialStep: "connect" });

    expect(
      await screen.findByText("codex mcp add wenlan -- npx -y wenlan-mcp"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copy setup prompt" }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(1));
    expect(
      (clipboardWrite as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toContain("codex mcp add wenlan -- npx -y wenlan-mcp");
  });

  it("verify step skips waiting UX when agents already wrote in the past", async () => {
    (listAgents as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "Claude",
        client_type: "claude_code",
        first_seen_at: Math.floor(Date.now() / 1000) - 86400,
        last_seen_at: Math.floor(Date.now() / 1000) - 3600,
        memory_count: 5,
      },
    ]);

    renderWizard({ initialStep: "verify" });

    await waitFor(() => {
      expect(screen.getByText("You're all set.")).toBeInTheDocument();
    });

    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.queryByText("Back")).not.toBeInTheDocument();

    // allSetBody1/allSetBody2: wiki-pages-first, not memory-first.
    expect(
      screen.getByText(
        "Keep using your AI tools normally. Wenlan turns what they learn into pages you can read and cite.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Pages refresh between sessions, so the next one starts where the last ended."),
    ).toBeInTheDocument();
  });

  it("renders skip-path Done copy without a back button", async () => {
    renderWizard();

    fireEvent.click(screen.getByText("Get started"));
    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(screen.getByText("Skip"));

    await waitFor(() => {
      expect(screen.getByText("Choose tools to connect")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Skip"));
    fireEvent.click(screen.getByText("Skip"));

    await waitFor(() => {
      expect(screen.getByText("Wenlan is ready.")).toBeInTheDocument();
    });

    // readyBody1 must not lead with "Memories will appear..." — wiki pages
    // first, memory second (the memories are kept "behind" the pages).
    expect(screen.queryByText(/^Memories will appear/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Use your AI tools normally. As they work, Wenlan turns what they learn into source-cited pages — and keeps the memories behind them. You can always return to Settings to connect more tools.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Pages refresh between sessions, so the next one starts where the last ended."),
    ).toBeInTheDocument();

    expect(screen.queryByText("Back")).not.toBeInTheDocument();
  });

  it("Connect step renders RemoteAccessPanel (compact)", async () => {
    renderWizard({ initialStep: "connect" });
    await waitFor(() => {
      expect(screen.getByText(/Share with web-based AI tools/i)).toBeInTheDocument();
    });
  });

  it("Connect step remote toggle invokes toggleRemoteAccess", async () => {
    const { toggleRemoteAccess } = await import("../lib/tauri");
    renderWizard({ initialStep: "connect" });
    await screen.findByText(/Share with web-based AI tools/i);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => {
      expect(toggleRemoteAccess).toHaveBeenCalled();
    });
  });

  // StepShell (§4.0, defect 5): the primary CTA lives in a fixed action bar
  // that is a sibling of the scrollable content column, never a descendant
  // of it — so it is visible by construction regardless of content height,
  // instead of relying on the tallest step happening to fit in 720px.
  it("StepShell: the primary CTA lives outside the scrollable content, never inside it", async () => {
    renderWizard();
    fireEvent.click(screen.getByText("Get started"));
    // "local-server variant" — one of the taller intelligence-choice panes.
    fireEvent.click(screen.getByText("Your own local server"));
    await screen.findByRole("heading", { name: "Your own local server" });

    const continueButton = screen.getByText("Continue");
    const scrollMain = screen.getByTestId("wizard-scroll-main");
    const actionBar = screen.getByTestId("wizard-action-bar");

    expect(scrollMain.contains(actionBar)).toBe(false);
    expect(actionBar.contains(continueButton)).toBe(true);
    expect(scrollMain.contains(continueButton)).toBe(false);
  });

  it("connect: a client that is detected and already connected shows the connected description and the Configured badge — never the detected-but-unconnected copy", async () => {
    (detectMcpClients as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "Cursor",
        client_type: "cursor",
        config_path: "/path/to/cursor",
        detected: true,
        already_configured: true,
      },
      {
        name: "Windsurf",
        client_type: "windsurf",
        config_path: "/path/to/windsurf.json",
        detected: true,
        already_configured: false,
      },
    ]);

    renderWizard({ initialStep: "connect" });

    await waitFor(() => {
      expect(screen.getByText("Cursor")).toBeInTheDocument();
    });

    // Connected row: badge + connected copy, never the "detected, can
    // connect in one click" copy that only applies pre-connection.
    expect(screen.getByText("Configured")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Connected — this tool can already read and write your knowledge base.",
      ),
    ).toBeInTheDocument();

    // Not-yet-connected row: detected copy, no badge.
    expect(
      screen.getByText("Detected on this Mac — Wenlan can connect it in one click."),
    ).toBeInTheDocument();
    // Exactly one badge exists (Cursor's) — getByText above already asserts
    // that; the not-yet-connected row must not render a second one.
    expect(screen.getAllByText("Configured")).toHaveLength(1);
  });

  it("done: agent ids that resolve to the same display name collapse to one chip; raw ids never render", async () => {
    (listAgents as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "codex-ulw-loop",
        display_name: "Codex",
        last_seen_at: Math.floor(Date.now() / 1000) - 3600,
        memory_count: 1,
      },
      {
        name: "codex-mcp-client",
        display_name: "Codex",
        last_seen_at: Math.floor(Date.now() / 1000) - 3600,
        memory_count: 1,
      },
    ]);

    renderWizard({ initialStep: "verify" });

    await waitFor(() => {
      expect(screen.getByText("You're all set.")).toBeInTheDocument();
    });

    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.queryByText("codex-ulw-loop")).not.toBeInTheDocument();
    expect(screen.queryByText("codex-mcp-client")).not.toBeInTheDocument();
  });

  it("intelligence choice tiles signal selection via aria-pressed, not color alone", async () => {
    renderWizard();
    fireEvent.click(screen.getByText("Get started"));

    const deviceButton = screen.getByRole("button", { name: "On-device model" });
    const cloudButton = screen.getByRole("button", { name: /Anthropic API key/ });

    expect(deviceButton).toHaveAttribute("aria-pressed", "true");
    expect(cloudButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(cloudButton);

    expect(cloudButton).toHaveAttribute("aria-pressed", "true");
    expect(deviceButton).toHaveAttribute("aria-pressed", "false");
  });

  it("connect step: the group pill is gone — no per-row 'Detected'/'Install first' text duplicates the section header", async () => {
    (detectMcpClients as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "Cursor",
        client_type: "cursor",
        config_path: "/path/to/cursor",
        detected: true,
        already_configured: false,
      },
      {
        name: "Claude Code",
        client_type: "claude_code",
        config_path: "/path/to/claude.json",
        detected: false,
        already_configured: false,
      },
    ]);

    renderWizard({ initialStep: "connect" });

    await waitFor(() => {
      expect(screen.getByText("Detected on your Mac")).toBeInTheDocument();
      expect(screen.getByText("Supported tools")).toBeInTheDocument();
    });

    // The per-row pill used to duplicate the section label on every row; the
    // section header above the list already says it once.
    expect(screen.queryByText("Detected")).not.toBeInTheDocument();
    expect(screen.queryByText("Install first")).not.toBeInTheDocument();
  });

  it("escape hatch 'Or write the config for me' is a real button that reveals the manual config snippet", async () => {
    (detectMcpClients as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "Codex CLI",
        client_type: "codex_cli",
        config_path: "/path/to/config.toml",
        detected: true,
        already_configured: false,
      },
    ]);

    renderWizard({ initialStep: "connect" });

    await screen.findByText("codex mcp add wenlan -- npx -y wenlan-mcp");

    expect(screen.queryByText(/mcpServers/)).not.toBeInTheDocument();

    const escapeHatch = screen.getByRole("button", { name: "Or write the config for me" });
    await userEvent.click(escapeHatch);

    expect(screen.getByText(/mcpServers/)).toBeInTheDocument();
  });

  it("done: caps connected-agent chips at 6 with a +N overflow chip", async () => {
    const ids = ["tool-a", "tool-b", "tool-c", "tool-d", "tool-e", "tool-f", "tool-g", "tool-h"];
    (listAgents as ReturnType<typeof vi.fn>).mockResolvedValue(
      ids.map((name) => ({
        name,
        last_seen_at: Math.floor(Date.now() / 1000) - 3600,
        memory_count: 1,
      })),
    );

    renderWizard({ initialStep: "verify" });

    await waitFor(() => {
      expect(screen.getByText("You're all set.")).toBeInTheDocument();
    });

    // Unrecognized slugs are prettified (word-split + title-case), not shown raw.
    for (const id of ids.slice(0, 6)) {
      const prettified = id
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      expect(screen.getByText(prettified)).toBeInTheDocument();
    }
    expect(screen.getByText("+2 more")).toBeInTheDocument();
    expect(screen.queryByText("Tool G")).not.toBeInTheDocument();
    expect(screen.queryByText("Tool H")).not.toBeInTheDocument();
  });
});

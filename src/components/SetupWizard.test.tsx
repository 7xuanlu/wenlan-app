import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
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
  detectObsidianVaults: vi.fn().mockResolvedValue([]),
}));

import {
  detectMcpClients,
  writeMcpConfig,
  listAgents,
  setApiKey,
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
    expect(screen.getByText("Your memories live on this machine.")).toBeInTheDocument();
    // R3 typography ladder: on-scale size only, never an off-scale 15px.
    expect(tagline).toHaveStyle({ fontSize: "var(--mem-text-lg)" });
    expect(body).toHaveStyle({ fontSize: "var(--mem-text-lg)" });
  });

  it("renders Welcome step in Simplified Chinese when selected", async () => {
    await i18n.changeLanguage("zh-Hans");
    renderWizard();

    expect(screen.getByText("欢迎使用文澜")).toBeInTheDocument();
    expect(screen.getByText("你的记忆保存在这台设备上。")).toBeInTheDocument();
  });

  it('advances from Welcome to intelligence choice on "Get started" click', () => {
    renderWizard();
    fireEvent.click(screen.getByText("Get started"));
    expect(screen.getByText("Choose how Wenlan thinks")).toBeInTheDocument();
  });

  it("lets users save an API key from the intelligence step", async () => {
    renderWizard();
    fireEvent.click(screen.getByText("Get started"));
    fireEvent.click(screen.getByText("Cloud model"));

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
    expect(screen.getByText("Cloud model")).toBeInTheDocument();
    expect(screen.getByText("Your own local server")).toBeInTheDocument();
  });

  it("recommends on-device — the same tile that's selected by default, not cloud", async () => {
    renderWizard();
    fireEvent.click(screen.getByText("Get started"));

    const deviceButton = screen.getByRole("button", { name: /On-device model/ });
    const cloudButton = screen.getByRole("button", { name: "Cloud model" });

    expect(deviceButton).toHaveAttribute("aria-pressed", "true");
    expect(within(deviceButton).getByText("Recommended")).toBeInTheDocument();
    expect(within(cloudButton).queryByText("Recommended")).not.toBeInTheDocument();
  });

  it("cloud pane offers only the Anthropic key card — no dead cloud-vendor picker (§5.2 honesty fix)", async () => {
    renderWizard();
    fireEvent.click(screen.getByText("Get started"));
    fireEvent.click(screen.getByText("Cloud model"));

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
      expect(screen.getByText("Connect your AI tools")).toBeInTheDocument();
    });
  });

  it("only detected tools render a row — an undetected tool is invisible, not a disabled row", async () => {
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

    // "Found on this Mac" renders identically in both the loading skeleton
    // and the loaded-data branch, so it can't signal load completion by
    // itself — wait on "Cursor", which only exists once data has loaded.
    await screen.findByText("Cursor");

    expect(screen.getByText("Found on this Mac")).toBeInTheDocument();
    expect(screen.queryByText("Claude Code")).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    // The old per-row "Detected"/"Install first" pill duplicated the section
    // header; the redesign has no such pill at all.
    expect(screen.queryByText("Detected")).not.toBeInTheDocument();
    expect(screen.queryByText("Install first")).not.toBeInTheDocument();
  });

  it("no detected tools at all shows the empty-state copy, not an empty section", async () => {
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
      expect(screen.getByText("No AI tools found on this Mac.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Found on this Mac")).not.toBeInTheDocument();
  });

  it("connects selected detected tools on continue; the CTA label counts down as tools get connected", async () => {
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

    const cursorCheckbox = await screen.findByRole("checkbox", { name: "Cursor" });
    await waitFor(() => expect(cursorCheckbox).toBeChecked());
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Connect 1 tool" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Connect 1 tool" }));

    await waitFor(() => {
      expect(writeMcpConfig).toHaveBeenCalledWith("cursor");
      expect(screen.getByText("Waiting for your first agent...")).toBeInTheDocument();
    });
  });

  it("the CTA count tracks the checkboxes — unchecking a tool drops it from the count and from what gets written", async () => {
    (detectMcpClients as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "Cursor",
        client_type: "cursor",
        config_path: "/path/to/cursor",
        detected: true,
        already_configured: false,
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
      expect(screen.getByRole("button", { name: "Connect 2 tools" })).toBeInTheDocument();
    });

    const windsurfCheckbox = screen.getByRole("checkbox", { name: "Windsurf" });
    fireEvent.click(windsurfCheckbox);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Connect 1 tool" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Connect 1 tool" }));

    await waitFor(() => {
      expect(writeMcpConfig).toHaveBeenCalledWith("cursor");
    });
    expect(writeMcpConfig).not.toHaveBeenCalledWith("windsurf");
  });

  it("stays on connect step and surfaces the error when MCP setup fails", async () => {
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
      expect(screen.getByRole("button", { name: "Connect 1 tool" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Connect 1 tool" }));

    await waitFor(() => {
      expect(writeMcpConfig).toHaveBeenCalledWith("cursor");
      expect(screen.queryByText("Waiting for your first agent...")).not.toBeInTheDocument();
      expect(screen.getByText(/setup failed/i)).toBeInTheDocument();
    });
  });

  // Binding adjudication (redesign spec §12.2): the wizard must NEVER write
  // Claude Code's config — doing so would duplicate the MCP server the
  // Wenlan Claude Code plugin already registers. Claude Code gets no
  // checkbox and no write action of any kind here (unlike Settings, where
  // an explicit Advanced disclosure still offers it).
  it("Claude Code leads with the plugin-install path, has no checkbox, and offers no write action in the wizard", async () => {
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

    await screen.findByText("Claude Code");
    expect(
      screen.getByText(
        "Copy the setup prompt and paste it into Claude Code — it sets itself up.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy setup prompt" })).toBeInTheDocument();

    expect(screen.queryByRole("checkbox", { name: "Claude Code" })).not.toBeInTheDocument();
    expect(screen.queryByText("Or write the config for me")).not.toBeInTheDocument();
    expect(screen.queryByText("Advanced")).not.toBeInTheDocument();

    // Cursor, the GUI client, is unaffected — it still gets the ordinary
    // checked-by-default checkbox and drives the batch-write CTA.
    const cursorCheckbox = screen.getByRole("checkbox", { name: "Cursor" });
    await waitFor(() => expect(cursorCheckbox).toBeChecked());

    fireEvent.click(await screen.findByRole("button", { name: "Connect 1 tool" }));
    await waitFor(() => {
      expect(writeMcpConfig).toHaveBeenCalledWith("cursor");
    });
    expect(writeMcpConfig).not.toHaveBeenCalledWith("claude_code");
  });

  it("Codex CLI is an ordinary GUI-style row now — a checkbox, no plugin path, batch-written like any other tool", async () => {
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

    const codexCheckbox = await screen.findByRole("checkbox", { name: "Codex CLI" });
    await waitFor(() => expect(codexCheckbox).toBeChecked());
    expect(screen.queryByRole("button", { name: "Copy setup prompt" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Connect 1 tool" }));
    await waitFor(() => {
      expect(writeMcpConfig).toHaveBeenCalledWith("codex_cli");
    });
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
      expect(screen.getByText("Connect your AI tools")).toBeInTheDocument();
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

  // Redesign spec §4/§12: Remote Access left the wizard entirely — it's a
  // Settings-only surface now, alongside the single consolidated no-auth
  // warning (see RemoteAccessPanel.test.tsx and AgentsSection.test.tsx).
  // The wizard instead points at Settings → Agents for it and every other
  // web tool (assertion lives in the settingsPointer test below).
  it("does not render Remote Access — it lives only in Settings now", async () => {
    renderWizard({ initialStep: "connect" });
    await waitFor(() => {
      expect(screen.getByText("Connect your AI tools")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Share with web-based AI tools/i)).not.toBeInTheDocument();
  });

  it("points at Settings → Agents for Claude.ai, ChatGPT, and anything not listed", async () => {
    renderWizard({ initialStep: "connect" });
    await waitFor(() => {
      expect(
        screen.getByText(
          "Claude.ai, ChatGPT, and more tools can be connected any time in Settings → Agents.",
        ),
      ).toBeInTheDocument();
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

  it("a client that is already configured shows the Configured badge and a disabled, checked checkbox — never a second badge on an unconfigured row", async () => {
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

    // Exactly one badge, on Cursor's row — Windsurf isn't configured yet and
    // must not render a second one.
    expect(screen.getAllByText("Configured")).toHaveLength(1);
    const cursorCheckbox = screen.getByRole("checkbox", { name: "Cursor" });
    expect(cursorCheckbox).toBeChecked();
    expect(cursorCheckbox).toBeDisabled();

    const windsurfCheckbox = screen.getByRole("checkbox", { name: "Windsurf" });
    await waitFor(() => expect(windsurfCheckbox).toBeChecked());
    expect(windsurfCheckbox).toBeEnabled();
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

    const deviceButton = screen.getByRole("button", { name: /On-device model/ });
    const cloudButton = screen.getByRole("button", { name: "Cloud model" });

    expect(deviceButton).toHaveAttribute("aria-pressed", "true");
    expect(cloudButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(cloudButton);

    expect(cloudButton).toHaveAttribute("aria-pressed", "true");
    expect(deviceButton).toHaveAttribute("aria-pressed", "false");
  });

  it("the manual config snippet is a standalone disclosure, independent of any specific client row", async () => {
    // A non-empty detected-client list matters here: an empty list makes
    // the wizard auto-expand this same disclosure (so a would-be
    // detection-failure user sees the manual snippet immediately), which
    // would race this test's own click and make the assertion flaky.
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

    await screen.findByText("Cursor");
    expect(screen.queryByText(/mcpServers/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Using another MCP client? Show config"));

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

// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import DiagnosticsSection from "./DiagnosticsSection";
import { getPipelineStatus, getWireState, clipboardWrite, type WireState } from "../../../../lib/tauri";
import { i18n } from "../../../../i18n";

vi.mock("../../../../lib/tauri", () => ({
  getPipelineStatus: vi.fn(),
  getWireState: vi.fn(),
  clipboardWrite: vi.fn().mockResolvedValue(undefined),
}));

function renderDiagnostics() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<DiagnosticsSection />, { wrapper: Wrapper });
}

const wireFixture: WireState = {
  daemon: {
    base_url: "http://127.0.0.1:7878",
    reachable: true,
    version: "0.12.3",
    error: null,
  },
  mcp_binary: {
    command: "wenlan-mcp",
    args: ["--stdio"],
    candidates: [
      { path: "/Users/x/.wenlan/bin/wenlan-mcp", exists: true, source: "installed" },
      { path: "/Users/x/Repos/wenlan/target/release/wenlan-mcp", exists: false, source: "cargo" },
    ],
  },
  clients: [
    {
      client_type: "claude_code",
      name: "Claude Code",
      detected: true,
      config_path: "/Users/x/.claude.json",
      has_raw_entry: false,
      has_plugin: true,
      route: "plugin",
    },
    {
      client_type: "claude_desktop",
      name: "Claude Desktop",
      detected: true,
      config_path: "/Users/x/Library/Application Support/Claude/claude_desktop_config.json",
      has_raw_entry: true,
      has_plugin: true,
      route: "plugin",
    },
  ],
};

describe("DiagnosticsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWireState).mockResolvedValue(wireFixture);
    vi.mocked(getPipelineStatus).mockResolvedValue({
      enrichment: { classified: 9, raw: 2 },
      entity_linking: { linked: 7, unlinked: 3 },
      refinement_queue: [{ action: "merge", status: "pending", count: 4 }],
      recaps: 5,
      types: { fact: 6, preference: 1 },
      quality: { trusted: 8, low: 1 },
    });
  });

  describe("pipeline card (unchanged)", () => {
    it("renders the pipeline snapshot fields", async () => {
      renderDiagnostics();

      expect(await screen.findByText("Pipeline Snapshot")).toBeInTheDocument();
      expect(await screen.findByText("classified")).toBeInTheDocument();
      expect(screen.getByText("9")).toBeInTheDocument();
      expect(screen.getByText("Entity linking")).toBeInTheDocument();
      expect(screen.getByText("70% linked")).toBeInTheDocument();
      expect(screen.getByText("Refinery queue")).toBeInTheDocument();
      expect(screen.getByText("merge")).toBeInTheDocument();
      expect(screen.getByText("pending")).toBeInTheDocument();
      expect(screen.getByText("Recaps")).toBeInTheDocument();
      expect(screen.getByText("5")).toBeInTheDocument();
      expect(screen.getByText("fact")).toBeInTheDocument();
      expect(screen.getByText("trusted")).toBeInTheDocument();
    });

    it("renders the refinery queue empty state", async () => {
      vi.mocked(getPipelineStatus).mockResolvedValue({
        enrichment: {},
        entity_linking: { linked: 0, unlinked: 0 },
        refinement_queue: [],
        recaps: 0,
        types: {},
        quality: {},
      });

      renderDiagnostics();

      expect(await screen.findByText("Refinery queue")).toBeInTheDocument();
      expect(screen.getByText("No pending refinery work.")).toBeInTheDocument();
    });

    it("shows a scoped old-daemon message when the route is missing", async () => {
      vi.mocked(getPipelineStatus).mockRejectedValue(
        new Error("HTTP GET /api/debug/pipeline returned 404: not found"),
      );

      renderDiagnostics();

      expect(await screen.findByText("Diagnostics require a newer daemon")).toBeInTheDocument();
      expect(screen.queryByText("Run maintenance")).not.toBeInTheDocument();
    });

    it("does not expose the manual steep maintenance action", async () => {
      renderDiagnostics();

      await waitFor(() => expect(getPipelineStatus).toHaveBeenCalled());
      expect(screen.queryByText("Run maintenance")).not.toBeInTheDocument();
      expect(screen.queryByText("Steep")).not.toBeInTheDocument();
    });

    it("still renders when the wiring query rejects", async () => {
      vi.mocked(getWireState).mockRejectedValue(new Error("IPC failure"));

      renderDiagnostics();

      // "Pipeline Snapshot" is the static SectionHeader label — present
      // regardless of query state, so it proves nothing about data having
      // loaded. Await "classified" instead: it only renders inside the
      // resolved pipeline data branch.
      expect(await screen.findByText("classified")).toBeInTheDocument();
      expect(await screen.findByText("Wiring information unavailable")).toBeInTheDocument();
    });
  });

  describe("wiring card", () => {
    it("renders the daemon, MCP binary, and clients groups", async () => {
      renderDiagnostics();

      expect(await screen.findByText("Wenlan runtime")).toBeInTheDocument();
      expect(screen.getByText("Reachable")).toBeInTheDocument();
      expect(screen.getByText("http://127.0.0.1:7878")).toBeInTheDocument();
      expect(screen.getByText("Version 0.12.3")).toBeInTheDocument();

      expect(screen.getByText("MCP server binary")).toBeInTheDocument();
      expect(screen.getByText("wenlan-mcp --stdio")).toBeInTheDocument();
      expect(screen.getByText("/Users/x/.wenlan/bin/wenlan-mcp")).toBeInTheDocument();
      expect(screen.getByText("/Users/x/Repos/wenlan/target/release/wenlan-mcp")).toBeInTheDocument();

      expect(screen.getByText("Clients")).toBeInTheDocument();
      expect(screen.getByText("Claude Code")).toBeInTheDocument();
      expect(screen.getByText("Claude Desktop")).toBeInTheDocument();
    });

    it("still renders when the pipeline query rejects", async () => {
      vi.mocked(getPipelineStatus).mockRejectedValue(new Error("boom"));

      renderDiagnostics();

      expect(await screen.findByText("Wenlan runtime")).toBeInTheDocument();
      expect(screen.getByText("Reachable")).toBeInTheDocument();
      expect(await screen.findByText("Diagnostics unavailable")).toBeInTheDocument();
    });

    it("shows its own loading state independent of the pipeline card", async () => {
      let resolveWire!: (value: WireState) => void;
      vi.mocked(getWireState).mockReturnValue(
        new Promise((resolve) => {
          resolveWire = resolve;
        }),
      );

      renderDiagnostics();

      expect(await screen.findByText("Loading wiring…")).toBeInTheDocument();
      // Pipeline card resolved already; wiring card is still loading independently.
      expect(await screen.findByText("Pipeline Snapshot")).toBeInTheDocument();
      expect(await screen.findByText("classified")).toBeInTheDocument();

      resolveWire(wireFixture);
      expect(await screen.findByText("Wenlan runtime")).toBeInTheDocument();
    });

    it("renders the empty clients state", async () => {
      vi.mocked(getWireState).mockResolvedValue({ ...wireFixture, clients: [] });

      renderDiagnostics();

      expect(await screen.findByText("Wenlan runtime")).toBeInTheDocument();
      expect(screen.getByText("No MCP clients found.")).toBeInTheDocument();
    });

    it("copies a plain-text wiring report to the clipboard", async () => {
      renderDiagnostics();

      const copyButton = await screen.findByText("Copy report");
      fireEvent.click(copyButton);

      await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(1));
      const reportText = vi.mocked(clipboardWrite).mock.calls[0][0];
      expect(reportText).toContain("Wenlan runtime: Reachable");
      expect(reportText).toContain("http://127.0.0.1:7878");
      expect(reportText).toContain("[Found] /Users/x/.wenlan/bin/wenlan-mcp (installed)");
      expect(reportText).toContain("[Missing] /Users/x/Repos/wenlan/target/release/wenlan-mcp (cargo)");
      expect(reportText).toContain("Claude Desktop");
      expect(reportText).toContain("registered twice for Claude Desktop");

      expect(await screen.findByText("Copied")).toBeInTheDocument();
    });

    it("does not offer the copy report action before wiring data has loaded", async () => {
      let resolveWire!: (value: WireState) => void;
      vi.mocked(getWireState).mockReturnValue(
        new Promise((resolve) => {
          resolveWire = resolve;
        }),
      );

      renderDiagnostics();

      await screen.findByText("Loading wiring…");
      expect(screen.queryByText("Copy report")).not.toBeInTheDocument();

      await act(async () => {
        resolveWire(wireFixture);
      });
      expect(await screen.findByText("Copy report")).toBeInTheDocument();
    });
  });

  describe("wiring loading state", () => {
    it("shows the loading state while the wire state is pending, then the resolved rows", async () => {
      let resolveWire!: (value: WireState) => void;
      vi.mocked(getWireState).mockReturnValue(
        new Promise((resolve) => {
          resolveWire = resolve;
        }),
      );

      renderDiagnostics();

      // While in flight, only the loading state is on screen. An
      // instant-resolve mock would skip straight past this, so the promise
      // is held open on purpose.
      await screen.findByText("Loading wiring…");
      expect(screen.queryByText("Wenlan runtime")).not.toBeInTheDocument();

      await act(async () => {
        resolveWire(wireFixture);
      });

      // Resolved: the real rows render and the loading state is gone.
      expect(await screen.findByText("Wenlan runtime")).toBeInTheDocument();
      expect(screen.queryByText("Loading wiring…")).not.toBeInTheDocument();
    });
  });

  // ── Mutation-proof: the three properties this card exists to guarantee ──

  describe("mutation-proof properties", () => {
    it("PROPERTY 1: a missing MCP binary candidate renders as missing, not found", async () => {
      renderDiagnostics();

      await screen.findByText("Wenlan runtime");
      expect(screen.getAllByText("Found")).toHaveLength(1);
      expect(screen.getAllByText("Missing")).toHaveLength(1);
    });

    it("PROPERTY 2: double registration (plugin + raw entry) is flagged for the affected client only", async () => {
      renderDiagnostics();

      await screen.findByText("Wenlan runtime");
      expect(
        screen.getByText(
          "Wenlan is registered twice for Claude Desktop. Remove the manual MCP entry — Wenlan is already connected automatically.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/registered twice for Claude Code/)).not.toBeInTheDocument();
    });

    it("PROPERTY 3: an unreachable daemon shows its error, not a reachable state", async () => {
      vi.mocked(getWireState).mockResolvedValue({
        ...wireFixture,
        daemon: {
          base_url: "http://127.0.0.1:7878",
          reachable: false,
          version: null,
          error: "connection refused",
        },
      });

      renderDiagnostics();

      await screen.findByText("Wenlan runtime");
      expect(screen.getByText("Unreachable")).toBeInTheDocument();
      expect(screen.queryByText("Reachable")).not.toBeInTheDocument();
      expect(screen.getByText("connection refused")).toBeInTheDocument();
    });

    it("PROPERTY 4: the raw route tag is never rendered — Wenlan is never called a plugin on screen", async () => {
      vi.mocked(getWireState).mockResolvedValue({
        ...wireFixture,
        clients: [
          { ...wireFixture.clients[0], route: "plugin" },
          {
            ...wireFixture.clients[1],
            client_type: "cursor",
            name: "Cursor",
            config_path: "/Users/x/.cursor/mcp.json",
            has_plugin: false,
            has_raw_entry: false,
            route: "config",
          },
        ],
      });

      renderDiagnostics();

      await screen.findByText("Wenlan runtime");
      expect(screen.getByText("Connects automatically")).toBeInTheDocument();
      expect(screen.getByText("Sets up an MCP entry")).toBeInTheDocument();

      // `route` arrives from Rust as the bare tag "plugin". The i18n banned-word
      // guard only scans resources.ts, so it cannot catch a value rendered raw
      // from the backend — this is the only thing standing between that tag and
      // the screen.
      const wiringCard = screen.getByText("Wiring").closest("section");
      expect(wiringCard?.textContent).not.toMatch(/plugin/i);
    });
  });

  describe("i18n", () => {
    afterEach(async () => {
      await i18n.changeLanguage("en");
    });

    it("renders its heading through the translation layer, not hardcoded English", async () => {
      await i18n.changeLanguage("zh-Hans");
      renderDiagnostics();

      expect(await screen.findByText("流水线快照")).toBeInTheDocument();
      expect(screen.queryByText("Pipeline Snapshot")).not.toBeInTheDocument();
    });

    it("renders the wiring heading through the translation layer, not hardcoded English", async () => {
      await i18n.changeLanguage("zh-Hans");
      renderDiagnostics();

      expect(await screen.findByText("连接状态")).toBeInTheDocument();
      expect(screen.queryByText("Wiring")).not.toBeInTheDocument();
    });
  });
});

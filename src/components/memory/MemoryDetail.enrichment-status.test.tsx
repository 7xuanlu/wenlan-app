// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MemoryDetail from "./MemoryDetail";
import * as tauri from "../../lib/tauri";

vi.mock("../../lib/tauri");

const memory: tauri.MemoryItem = {
  source_id: "mem-1",
  title: "Memory",
  content: "A memory",
  summary: null,
  memory_type: "fact",
  domain: null,
  source_agent: null,
  confidence: null,
  confirmed: false,
  pinned: false,
  supersedes: null,
  last_modified: 1,
  chunk_count: 1,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("MemoryDetail enrichment status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tauri.getMemoryDetail).mockResolvedValue(memory);
    vi.mocked(tauri.listSpaces).mockResolvedValue([]);
    vi.mocked(tauri.listEntities).mockResolvedValue([]);
    vi.mocked(tauri.listAllTags).mockResolvedValue({
      tags: [],
      document_tags: {},
      categories: [],
      document_categories: {},
    });
    vi.mocked(tauri.search).mockResolvedValue([]);
  });

  it("shows daemon enrichment status without blocking the memory body", async () => {
    vi.mocked(tauri.getEnrichmentStatus).mockResolvedValue({
      source_id: "mem-1",
      summary: "complete",
      steps: [{ step: "classify", status: "done", error: null, attempts: 1 }],
    });

    render(
      <MemoryDetail
        sourceId="mem-1"
        onBack={vi.fn()}
        onNavigateEntity={vi.fn()}
        onNavigateMemory={vi.fn()}
      />,
      { wrapper },
    );

    expect(await screen.findByText("A memory")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/enrichment/i)).toBeInTheDocument();
      expect(screen.getByText(/complete/i)).toBeInTheDocument();
    });
  });

  it("keeps rendering the memory when enrichment status route is unavailable", async () => {
    vi.mocked(tauri.getEnrichmentStatus).mockRejectedValue(new Error("404"));

    render(
      <MemoryDetail
        sourceId="mem-1"
        onBack={vi.fn()}
        onNavigateEntity={vi.fn()}
        onNavigateMemory={vi.fn()}
      />,
      { wrapper },
    );

    expect(await screen.findByText("A memory")).toBeInTheDocument();
    expect(screen.queryByText(/enrichment/i)).toBeNull();
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import HomePage from "./HomePage";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    listRecentRetrievals: vi.fn(),
    listRecentPages: vi.fn(),
    listRecentConcepts: vi.fn(),
    listRecentMemories: vi.fn(),
    listUnconfirmedMemories: vi.fn(),
    listPages: vi.fn(),
    listConcepts: vi.fn(),
    listRecentChanges: vi.fn(),
    listRecentRelations: vi.fn(),
    listEntities: vi.fn(),
    getMemoryStats: vi.fn(),
    getProfile: vi.fn(),
    getPendingContradictions: vi.fn(),
    dismissContradiction: vi.fn(),
    confirmMemory: vi.fn(),
    listPendingRevisions: vi.fn(),
    acceptPendingRevision: vi.fn(),
    dismissPendingRevision: vi.fn(),
    listRefinements: vi.fn(),
    acceptRefinement: vi.fn(),
    rejectRefinement: vi.fn(),
  };
});

import * as tauri from "../../lib/tauri";

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HomePage
        onNavigateMemory={() => {}}
        onNavigateStream={() => {}}
        onNavigateLog={() => {}}
        onNavigateGraph={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(tauri.listRecentRetrievals).mockResolvedValue([]);
  vi.mocked(tauri.listRecentPages).mockResolvedValue([]);
  vi.mocked(tauri.listRecentConcepts).mockResolvedValue([]);
  vi.mocked(tauri.listRecentMemories).mockResolvedValue([]);
  vi.mocked(tauri.listUnconfirmedMemories).mockResolvedValue([]);
  vi.mocked(tauri.listPages).mockResolvedValue([]);
  vi.mocked(tauri.listConcepts).mockResolvedValue([]);
  vi.mocked(tauri.listRecentChanges).mockResolvedValue([]);
  vi.mocked(tauri.listRecentRelations).mockResolvedValue([]);
  vi.mocked(tauri.listEntities).mockResolvedValue([]);
  vi.mocked(tauri.getMemoryStats).mockResolvedValue({ total: 0, with_embeddings: 0 } as any);
  vi.mocked(tauri.getProfile).mockResolvedValue(null);
  vi.mocked(tauri.confirmMemory).mockResolvedValue(undefined);
  vi.mocked(tauri.dismissContradiction).mockResolvedValue({ source_id: "mem-new", wrote: true });
  vi.mocked(tauri.listPendingRevisions).mockResolvedValue([]);
  vi.mocked(tauri.acceptPendingRevision).mockResolvedValue({
    target_source_id: "mem-target",
    revision_source_id: "mem-revision",
    wrote: true,
  });
  vi.mocked(tauri.dismissPendingRevision).mockResolvedValue({
    target_source_id: "mem-target",
    wrote: true,
  });
  vi.mocked(tauri.listRefinements).mockResolvedValue({ proposals: [] });
  vi.mocked(tauri.acceptRefinement).mockResolvedValue({
    id: "ref-merge",
    action_applied: "entity_merge",
  });
  vi.mocked(tauri.rejectRefinement).mockResolvedValue({ id: "ref-merge" });
  vi.mocked(tauri.getPendingContradictions).mockResolvedValue([
    {
      id: "contra-1",
      existing_content: "First claim",
      new_content: "Second claim",
      new_source_id: "mem-new",
      existing_source_id: "mem-existing",
    } as any,
  ]);
});

describe("HomePage redesign", () => {
  it("always renders the greeting", async () => {
    vi.mocked(tauri.getProfile).mockResolvedValue({
      id: "p1",
      name: "Lucian",
      display_name: null,
      email: null,
      bio: null,
      avatar_path: null,
      created_at: 0,
      updated_at: 0,
    } as any);
    renderHome();
    // Wait for the profile query to resolve before asserting the name renders.
    await screen.findByText(/Good (morning|afternoon|evening), Lucian/);
    expect(screen.getByTestId("greeting")).toBeInTheDocument();
  });

  it("does NOT render ProfileNarrativeCompact on home", async () => {
    const now = Date.now();
    vi.mocked(tauri.listRecentConcepts).mockResolvedValue([
      { kind: "concept", id: "c1", title: "A", snippet: "s", timestamp_ms: now, badge: { kind: "new" } },
    ] as any);
    renderHome();
    // Settle React Query before asserting absence.
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText(/^Updated/i)).toBeNull();
  });

  it.skip("renders Recent activity scroll with badges", async () => {
    // Superseded by RefiningList. Badge styling lives inside RefiningList and
    // is covered by that component's own tests; the home-level integration only
    // needs to verify RefiningList mounts when there are changes.
  });

  it("renders the retrievals list with known agent names", async () => {
    vi.mocked(tauri.listRecentRetrievals).mockResolvedValue([
      {
        timestamp_ms: Date.now(),
        agent_name: "claude-code",
        query: "positioning",
        page_titles: ["Origin positioning", "Daemon architecture"],
        page_ids: ["concept_pos", "concept_arch"],
        memory_snippets: [],
      },
    ]);
    renderHome();
    expect(await screen.findByTestId("retrievals")).toBeInTheDocument();
    expect(screen.getByText(/Where AI looked/i)).toBeInTheDocument();
    expect(screen.getByText(/Claude Code/)).toBeInTheDocument();
    expect(screen.getByText(/Origin positioning/)).toBeInTheDocument();
  });

  it("filters unknown agents out of the retrievals list", async () => {
    vi.mocked(tauri.listRecentRetrievals).mockResolvedValue([
      {
        timestamp_ms: Date.now(),
        agent_name: "unknown",
        query: "anything",
        page_titles: ["Should not appear"],
        page_ids: [],
        memory_snippets: [],
      },
    ]);
    renderHome();
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId("retrievals")).toBeNull();
    expect(screen.queryByText(/Should not appear/)).toBeNull();
  });

  it("does NOT render ConstellationMap on home", async () => {
    renderHome();
    expect(screen.queryByTestId("constellation-map")).toBeNull();
  });

  it("does NOT render contradiction resolver on home", async () => {
    renderHome();
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId("contradiction-resolver")).toBeNull();
  });

  it("renders worth-a-glance with only review-worthy items", async () => {
    const now = Date.now();
    vi.mocked(tauri.listRecentPages).mockResolvedValue([
      { kind: "concept", id: "c1", title: "Flagged concept", snippet: "s", timestamp_ms: now, badge: { kind: "needs_review" } },
      { kind: "concept", id: "c2", title: "Fresh concept", snippet: "s", timestamp_ms: now - 500, badge: { kind: "new" } },
    ] as any);
    vi.mocked(tauri.listRecentMemories).mockResolvedValue([
      { kind: "memory", id: "m1", title: "Refined memory", snippet: "s", timestamp_ms: now - 1000, badge: { kind: "refined" } },
    ] as any);
    renderHome();
    const strip = await screen.findByTestId("worth-a-glance");
    expect(strip).toBeInTheDocument();
    expect(strip.textContent).toContain("Flagged concept");
    expect(strip.textContent).not.toContain("Fresh concept");
    expect(strip.textContent).not.toContain("Refined memory");
  });

  it("surfaces pending revisions in worth-a-glance and accepts them", async () => {
    vi.mocked(tauri.listPendingRevisions).mockResolvedValue([
      {
        target_source_id: "mem-target",
        revision_source_id: "mem-revision",
        revision_content: "The durable updated wording from the daemon.",
        source_agent: "claude-code",
        last_modified: 1_782_365_076,
      },
    ]);

    renderHome();

    const strip = await screen.findByTestId("worth-a-glance");
    expect(strip).toHaveTextContent("Proposed update");
    expect(strip).toHaveTextContent("The durable updated wording from the daemon.");

    await userEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => {
      expect(tauri.acceptPendingRevision).toHaveBeenCalledWith("mem-target");
    });
    expect(tauri.confirmMemory).not.toHaveBeenCalledWith("mem-target", true);
  });

  it("surfaces refinery proposals in worth-a-glance and accepts them", async () => {
    vi.mocked(tauri.listRefinements).mockResolvedValue({
      proposals: [
        {
          id: "ref-merge",
          action: "entity_merge",
          source_ids: ["mem-a", "mem-b"],
          payload: {
            action: "entity_merge",
            existing_id: "ent-a",
            new_id: "ent-b",
            similarity: 0.86,
          },
          confidence: 0.86,
          created_at: "2026-06-26T00:00:00Z",
        },
      ],
    });

    renderHome();

    const strip = await screen.findByTestId("worth-a-glance");
    expect(strip).toHaveTextContent("Entity merge");
    expect(strip).toHaveTextContent("86% confidence");

    await userEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => {
      expect(tauri.acceptRefinement).toHaveBeenCalledWith("ref-merge");
    });
    expect(tauri.confirmMemory).not.toHaveBeenCalledWith("ref-merge", true);
  });

  it("does not offer accept for refinery actions without daemon accept paths", async () => {
    vi.mocked(tauri.listRefinements).mockResolvedValue({
      proposals: [
        {
          id: "ref-suggest",
          action: "suggest_entity",
          source_ids: ["mem-a"],
          payload: {
            action: "suggest_entity",
            name_hint: "Wenlan",
          },
          confidence: 0.72,
          created_at: "2026-06-26T00:00:00Z",
        },
      ],
    });

    renderHome();

    const strip = await screen.findByTestId("worth-a-glance");
    expect(strip).toHaveTextContent("Entity suggestion");
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
  });

  it("refreshes pending revisions and connection state after accepting a refinery proposal", async () => {
    vi.mocked(tauri.listRefinements).mockResolvedValue({
      proposals: [
        {
          id: "ref-contradiction",
          action: "detect_contradiction",
          source_ids: ["mem-new", "mem-existing"],
          payload: { action: "detect_contradiction" },
          confidence: 0.8,
          created_at: "2026-06-26T00:00:00Z",
        },
      ],
    });
    vi.mocked(tauri.acceptRefinement).mockResolvedValue({
      id: "ref-contradiction",
      action_applied: "detect_contradiction",
    });

    renderHome();

    await screen.findByText("Contradiction check");
    const pendingRevisionCalls = vi.mocked(tauri.listPendingRevisions).mock.calls.length;
    const conceptCalls = vi.mocked(tauri.listConcepts).mock.calls.length;
    const entityCalls = vi.mocked(tauri.listEntities).mock.calls.length;

    await userEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => {
      expect(tauri.acceptRefinement).toHaveBeenCalledWith("ref-contradiction");
      expect(vi.mocked(tauri.listPendingRevisions).mock.calls.length).toBeGreaterThan(
        pendingRevisionCalls,
      );
      expect(vi.mocked(tauri.listConcepts).mock.calls.length).toBeGreaterThan(conceptCalls);
      expect(vi.mocked(tauri.listEntities).mock.calls.length).toBeGreaterThan(entityCalls);
    });
  });

  it("refreshes recent review-derived activity after dismissing a refinery proposal", async () => {
    vi.mocked(tauri.listRefinements).mockResolvedValue({
      proposals: [
        {
          id: "ref-merge",
          action: "entity_merge",
          source_ids: ["mem-a", "mem-b"],
          payload: {
            action: "entity_merge",
            existing_id: "ent-a",
            new_id: "ent-b",
            similarity: 0.86,
          },
          confidence: 0.86,
          created_at: "2026-06-26T00:00:00Z",
        },
      ],
    });

    renderHome();

    await screen.findByText("Entity merge");
    const recentMemoryCalls = vi.mocked(tauri.listRecentMemories).mock.calls.length;
    const recentPageCalls = vi.mocked(tauri.listRecentPages).mock.calls.length;

    await userEvent.click(screen.getByText("Dismiss"));

    await waitFor(() => {
      expect(tauri.rejectRefinement).toHaveBeenCalledWith("ref-merge");
      expect(vi.mocked(tauri.listRecentMemories).mock.calls.length).toBeGreaterThan(
        recentMemoryCalls,
      );
      expect(vi.mocked(tauri.listRecentPages).mock.calls.length).toBeGreaterThan(recentPageCalls);
    });
  });

  it("retrieval card with archived concept shows archived badge and does not navigate", async () => {
    const onSelectPage = vi.fn();
    // Event has page_ids: [] simulating an archived concept (no active match found at read time)
    vi.mocked(tauri.listRecentRetrievals).mockResolvedValue([
      {
        timestamp_ms: Date.now(),
        agent_name: "claude-code",
        query: "origin arch",
        page_titles: ["Origin Architecture"],
        page_ids: [],
        memory_snippets: [],
      },
    ]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <HomePage
          onNavigateMemory={() => {}}
          onNavigateStream={() => {}}
          onNavigateLog={() => {}}
          onNavigateGraph={() => {}}
          onSelectPage={onSelectPage}
        />
      </QueryClientProvider>,
    );
    // Wait for the retrievals section to render
    await screen.findByTestId("retrievals");
    // The archived badge should be visible
    expect(screen.getByTitle("This page has been archived")).toBeInTheDocument();
    // Clicking should not navigate because page_ids is empty
    const item = screen.getByTestId("retrieval-item");
    await userEvent.click(item);
    expect(onSelectPage).not.toHaveBeenCalled();
  });

  it("empty state shows greeting plus WhatHappensNextCard, no data zones", async () => {
    vi.mocked(tauri.listConcepts).mockResolvedValue([]);
    vi.mocked(tauri.listRecentConcepts).mockResolvedValue([]);
    vi.mocked(tauri.listRecentMemories).mockResolvedValue([]);
    vi.mocked(tauri.listRecentRetrievals).mockResolvedValue([]);
    vi.mocked(tauri.listRecentChanges).mockResolvedValue([]);
    renderHome();
    expect(await screen.findByTestId("what-happens-next")).toBeInTheDocument();
    expect(screen.getByTestId("greeting")).toBeInTheDocument();
    expect(screen.queryByTestId("worth-a-glance")).toBeNull();
    expect(screen.queryByTestId("refining")).toBeNull();
    expect(screen.queryByTestId("connections")).toBeNull();
    expect(screen.queryByTestId("retrievals")).toBeNull();
  });
});

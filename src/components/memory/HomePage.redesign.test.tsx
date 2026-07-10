// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
    deleteMemory: vi.fn(),
    listPendingRevisions: vi.fn(),
    acceptPendingRevision: vi.fn(),
    dismissPendingRevision: vi.fn(),
    listRefinements: vi.fn(),
    acceptRefinement: vi.fn(),
    rejectRefinement: vi.fn(),
    getMemoryDetail: vi.fn(),
    getEntityDetail: vi.fn(),
  };
});

import * as tauri from "../../lib/tauri";

function renderHome(
  props: {
    onOpenDistillReview?: () => void;
    onSelectPage?: (pageId: string) => void;
  } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HomePage
        onNavigateMemory={() => {}}
        onNavigateStream={() => {}}
        onNavigateLog={() => {}}
        onNavigateGraph={() => {}}
        onOpenDistillReview={props.onOpenDistillReview}
        onSelectPage={props.onSelectPage}
      />
    </QueryClientProvider>,
  );
}

const nowIso = new Date().toISOString();

function page(overrides: Partial<tauri.Page> & Pick<tauri.Page, "id" | "title">): tauri.Page {
  return {
    summary: null,
    content: "",
    entity_id: null,
    domain: null,
    source_memory_ids: [],
    version: 1,
    status: "active",
    created_at: nowIso,
    last_compiled: nowIso,
    last_modified: nowIso,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
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
  vi.mocked(tauri.deleteMemory).mockResolvedValue(undefined);
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
  vi.mocked(tauri.getMemoryDetail).mockResolvedValue({
    source_id: "mem-target",
    title: "Target memory",
    content: "The durable original wording from the daemon.",
    summary: null,
    memory_type: null,
    domain: null,
    source_agent: null,
    confidence: null,
    confirmed: true,
    pinned: false,
    supersedes: null,
    last_modified: 1_782_365_000,
    chunk_count: 1,
  } as any);
  vi.mocked(tauri.getEntityDetail).mockResolvedValue({
    entity: {
      id: "ent-a",
      name: "Wenlan",
      entity_type: "tool",
      domain: null,
      source_agent: null,
      confidence: null,
      confirmed: true,
      created_at: 0,
      updated_at: 0,
    },
    observations: [],
    relations: [],
  } as any);
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
  it("uses wiki pages as the primary home surface when pages exist without activity", async () => {
    vi.mocked(tauri.listPages).mockResolvedValue([
      page({
        id: "page-architecture",
        title: "Wenlan app architecture",
        domain: "Projects",
        summary: "How the desktop app, daemon, and page compiler fit together.",
        source_memory_ids: ["m1", "m2", "m3", "m4"],
        version: 3,
      }),
      page({
        id: "page-policy",
        title: "Codex workflow policy",
        domain: "Decisions",
        source_memory_ids: ["m5", "m6"],
        version: 2,
      }),
    ]);

    renderHome();

    expect(await screen.findByRole("heading", { name: "Today in Wenlan" })).toBeInTheDocument();
    expect(tauri.listPages).toHaveBeenCalledWith("active", undefined, 1000);
    expect(screen.getByTestId("wiki-home")).toHaveStyle({ display: "grid" });
    expect(screen.getByTestId("wiki-index-summary")).toHaveAttribute("aria-label", "Index");
    expect(within(screen.getByTestId("wiki-context-rail")).queryByRole("heading", { name: "Index" })).toBeNull();
    expect(screen.getByTestId("wiki-context-rail")).not.toHaveTextContent("Recently active");
    expect(screen.getByTestId("wiki-context-pages")).toHaveTextContent("2");
    expect(screen.getByTestId("wiki-context-updated-today")).toHaveTextContent("2");
    expect(screen.getByTestId("wiki-context-needs-review")).toHaveTextContent("0");
    expect(screen.queryByTestId("wiki-space-filter-row")).toBeNull();
    expect(screen.queryByTestId("wiki-recent-spaces")).toBeNull();
    expect(screen.queryByText("Wiki pages")).toBeNull();
    expect(screen.queryByText("Compiled pages, links, and sources your agents can traverse.")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Recent Space" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Recently refined" })).toBeNull();
    expect(screen.getByText("Wenlan app architecture")).toBeInTheDocument();
    expect(screen.getByText("4 sources")).toBeInTheDocument();
    expect(screen.getAllByText("updated today").length).toBeGreaterThan(0);
    expect(screen.queryByText("Key facts")).toBeNull();
    expect(screen.queryByText("Related pages")).toBeNull();
    expect(screen.queryByText("Related sources")).toBeNull();
    expect(screen.queryByText("source-backed")).toBeNull();
    expect(screen.queryByTestId("what-happens-next")).toBeNull();
  });

  it("keeps today, index, articles, and review items in the expected reading order", async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 720,
      left: 0,
      right: 1000,
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.mocked(tauri.listPages).mockResolvedValue([
      page({ id: "page-architecture", title: "Wenlan app architecture", source_memory_ids: ["m1", "m2", "m3"] }),
      page({ id: "page-policy", title: "Codex workflow policy", source_memory_ids: ["m4"] }),
    ]);

    try {
      renderHome();

      await screen.findByTestId("wiki-home");
      const todayHeading = screen.getByTestId("wiki-today-heading");
      const contextRail = screen.getByTestId("wiki-context-rail");
      const pageList = screen.getByTestId("wiki-page-list");
      const pageUpdates = screen.getByTestId("wiki-page-updates");

      expect(todayHeading.compareDocumentPosition(contextRail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(contextRail.compareDocumentPosition(pageList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(pageList.compareDocumentPosition(pageUpdates) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      expect(todayHeading).not.toHaveTextContent("2 pages");
      expect(screen.getByTestId("wiki-context-pages")).toHaveTextContent("2");

      expect(screen.getByTestId("wiki-index-summary")).toHaveAttribute("aria-label", "Index");
      // Review items stay in the page-updates section, not the rail (the
      // needs-review metric label is allowed here).
      expect(within(contextRail).queryByText("Wenlan app architecture")).toBeNull();
      expect(within(contextRail).queryByRole("heading", { name: "Index" })).toBeNull();

      expect(screen.getByTestId("wiki-page-list")).toHaveStyle({ borderTopStyle: "none" });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("opens wiki page rows from the home index", async () => {
    const onSelectPage = vi.fn();
    const user = userEvent.setup();
    vi.mocked(tauri.listPages).mockResolvedValue([
      page({
        id: "page-architecture",
        title: "Wenlan app architecture",
        domain: "Projects",
        source_memory_ids: ["m1", "m2", "m3"],
        version: 2,
      }),
    ]);

    renderHome({ onSelectPage });

    await user.click(await screen.findByRole("button", { name: /open Wenlan app architecture/i }));

    expect(onSelectPage).toHaveBeenCalledWith("page-architecture");
  });

  it("does not duplicate space navigation on the home index", async () => {
    vi.mocked(tauri.listPages).mockResolvedValue([
      page({
        id: "page-architecture",
        title: "Wenlan app architecture",
        domain: "Projects",
      }),
      page({
        id: "page-policy",
        title: "Codex workflow policy",
        domain: "Decisions",
      }),
    ]);

    renderHome();

    await screen.findByRole("heading", { name: "Today in Wenlan" });

    expect(screen.queryByTestId("wiki-space-filter-row")).toBeNull();
    expect(screen.queryByRole("button", { name: /open Projects space/i })).toBeNull();
  });

  it("does not expose recent spaces from the home context rail", async () => {
    vi.mocked(tauri.listPages).mockResolvedValue([
      page({
        id: "page-architecture",
        title: "Wenlan app architecture",
        domain: "Projects",
        last_modified: "2026-06-30T12:00:00Z",
      }),
      page({
        id: "page-policy",
        title: "Codex workflow policy",
        domain: "Decisions",
        last_modified: "2026-06-29T12:00:00Z",
      }),
    ]);

    renderHome();

    await screen.findByRole("heading", { name: "Today in Wenlan" });

    expect(screen.queryByTestId("wiki-recent-spaces")).toBeNull();
    expect(screen.getByTestId("wiki-context-rail")).not.toHaveTextContent("Recently active");
  });

  it("counts every queue item in needs review and only today's pages in updated today", async () => {
    vi.mocked(tauri.listPages).mockResolvedValue([
      page({ id: "page-a", title: "A" }),
      page({ id: "page-b", title: "B" }),
      page({ id: "page-c", title: "C" }),
      page({ id: "page-d", title: "D", last_modified: "2026-06-01T12:00:00Z" }),
      page({ id: "page-e", title: "E", last_modified: "2026-06-01T12:00:00Z" }),
    ]);
    vi.mocked(tauri.listPendingRevisions).mockResolvedValue([
      {
        target_source_id: "mem-a",
        revision_source_id: "mem-a-rev",
        revision_content: "First proposed wording",
        source_agent: "claude-code",
        last_modified: 1_782_365_076,
      },
      {
        target_source_id: "mem-b",
        revision_source_id: "mem-b-rev",
        revision_content: "Second proposed wording",
        source_agent: "claude-code",
        last_modified: 1_782_365_077,
      },
      {
        target_source_id: "mem-c",
        revision_source_id: "mem-c-rev",
        revision_content: "Third proposed wording",
        source_agent: "claude-code",
        last_modified: 1_782_365_078,
      },
    ]);
    vi.mocked(tauri.listRefinements).mockResolvedValue({
      proposals: [
        {
          id: "ref-merge",
          action: "entity_merge",
          source_ids: ["ent-a", "ent-b"],
          payload: { action: "entity_merge", existing_id: "ent-a", new_id: "ent-b", similarity: 0.86 },
          confidence: 0.86,
          created_at: nowIso,
        },
      ],
    });

    renderHome({ onOpenDistillReview: vi.fn() });

    await screen.findByRole("heading", { name: "Today in Wenlan" });

    // The rail's list slices to 3 items; the metric must still count all 4.
    await screen.findByText("Review all 4");
    expect(screen.getByTestId("wiki-context-needs-review")).toHaveTextContent("4");
    expect(screen.getByTestId("wiki-context-updated-today")).toHaveTextContent("3");
    expect(screen.getByText("Third proposed wording")).toBeInTheDocument();
    expect(screen.queryByText("Entity merge")).toBeNull();
  });

  it("does not navigate to the synthetic Unsorted page bucket", async () => {
    vi.mocked(tauri.listPages).mockResolvedValue([
      page({ id: "page-unsorted", title: "Unassigned page" }),
    ]);

    renderHome();

    await screen.findByRole("heading", { name: "Today in Wenlan" });

    expect(screen.getByText("Unassigned page")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open Unsorted space/i })).toBeNull();
    expect(screen.queryByText("Unsorted")).toBeNull();
  });

  it("does not render traversal paths on the home surface", async () => {
    vi.mocked(tauri.listPages).mockResolvedValue([
      page({ id: "page-wenlan", title: "Wenlan app architecture", domain: "Projects" }),
    ]);
    vi.mocked(tauri.listRecentRetrievals).mockResolvedValue([
      {
        timestamp_ms: Date.now(),
        agent_name: "claude-code",
        query: "wiki home",
        page_titles: ["Wenlan app architecture", "Codex workflow policy"],
        page_ids: ["page-wenlan", "page-policy"],
        memory_snippets: [],
      },
    ]);

    renderHome();

    await screen.findByRole("heading", { name: "Today in Wenlan" });

    expect(screen.queryByTestId("wiki-traversal-paths")).toBeNull();
    expect(screen.queryByText("Traversal paths")).toBeNull();
  });

  it("keeps the needs-review rail secondary to the index", async () => {
    const onOpenDistillReview = vi.fn();
    const user = userEvent.setup();
    vi.mocked(tauri.listPages).mockResolvedValue([
      page({ id: "page-current", title: "Current page", domain: "Projects" }),
    ]);
    vi.mocked(tauri.listPendingRevisions).mockResolvedValue([
      {
        target_source_id: "mem-target",
        revision_source_id: "mem-revision",
        revision_content: "The durable updated wording from the daemon.",
        source_agent: "claude-code",
        last_modified: 1_782_365_076,
      },
    ]);

    renderHome({ onOpenDistillReview });

    const contextRail = await screen.findByTestId("wiki-context-rail");
    expect(screen.getByTestId("wiki-index-summary")).toHaveAttribute("aria-label", "Index");
    expect(within(contextRail).queryByRole("heading", { name: "Index" })).toBeNull();
    expect(contextRail).not.toHaveTextContent("Recently active");
    expect(within(contextRail).queryByText(/durable updated wording/)).toBeNull();

    const pageUpdates = screen.getByTestId("wiki-page-updates");
    expect(pageUpdates).toHaveTextContent("Needs review");
    await within(pageUpdates).findByText(/The durable updated wording/);
    expect(pageUpdates).toHaveTextContent("Memory revision");
    expect(pageUpdates).toHaveTextContent("proposed by claude-code");
    expect(pageUpdates).not.toHaveTextContent("Current page");
    expect(pageUpdates).toHaveTextContent("Review all 1");

    await user.click(within(pageUpdates).getByRole("button", { name: /review all 1/i }));

    expect(onOpenDistillReview).toHaveBeenCalledTimes(1);
  });

  it("opens the page review route from the home maintenance area", async () => {
    const onOpenDistillReview = vi.fn();
    const user = userEvent.setup();

    renderHome({ onOpenDistillReview });

    await user.click(await screen.findByRole("button", { name: /review page changes/i }));

    expect(onOpenDistillReview).toHaveBeenCalledTimes(1);
  });

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

  it("does not use recent activity as review items", async () => {
    const now = Date.now();
    vi.mocked(tauri.listPages).mockResolvedValue([
      page({ id: "page-current", title: "Current page", domain: "Projects" }),
    ]);
    vi.mocked(tauri.listRecentPages).mockResolvedValue([
      { kind: "concept", id: "c1", title: "Flagged concept", snippet: "s", timestamp_ms: now, badge: { kind: "needs_review" } },
      { kind: "concept", id: "c2", title: "Fresh concept", snippet: "s", timestamp_ms: now - 500, badge: { kind: "new" } },
    ] as any);
    vi.mocked(tauri.listRecentMemories).mockResolvedValue([
      { kind: "memory", id: "m1", title: "Refined memory", snippet: "s", timestamp_ms: now - 1000, badge: { kind: "refined" } },
    ] as any);
    renderHome();
    const strip = await screen.findByTestId("worth-a-glance");
    await within(strip).findByText("All caught up");
    expect(strip.textContent).not.toContain("Flagged concept");
    expect(strip.textContent).not.toContain("Fresh concept");
    expect(strip.textContent).not.toContain("Refined memory");
  });

  it("opens the review dialog from a rail revision and approves it", async () => {
    const user = userEvent.setup();
    vi.mocked(tauri.listPendingRevisions)
      .mockResolvedValueOnce([
        {
          target_source_id: "mem-target",
          revision_source_id: "mem-revision",
          revision_content: "The durable updated wording from the daemon.",
          source_agent: "claude-code",
          last_modified: 1_782_365_076,
        },
      ])
      .mockResolvedValue([]);
    vi.mocked(tauri.listPages).mockResolvedValue([
      page({ id: "page-current", title: "Current page", domain: "Projects" }),
    ]);

    renderHome();

    await user.click(
      await screen.findByRole("button", { name: /Review The durable updated wording/ }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("heading", { name: "Target memory" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(tauri.acceptPendingRevision).toHaveBeenCalledWith("mem-target");
    });
  });

  it("surfaces unconfirmed captures in the needs-review rail with confirm/forget", async () => {
    const user = userEvent.setup();
    vi.mocked(tauri.listPages).mockResolvedValue([
      page({ id: "page-current", title: "Current page" }),
    ]);
    vi.mocked(tauri.listUnconfirmedMemories).mockResolvedValue([
      {
        kind: "memory",
        id: "mem-capture",
        title: "User prefers pnpm over npm",
        snippet: "Stated while setting up the monorepo.",
        timestamp_ms: 1_782_365_080_000,
        badge: { kind: "needs_review" },
      },
    ]);

    renderHome({ onOpenDistillReview: vi.fn() });

    await screen.findByRole("heading", { name: "Today in Wenlan" });

    // The rail lists the capture and the context metric counts it.
    await screen.findByText("User prefers pnpm over npm");
    expect(screen.getByTestId("wiki-context-needs-review")).toHaveTextContent("1");

    await user.click(
      screen.getByRole("button", { name: /User prefers pnpm over npm/ }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Unconfirmed capture")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Forget" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(tauri.confirmMemory).toHaveBeenCalledWith("mem-capture"));
    expect(tauri.deleteMemory).not.toHaveBeenCalled();
  });

  it("opens the contradiction dialog with before/after panes and resolves it", async () => {
    const user = userEvent.setup();
    vi.mocked(tauri.listRefinements).mockResolvedValue({
      proposals: [
        {
          id: "ref-contra",
          action: "detect_contradiction",
          source_ids: ["mem-new", "mem-old"],
          payload: { action: "detect_contradiction" },
          confidence: 0.78,
          created_at: nowIso,
        },
      ],
    } as any);
    vi.mocked(tauri.listPages).mockResolvedValue([
      page({ id: "page-current", title: "Current page" }),
    ]);
    vi.mocked(tauri.getMemoryDetail).mockImplementation(
      async (sourceId: string) =>
        ({
          source_id: sourceId,
          title: sourceId === "mem-new" ? "New memory" : "Old memory",
          content:
            sourceId === "mem-new"
              ? "The project stores data in redb."
              : "The project stores data in SQLite.",
          summary: null,
          memory_type: null,
          domain: null,
          source_agent: null,
          confidence: null,
          confirmed: true,
          pinned: false,
          supersedes: null,
          last_modified: 1_782_365_000,
          chunk_count: 1,
        }) as any,
    );

    renderHome();

    await user.click(
      await screen.findByRole("button", { name: "Review Contradiction" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Existing memory")).toBeInTheDocument();
    expect(within(dialog).getByText("New memory — newer")).toBeInTheDocument();
    // Existing pane keeps the old wording; the new pane shows the replacement.
    await within(dialog).findByText(/SQLite/);
    await within(dialog).findByText(/redb/);
    expect(
      within(dialog).getByRole("button", { name: "Keep both" }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Resolve" }));
    await waitFor(() =>
      expect(tauri.acceptRefinement).toHaveBeenCalledWith("ref-contra"),
    );
    expect(tauri.rejectRefinement).not.toHaveBeenCalled();
  });

  it("surfaces refinement proposals in the needs-review rail", async () => {
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
    vi.mocked(tauri.listPages).mockResolvedValue([
      page({ id: "page-current", title: "Current page", domain: "Projects" }),
    ]);

    renderHome();

    const strip = await screen.findByTestId("worth-a-glance");
    await within(strip).findByText(/Entity merge · 86% confidence/);
  });

  it("does not render inline approval actions in the needs-review rail", async () => {
    vi.mocked(tauri.listRefinements).mockResolvedValue({
      proposals: [
        {
          id: "ref-merge",
          action: "entity_merge",
          source_ids: ["mem-a", "mem-b"],
          payload: { action: "entity_merge", existing_id: "ent-a", new_id: "ent-b", similarity: 0.86 },
          confidence: 0.86,
          created_at: nowIso,
        },
      ],
    });
    vi.mocked(tauri.listPendingRevisions).mockResolvedValue([
      {
        target_source_id: "mem-target",
        revision_source_id: "mem-revision",
        revision_content: "The durable updated wording from the daemon.",
        source_agent: "claude-code",
        last_modified: 1_782_365_076,
      },
    ]);
    vi.mocked(tauri.listPages).mockResolvedValue([
      page({ id: "page-current", title: "Current page", domain: "Projects" }),
    ]);

    renderHome();

    const rail = await screen.findByTestId("worth-a-glance");
    await within(rail).findByText(/The durable updated wording/);
    // Approve/Dismiss live in the review dialog, never inline in the rail.
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    expect(tauri.acceptPendingRevision).not.toHaveBeenCalled();
    expect(tauri.acceptRefinement).not.toHaveBeenCalled();
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

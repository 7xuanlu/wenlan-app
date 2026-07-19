// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PageDetail from "./PageDetail";

// Same reasoning as PageCanvas.test.tsx: React Flow needs real dimensions.
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes, nodeTypes }: any) => (
    <div data-testid="react-flow">
      {nodes.map((n: any) => {
        const NodeComponent = nodeTypes[n.type];
        return <NodeComponent key={n.id} id={n.id} data={n.data} />;
      })}
    </div>
  ),
  ReactFlowProvider: ({ children }: any) => <>{children}</>,
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  useReactFlow: () => ({ getViewport: () => ({ x: 0, y: 0, zoom: 1 }) }),
}));

vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tauri")>()),
  // Inlined on purpose: vi.mock factories are hoisted above every top-level
  // binding, so a shared fixture const would be in its temporal dead zone.
  getPage: vi.fn().mockResolvedValue({
    id: "concept_abc",
    title: "libSQL Architecture",
    summary: "Core database layer",
    content: "libSQL is the core database layer.\n\nMore prose here.",
    entity_id: null,
    domain: null,
    source_memory_ids: ["mem_1"],
    version: 3,
    status: "active",
    created_at: "2026-04-01T00:00:00+00:00",
    last_compiled: "2026-04-07T12:00:00+00:00",
    last_modified: "2026-04-07T12:00:00+00:00",
  }),
  getPageSources: vi.fn().mockResolvedValue([
    {
      source: { page_id: "concept_abc", memory_source_id: "mem_1", linked_at: 1, link_reason: "page_growth" },
      memory: {
        source_id: "mem_1",
        title: "libSQL stores vectors",
        content: "libSQL stores vectors in F32_BLOB columns",
        summary: null,
        memory_type: "fact",
        domain: null,
        source_agent: "claude",
        confidence: 0.9,
        confirmed: true,
        last_modified: 1,
      },
    },
  ]),
  getPageLinks: vi.fn().mockResolvedValue({ outbound: [], inbound: [] }),
  getPageRevisions: vi.fn().mockResolvedValue({ entries: [], user_edited: false }),
  listRegisteredSources: vi.fn().mockResolvedValue([]),
  getEntityDetail: vi.fn().mockResolvedValue(null),
  getPageMap: vi.fn().mockResolvedValue({
    page_id: "concept_abc",
    revision: 3,
    map_schema: 1,
    viewport: null,
    nodes: [
      {
        id: "n_root", parent_id: null, rank: 0, ref_kind: "page", ref_id: "concept_abc",
        label: null, status: "active", pinned: false, placed: false, collapsed: false,
        x: null, y: null, width: null, height: null, ref_state: "live",
      },
      {
        id: "n_mem", parent_id: "n_root", rank: 0, ref_kind: "memory", ref_id: "mem_1",
        label: null, status: "active", pinned: false, placed: false, collapsed: false,
        x: null, y: null, width: null, height: null, ref_state: "live",
      },
    ],
    edges: [],
  }),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={client}>
        <PageDetail
          pageId="concept_abc"
          onBack={vi.fn()}
          onMemoryClick={vi.fn()}
          onPageClick={vi.fn()}
          onEntityClick={vi.fn()}
        />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("PageDetail tabs", () => {
  it("opens on Read with both tabs exposed to assistive tech", async () => {
    renderDetail();
    await screen.findByText("libSQL Architecture");

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((el) => el.textContent)).toEqual(["Read", "Canvas"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
    expect(screen.getByText(/Page info/i)).toBeTruthy();
  });

  it("swaps the reading column and Page info for the canvas", async () => {
    const { user } = renderDetail();
    await screen.findByText("libSQL Architecture");

    await user.click(screen.getByRole("tab", { name: "Canvas" }));

    expect(
      await screen.findByRole("region", { name: "Canvas for libSQL Architecture" }),
    ).toBeTruthy();
    // the page title stays in the header; the prose and Page info do not
    expect(screen.queryByText(/Page info/i)).toBeNull();
    expect(screen.queryByText("More prose here.")).toBeNull();
  });

  it("resolves the root node label from the page title it already loaded", async () => {
    const { user } = renderDetail();
    await screen.findByText("libSQL Architecture");
    await user.click(screen.getByRole("tab", { name: "Canvas" }));

    // Both nodes arrive with label: null — the daemon stores refs, the client
    // renders the backing objects PageDetail already has in hand.
    await screen.findByTestId("react-flow");
    expect(screen.getAllByText("libSQL Architecture").length).toBeGreaterThan(1);
    expect(screen.getByText("libSQL stores vectors")).toBeTruthy();
  });

  it("moves between tabs with the arrow keys", async () => {
    const { user } = renderDetail();
    await screen.findByText("libSQL Architecture");

    screen.getByRole("tab", { name: "Read" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Canvas" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Canvas" }));

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Read" }).getAttribute("aria-selected")).toBe("true");
  });

  it("hides the tab row while editing so nobody types into an unseen page", async () => {
    const { user } = renderDetail();
    await screen.findByText("libSQL Architecture");

    await user.click(screen.getByRole("tab", { name: "Canvas" }));
    await screen.findByRole("region", { name: "Canvas for libSQL Architecture" });

    await user.click(screen.getByTitle("Edit page"));
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Canvas for libSQL Architecture" })).toBeNull();
  });
});

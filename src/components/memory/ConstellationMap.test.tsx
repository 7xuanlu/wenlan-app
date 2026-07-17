// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// jsdom does not provide ResizeObserver — stub it, capturing the callback so
// tests can fire a synthetic resize.
const capturedResizeCallbacks = vi.hoisted(() => [] as ((entries: any[]) => void)[]);
class ResizeObserverStub {
  constructor(callback: (entries: any[]) => void) {
    capturedResizeCallbacks.push(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("../../lib/tauri", () => ({
  listEntities: vi.fn(),
  getEntityDetail: vi.fn(),
  listMemoriesRich: vi.fn(),
  listPages: vi.fn(),
}));

// react-force-graph-2d requires canvas — mock it in jsdom. Captures both the
// graphData (existing tests) and the full props object (needed to invoke
// onNodeClick/onEngineStop/nodeCanvasObject directly, since this mock renders
// no clickable DOM or canvas). Also exposes the ref's imperative methods
// (centerAt/zoom/zoomToFit) as spies — React 19 passes `ref` as a plain prop
// to function components, so the mock can populate it itself, no forwardRef
// needed — to genuinely test the camera-fly behavior, not just smoke-test it.
const capturedGraphData = vi.hoisted(() => [] as any[]);
const capturedProps = vi.hoisted(() => [] as any[]);
const fgMethodSpies = vi.hoisted(() => ({ centerAt: vi.fn(), zoom: vi.fn(), zoomToFit: vi.fn() }));
vi.mock("react-force-graph-2d", () => ({
  __esModule: true,
  default: vi.fn((props: any) => {
    capturedGraphData.push(props.graphData);
    capturedProps.push(props);
    if (props.ref) {
      props.ref.current = {
        centerAt: fgMethodSpies.centerAt,
        zoom: fgMethodSpies.zoom,
        zoomToFit: fgMethodSpies.zoomToFit,
        d3Force: vi.fn(() => ({ strength: vi.fn() })),
      };
    }
    return (
      <div data-testid="force-graph" data-link-count={props.graphData?.links?.length ?? 0}>
        {props.graphData?.nodes?.map((n: any) => (
          <span key={n.id} className="constellation-node" data-entity-type={n.entityType}>{n.name}</span>
        ))}
      </div>
    );
  }),
}));

function makeMockCtx() {
  return {
    beginPath: vi.fn(),
    arc: vi.fn(),
    roundRect: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
    font: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "middle" as CanvasTextBaseline,
  } as unknown as CanvasRenderingContext2D;
}

import { listEntities, getEntityDetail, listMemoriesRich, listPages } from "../../lib/tauri";
import ConstellationMap from "./ConstellationMap";

const mockListEntities = vi.mocked(listEntities);
const mockGetEntityDetail = vi.mocked(getEntityDetail);
const mockListMemoriesRich = vi.mocked(listMemoriesRich);
const mockListPages = vi.mocked(listPages);

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return { ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>), qc };
}

function makeEntity(overrides: Partial<import("../../lib/tauri").Entity> = {}): import("../../lib/tauri").Entity {
  return {
    id: overrides.id ?? "e1",
    name: overrides.name ?? "Entity",
    entity_type: overrides.entity_type ?? "concept",
    domain: overrides.domain ?? null,
    source_agent: overrides.source_agent ?? null,
    confidence: overrides.confidence ?? null,
    confirmed: overrides.confirmed ?? false,
    created_at: overrides.created_at ?? Date.now(),
    updated_at: overrides.updated_at ?? Date.now(),
  };
}

function makeMemory(overrides: Partial<import("../../lib/tauri").MemoryItem> = {}): import("../../lib/tauri").MemoryItem {
  return {
    source_id: overrides.source_id ?? "m1",
    title: overrides.title ?? "Memory",
    content: overrides.content ?? "content",
    summary: overrides.summary ?? null,
    memory_type: overrides.memory_type ?? "fact",
    domain: overrides.domain ?? null,
    source_agent: overrides.source_agent ?? null,
    confidence: overrides.confidence ?? null,
    confirmed: overrides.confirmed ?? false,
    pinned: overrides.pinned ?? false,
    supersedes: overrides.supersedes ?? null,
    last_modified: overrides.last_modified ?? Date.now(),
    chunk_count: overrides.chunk_count ?? 1,
    ...overrides,
  };
}

function makePage(overrides: Partial<import("../../lib/tauri").Page> = {}): import("../../lib/tauri").Page {
  return {
    id: overrides.id ?? "p1",
    title: overrides.title ?? "Page",
    summary: overrides.summary ?? null,
    content: overrides.content ?? "content",
    entity_id: overrides.entity_id ?? null,
    domain: overrides.domain ?? null,
    source_memory_ids: overrides.source_memory_ids ?? [],
    version: overrides.version ?? 1,
    status: overrides.status ?? "active",
    created_at: overrides.created_at ?? "2026-01-01T00:00:00+00:00",
    last_compiled: overrides.last_compiled ?? "2026-01-01T00:00:00+00:00",
    last_modified: overrides.last_modified ?? "2026-01-01T00:00:00+00:00",
    ...overrides,
  };
}

describe("ConstellationMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedGraphData.length = 0;
    capturedProps.length = 0;
    capturedResizeCallbacks.length = 0;
    // Toggle state persists in localStorage across renders — start every
    // test from the documented default (both off) regardless of test order.
    localStorage.clear();
    mockListMemoriesRich.mockResolvedValue([]);
    mockListPages.mockResolvedValue([]);
  });

  it("renders the force graph when entities exist", async () => {
    const entities = [
      makeEntity({ id: "e1", name: "Alice", entity_type: "person" }),
      makeEntity({ id: "e2", name: "Origin", entity_type: "project" }),
    ];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({
      entity: entities[0],
      observations: [],
      relations: [],
    });

    renderWithQuery(<ConstellationMap />);

    expect(await screen.findByTestId("force-graph")).toBeInTheDocument();
  });

  it("renders a circle with class constellation-node for each entity", async () => {
    const entities = [
      makeEntity({ id: "e1", name: "Alice", entity_type: "person" }),
      makeEntity({ id: "e2", name: "Origin", entity_type: "project" }),
      makeEntity({ id: "e3", name: "Memory", entity_type: "concept" }),
    ];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockImplementation(async (id) => ({
      entity: entities.find((e) => e.id === id) ?? entities[0],
      observations: [],
      relations: [],
    }));

    const { container } = renderWithQuery(<ConstellationMap />);

    await screen.findByText("3 entities");

    const nodes = container.querySelectorAll(".constellation-node");
    expect(nodes).toHaveLength(3);
  });

  it("shows entity count label", async () => {
    const entities = [
      makeEntity({ id: "e1", name: "A" }),
      makeEntity({ id: "e2", name: "B" }),
      makeEntity({ id: "e3", name: "C" }),
    ];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({
      entity: entities[0],
      observations: [],
      relations: [],
    });

    renderWithQuery(<ConstellationMap />);

    expect(await screen.findByText("3 entities")).toBeInTheDocument();
  });

  it("renders empty state message when no entities", async () => {
    mockListEntities.mockResolvedValue([]);

    renderWithQuery(<ConstellationMap />);

    expect(
      await screen.findByText("Your constellation will appear as knowledge grows"),
    ).toBeInTheDocument();
  });

  // --- honest states: loading / error+retry / empty are three distinct
  // renders, and a dead daemon must never look like an empty graph. ---

  it("shows a distinct loading state while entities are still in flight, then resolves to empty", async () => {
    let resolveEntities!: (value: import("../../lib/tauri").Entity[]) => void;
    mockListEntities.mockReturnValue(
      new Promise((resolve) => {
        resolveEntities = resolve;
      }),
    );

    renderWithQuery(<ConstellationMap />);

    // Pending: the loading copy is up, and neither the empty nor the graph
    // has rendered yet.
    expect(await screen.findByText("Loading your knowledge graph…")).toBeInTheDocument();
    expect(screen.queryByText("Your constellation will appear as knowledge grows")).not.toBeInTheDocument();
    expect(screen.queryByTestId("force-graph")).not.toBeInTheDocument();

    resolveEntities([]);

    expect(
      await screen.findByText("Your constellation will appear as knowledge grows"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading your knowledge graph…")).not.toBeInTheDocument();
  });

  it("renders an error panel with retry on query failure, distinct from the empty state", async () => {
    mockListEntities.mockRejectedValueOnce(new Error("daemon unreachable"));

    renderWithQuery(<ConstellationMap />);

    expect(await screen.findByText("Couldn't load your knowledge graph.")).toBeInTheDocument();
    expect(screen.queryByText("Your constellation will appear as knowledge grows")).not.toBeInTheDocument();

    const entities = [makeEntity({ id: "e1", name: "Alice" })];
    mockListEntities.mockResolvedValueOnce(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    screen.getByRole("button", { name: "Retry" }).click();

    expect(await screen.findByTestId("force-graph")).toBeInTheDocument();
  });

  it("adapts GraphModel into the force-graph shape: dedupes cross-detail edges and synthesizes neighbor-only nodes", async () => {
    // The SAME relation between A and B is fetched from BOTH endpoints (A's
    // detail carries it outgoing, B's mirrors it incoming, same id) — this
    // must collapse to ONE edge, not two, or the adapter isn't genuinely
    // routing through buildGraphModel's cross-detail dedup. A's detail also
    // carries a second, unmirrored relation to C, an entity NOT present in
    // the top-level `entities` list — the old inline builder dropped edges
    // whose target wasn't in `entities` and never synthesized C as a node;
    // buildGraphModel does both.
    const a = makeEntity({ id: "a", name: "Alice", entity_type: "person" });
    const b = makeEntity({ id: "b", name: "Bob", entity_type: "project" });
    mockListEntities.mockResolvedValue([a, b]);
    mockGetEntityDetail.mockImplementation(async (id: string) => {
      if (id === "a") {
        return {
          entity: a,
          observations: [],
          relations: [
            { id: "r-ab", relation_type: "collaborates", direction: "outgoing", entity_id: "b", entity_name: "Bob", entity_type: "project", source_agent: null, created_at: 1 },
            { id: "r-ac", relation_type: "founded", direction: "outgoing", entity_id: "c", entity_name: "Cove", entity_type: "organization", source_agent: null, created_at: 2 },
          ],
        };
      }
      return {
        entity: b,
        observations: [],
        relations: [
          { id: "r-ab", relation_type: "collaborates", direction: "incoming", entity_id: "a", entity_name: "Alice", entity_type: "person", source_agent: null, created_at: 1 },
        ],
      };
    });

    const { container } = renderWithQuery(<ConstellationMap />);

    await screen.findByTestId("force-graph");
    expect(container.querySelectorAll(".constellation-node")).toHaveLength(3);
    expect(screen.getByTestId("force-graph")).toHaveAttribute("data-link-count", "2");
    expect(screen.getByText("Cove")).toBeInTheDocument();

    // The view collapses same-pair links for rendering regardless of how many
    // edge records the model produced, so link count alone can't prove the
    // mirrored relation was deduped at the model level — degree can: with a
    // genuine dedup, "a" has one edge to "b" plus one to "c" (degree 2) and
    // "b" has just the one to "a" (degree 1). A broken cross-detail dedup
    // double-counts r-ab from both endpoints' details instead.
    const latestNodes = capturedGraphData[capturedGraphData.length - 1].nodes;
    expect(latestNodes.find((n: any) => n.id === "a").connectionCount).toBe(2);
    expect(latestNodes.find((n: any) => n.id === "b").connectionCount).toBe(1);
  });

  it("collapses parallel relations between the same pair into one undirected link", async () => {
    // A and B have TWO distinct relations between them, one in each direction.
    // GraphModel intentionally keeps both as separate edges (its parallel-edge
    // policy — see model.ts), but the canvas draws undirected lines and
    // d3-force sums pull per link, so the adapter must collapse them to one
    // line per pair — matching the pre-rewrite behavior this view relies on.
    const a = makeEntity({ id: "a", name: "Alice", entity_type: "person" });
    const b = makeEntity({ id: "b", name: "Bob", entity_type: "project" });
    mockListEntities.mockResolvedValue([a, b]);
    mockGetEntityDetail.mockImplementation(async (id: string) => {
      if (id === "a") {
        return {
          entity: a,
          observations: [],
          relations: [
            { id: "r1", relation_type: "founded", direction: "outgoing", entity_id: "b", entity_name: "Bob", entity_type: "project", source_agent: null, created_at: 1 },
            { id: "r2", relation_type: "mentors", direction: "incoming", entity_id: "b", entity_name: "Bob", entity_type: "project", source_agent: null, created_at: 2 },
          ],
        };
      }
      return { entity: b, observations: [], relations: [] };
    });

    renderWithQuery(<ConstellationMap />);

    await screen.findByTestId("force-graph");
    expect(screen.getByTestId("force-graph")).toHaveAttribute("data-link-count", "1");
  });

  it("shows the partial-coverage chip only when relations were fetched for fewer entities than exist", async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeEntity({ id: `e${i}`, name: `Entity ${i}`, entity_type: "concept" }),
    );
    mockListEntities.mockResolvedValue(many);
    mockGetEntityDetail.mockImplementation(async (id: string) => ({
      entity: many.find((e) => e.id === id)!,
      observations: [],
      relations: [],
    }));

    renderWithQuery(<ConstellationMap />);

    expect(
      await screen.findByText("Connections shown for 20 of 25"),
    ).toBeInTheDocument();
  });

  it("hides the partial-coverage chip when relations were fetched for every entity", async () => {
    const few = [
      makeEntity({ id: "e1", name: "A" }),
      makeEntity({ id: "e2", name: "B" }),
    ];
    mockListEntities.mockResolvedValue(few);
    mockGetEntityDetail.mockImplementation(async (id: string) => ({
      entity: few.find((e) => e.id === id)!,
      observations: [],
      relations: [],
    }));

    renderWithQuery(<ConstellationMap />);

    await screen.findByTestId("force-graph");
    expect(screen.queryByTestId("constellation-coverage-chip")).not.toBeInTheDocument();
  });

  it("renders with reduced coverage when one detail fetch fails, not the full error state", async () => {
    const entities = [
      makeEntity({ id: "e1", name: "A" }),
      makeEntity({ id: "e2", name: "B" }),
      makeEntity({ id: "e3", name: "C" }),
    ];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockImplementation(async (id: string) => {
      if (id === "e2") throw new Error("detail fetch failed");
      return { entity: entities.find((e) => e.id === id)!, observations: [], relations: [] };
    });

    renderWithQuery(<ConstellationMap />);

    await screen.findByTestId("force-graph");
    expect(screen.queryByText("Couldn't load your knowledge graph.")).not.toBeInTheDocument();
    expect(await screen.findByText("Connections shown for 2 of 3")).toBeInTheDocument();
  });

  it("shows the full error state, not a graph, when every detail fetch fails", async () => {
    const entities = [
      makeEntity({ id: "e1", name: "A" }),
      makeEntity({ id: "e2", name: "B" }),
    ];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockRejectedValue(new Error("detail fetch failed"));

    renderWithQuery(<ConstellationMap />);

    expect(await screen.findByText("Couldn't load your knowledge graph.")).toBeInTheDocument();
    expect(screen.queryByTestId("force-graph")).not.toBeInTheDocument();
  });

  it("preserves node object identity across a same-topology refetch, while merging in updated display fields", async () => {
    const entities = [
      makeEntity({ id: "e1", name: "Alice", entity_type: "person" }),
      makeEntity({ id: "e2", name: "Bob", entity_type: "project" }),
    ];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockImplementation(async (id: string) => ({
      entity: entities.find((e) => e.id === id)!,
      observations: [],
      relations: [],
    }));

    const { qc } = renderWithQuery(<ConstellationMap />);

    await screen.findByTestId("force-graph");
    const before = capturedGraphData[capturedGraphData.length - 1].nodes.find((n: any) => n.id === "e1");
    expect(before.name).toBe("Alice");

    // Same ids, same (empty) relations — topology is unchanged — but the
    // entity's name changed server-side.
    mockListEntities.mockResolvedValue([{ ...entities[0], name: "Alicia" }, entities[1]]);
    await qc.refetchQueries({ queryKey: ["constellation-entities"] });

    await waitFor(() => {
      expect(capturedGraphData[capturedGraphData.length - 1].nodes.find((n: any) => n.id === "e1").name).toBe("Alicia");
    });
    const after = capturedGraphData[capturedGraphData.length - 1].nodes.find((n: any) => n.id === "e1");
    expect(after).toBe(before);
  });

  // --- Pages layer: view-level overlay mirroring the memory-layer pattern ---

  it("does not render page nodes when the Pages toggle is off by default", async () => {
    const entities = [makeEntity({ id: "e1", name: "Anchor", entity_type: "project" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });
    mockListPages.mockResolvedValue([makePage({ id: "p1", entity_id: "e1" })]);

    renderWithQuery(<ConstellationMap />);
    await screen.findByTestId("force-graph");

    const latestNodes = capturedGraphData[capturedGraphData.length - 1].nodes;
    expect(latestNodes.some((n: any) => n.id === "page:p1")).toBe(false);
    expect(mockListPages).not.toHaveBeenCalled();
  });

  it("adds a page node linked to its anchor entity when the Pages toggle is turned on", async () => {
    const entities = [makeEntity({ id: "e1", name: "Anchor", entity_type: "project" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });
    mockListPages.mockResolvedValue([makePage({ id: "p1", entity_id: "e1" })]);

    renderWithQuery(<ConstellationMap />);
    await screen.findByTestId("force-graph");

    screen.getByTestId("page-toggle").click();

    await waitFor(() => {
      const latest = capturedGraphData[capturedGraphData.length - 1];
      expect(latest.nodes.some((n: any) => n.id === "page:p1")).toBe(true);
    });

    const latest = capturedGraphData[capturedGraphData.length - 1];
    expect(latest.links).toContainEqual({ source: "page:p1", target: "e1" });
  });

  it("links a page to its cited memories only when both Pages and Memories are on", async () => {
    const entities = [makeEntity({ id: "e1", name: "Anchor", entity_type: "project" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });
    mockListMemoriesRich.mockResolvedValue([makeMemory({ source_id: "m1", title: "Cited memory", entity_id: "e1" })]);
    mockListPages.mockResolvedValue([makePage({ id: "p1", entity_id: "e1", source_memory_ids: ["m1"] })]);

    renderWithQuery(<ConstellationMap />);
    await screen.findByTestId("force-graph");

    // Pages on, Memories off: the page keeps its entity link, but no
    // page→mem link yet — the cited memory node doesn't exist on canvas.
    screen.getByTestId("page-toggle").click();
    await waitFor(() => {
      expect(capturedGraphData[capturedGraphData.length - 1].nodes.some((n: any) => n.id === "page:p1")).toBe(true);
    });
    let latest = capturedGraphData[capturedGraphData.length - 1];
    expect(latest.links).toContainEqual({ source: "page:p1", target: "e1" });
    expect(latest.links.some((l: any) => l.source === "page:p1" && l.target === "mem:m1")).toBe(false);

    // Turn Memories on too: the cited memory node now exists, so the
    // citation link appears.
    screen.getByTestId("memory-toggle").click();
    await waitFor(() => {
      latest = capturedGraphData[capturedGraphData.length - 1];
      expect(latest.links.some((l: any) => l.source === "page:p1" && l.target === "mem:m1")).toBe(true);
    });
  });

  it("shows a no-anchor page only once its cited memory is on the canvas (both toggles needed)", async () => {
    const entities = [makeEntity({ id: "e1", name: "Anchor", entity_type: "project" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });
    mockListMemoriesRich.mockResolvedValue([makeMemory({ source_id: "m1", title: "Cited memory", entity_id: "e1" })]);
    mockListPages.mockResolvedValue([
      makePage({ id: "p-orphan", entity_id: null, title: "Orphan Page", domain: null, source_memory_ids: ["m1"] }),
    ]);

    const { qc } = renderWithQuery(<ConstellationMap />);
    await screen.findByTestId("force-graph");

    screen.getByTestId("page-toggle").click();

    // Prove the pages fetch actually settled before trusting the absence
    // check below — an unsettled query would trivially show no page node
    // for the wrong reason (see: absence assertions going false-green).
    await waitFor(() => {
      expect(qc.getQueryState(["constellation-pages"])?.status).toBe("success");
    });
    expect(
      capturedGraphData[capturedGraphData.length - 1].nodes.some((n: any) => n.id === "page:p-orphan"),
    ).toBe(false);

    // Turn Memories on too: the cited memory node now exists, so the
    // no-anchor page gains a citation link and appears.
    screen.getByTestId("memory-toggle").click();
    await waitFor(() => {
      expect(
        capturedGraphData[capturedGraphData.length - 1].nodes.some((n: any) => n.id === "page:p-orphan"),
      ).toBe(true);
    });
  });

  it("passes page:<id> to onNodeClick when a page node is clicked", async () => {
    const entities = [makeEntity({ id: "e1", name: "Anchor", entity_type: "project" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });
    mockListPages.mockResolvedValue([makePage({ id: "p1", entity_id: "e1" })]);

    const onNodeClick = vi.fn();
    renderWithQuery(<ConstellationMap onNodeClick={onNodeClick} />);
    await screen.findByTestId("force-graph");

    screen.getByTestId("page-toggle").click();
    await waitFor(() => {
      expect(capturedGraphData[capturedGraphData.length - 1].nodes.some((n: any) => n.id === "page:p1")).toBe(true);
    });

    const latestProps = capturedProps[capturedProps.length - 1];
    latestProps.onNodeClick({ id: "page:p1", isPage: true });

    expect(onNodeClick).toHaveBeenCalledWith("page:p1");
  });

  // --- focusEntityId: emphasis ring paint + one-time camera fly ---

  it("draws an emphasis ring only for the focusEntityId node", async () => {
    const entities = [
      makeEntity({ id: "e1", name: "Alice", entity_type: "person" }),
      makeEntity({ id: "e2", name: "Bob", entity_type: "project" }),
    ];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    renderWithQuery(<ConstellationMap focusEntityId="e1" />);
    await screen.findByTestId("force-graph");

    const paintNode = capturedProps[capturedProps.length - 1].nodeCanvasObject;

    const focusedCtx = makeMockCtx();
    paintNode({ id: "e1", x: 1, y: 1, entityType: "person", stability: "new", connectionCount: 0 }, focusedCtx, 1);
    // Ring + halo — two stroked circles.
    expect(focusedCtx.stroke).toHaveBeenCalledTimes(2);

    const otherCtx = makeMockCtx();
    paintNode({ id: "e2", x: 2, y: 2, entityType: "project", stability: "new", connectionCount: 0 }, otherCtx, 1);
    expect(otherCtx.stroke).not.toHaveBeenCalled();
  });

  it("draws no ring at all when focusEntityId is not set", async () => {
    const entities = [makeEntity({ id: "e1", name: "Alice", entity_type: "person" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    renderWithQuery(<ConstellationMap />);
    await screen.findByTestId("force-graph");

    const paintNode = capturedProps[capturedProps.length - 1].nodeCanvasObject;
    const ctx = makeMockCtx();
    paintNode({ id: "e1", x: 1, y: 1, entityType: "person", stability: "new", connectionCount: 0 }, ctx, 1);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  // onEngineStop never fires in the real environment (confirmed live), so the
  // camera fly is driven by a settle-poll on the node's position instead. The
  // event handler is kept only as a dead-event-safe guard.

  it("never calls zoomToFit via onEngineStop when focusEntityId is set", async () => {
    const entities = [makeEntity({ id: "e1", name: "Alice", entity_type: "person" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    renderWithQuery(<ConstellationMap focusEntityId="e1" />);
    await screen.findByTestId("force-graph");

    const latestProps = capturedProps[capturedProps.length - 1];
    latestProps.onEngineStop();
    latestProps.onEngineStop();

    // If this event ever starts firing (version bump, different environment),
    // focus mode must still never let it re-fit and fight the poll's fly.
    expect(fgMethodSpies.zoomToFit).not.toHaveBeenCalled();
  });

  it("flies the camera to the focusEntityId node once its position stabilizes (settle-poll)", async () => {
    const entities = [
      makeEntity({ id: "e1", name: "Alice", entity_type: "person" }),
      makeEntity({ id: "e2", name: "Bob", entity_type: "project" }),
    ];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    renderWithQuery(<ConstellationMap focusEntityId="e1" />);
    await screen.findByTestId("force-graph");

    const latestProps = capturedProps[capturedProps.length - 1];
    const node = latestProps.graphData.nodes.find((n: any) => n.id === "e1");
    node.x = 123;
    node.y = 45;

    // The poll ticks every 250ms and flies once the position has held steady
    // for 2 consecutive ticks (3 reads total) — wait past that.
    await new Promise((r) => setTimeout(r, 900));

    expect(fgMethodSpies.centerAt).toHaveBeenCalledWith(123, 45, expect.any(Number));
    expect(fgMethodSpies.zoom).toHaveBeenCalledWith(2.75, expect.any(Number));
  });

  it("flies only once — the poll stops itself once the position stabilizes", async () => {
    const entities = [makeEntity({ id: "e1", name: "Alice", entity_type: "person" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    renderWithQuery(<ConstellationMap focusEntityId="e1" />);
    await screen.findByTestId("force-graph");

    const latestProps = capturedProps[capturedProps.length - 1];
    const node = latestProps.graphData.nodes.find((n: any) => n.id === "e1");
    node.x = 10;
    node.y = 10;
    await new Promise((r) => setTimeout(r, 900));
    expect(fgMethodSpies.centerAt).toHaveBeenCalledTimes(1);

    // Move the node again after the fly — a stopped poll must not react.
    node.x = 999;
    node.y = 999;
    await new Promise((r) => setTimeout(r, 900));
    expect(fgMethodSpies.centerAt).toHaveBeenCalledTimes(1);
  });

  it("does not fly after unmount (poll interval and give-up timer are cleared)", async () => {
    const entities = [makeEntity({ id: "e1", name: "Alice", entity_type: "person" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    const { unmount } = renderWithQuery(<ConstellationMap focusEntityId="e1" />);
    await screen.findByTestId("force-graph");

    const latestProps = capturedProps[capturedProps.length - 1];
    const node = latestProps.graphData.nodes.find((n: any) => n.id === "e1");
    node.x = 5;
    node.y = 5;

    unmount();
    // Long enough to cover the poll's stabilize window, had it kept running.
    await new Promise((r) => setTimeout(r, 900));

    expect(fgMethodSpies.centerAt).not.toHaveBeenCalled();
  });

  it("fits the graph on every engine stop when focusEntityId is unset (pre-existing behavior)", async () => {
    const entities = [makeEntity({ id: "e1", name: "Alice", entity_type: "person" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    renderWithQuery(<ConstellationMap />);
    await screen.findByTestId("force-graph");

    const latestProps = capturedProps[capturedProps.length - 1];
    latestProps.onEngineStop();
    expect(fgMethodSpies.zoomToFit).toHaveBeenCalledTimes(1);
    latestProps.onEngineStop();
    expect(fgMethodSpies.zoomToFit).toHaveBeenCalledTimes(2);
  });

  it("does not re-fit on resize when focusEntityId is set (focus mode owns the camera)", async () => {
    const entities = [makeEntity({ id: "e1", name: "Alice", entity_type: "person" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    renderWithQuery(<ConstellationMap focusEntityId="e1" />);
    await screen.findByTestId("force-graph");

    const resize = capturedResizeCallbacks[capturedResizeCallbacks.length - 1];
    resize([{ contentRect: { width: 800, height: 600 } }]);
    // The component's re-zoom is behind a 50ms setTimeout — wait past it.
    await new Promise((r) => setTimeout(r, 60));

    expect(fgMethodSpies.zoomToFit).not.toHaveBeenCalled();
  });

  it("re-fits on resize when focusEntityId is not set (pre-existing behavior)", async () => {
    const entities = [makeEntity({ id: "e1", name: "Alice", entity_type: "person" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    renderWithQuery(<ConstellationMap />);
    await screen.findByTestId("force-graph");

    const resize = capturedResizeCallbacks[capturedResizeCallbacks.length - 1];
    resize([{ contentRect: { width: 800, height: 600 } }]);
    await new Promise((r) => setTimeout(r, 60));

    expect(fgMethodSpies.zoomToFit).toHaveBeenCalledWith(0, -40);
  });
});

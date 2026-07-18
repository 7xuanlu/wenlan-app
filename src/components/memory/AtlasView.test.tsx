// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/tauri", () => ({
  listEntities: vi.fn(),
  getEntityDetail: vi.fn(),
}));

// jsdom has no WebGL context — a real Sigma would throw trying to acquire
// one. Mocked at module level per repo convention for canvas/WebGL surfaces
// (see ConstellationMap.test.tsx's react-force-graph-2d mock); the drawn
// graph itself is verified live in preview. This test only proves the three
// states, retry, mount/teardown, and the click handoff.
const capturedSigmaInstances = vi.hoisted(() => [] as any[]);
vi.mock("sigma", () => {
  class MouseCaptorMock {
    handlers = new Map<string, (payload: any) => void>();
    on(event: string, handler: (payload: any) => void) {
      this.handlers.set(event, handler);
      return this;
    }
  }
  class SigmaMock {
    handlers = new Map<string, (payload: any) => void>();
    mouseCaptor = new MouseCaptorMock();
    customBBox: unknown = null;
    constructor(
      public graph: any,
      public container: any,
      public settings: any,
    ) {
      capturedSigmaInstances.push(this);
    }
    on(event: string, handler: (payload: any) => void) {
      this.handlers.set(event, handler);
      return this;
    }
    getMouseCaptor() {
      return this.mouseCaptor;
    }
    // 100-unit graph span in a 400px-min-dim container: the fill-aware
    // default density is 0.6 * 400 / 100 = 2.4 px/unit (inside the [1.5, 3]
    // clamp), so the mount zoom-out must be exactly 6 / 2.4 = 2.5.
    getBBox() {
      return { x: [-50, 50], y: [-40, 40] };
    }
    getDimensions() {
      return { width: 400, height: 600 };
    }
    getCustomBBox() {
      return this.customBBox;
    }
    setCustomBBox(bbox: unknown) {
      this.customBBox = bbox;
    }
    viewportToGraph(coords: { x: number; y: number }) {
      return coords;
    }
    // Fake fit density: 6 px per graph unit, so the density cap (target 1.5)
    // must zoom out by exactly 4x.
    graphToViewport(coords: { x: number; y: number }) {
      return { x: coords.x * 6, y: coords.y * 6 };
    }
    camera = { ratio: 1, setState: vi.fn(), getBoundedRatio: (r: number) => r };
    getCamera() {
      return this.camera;
    }
    getViewportZoomedState = vi.fn((pos: { x: number; y: number }, ratio: number) => ({
      x: pos.x,
      y: pos.y,
      ratio,
    }));
    refresh() {}
    setSetting(_key: string, _value: unknown) {}
    kill() {}
  }
  return { default: SigmaMock };
});

import { listEntities, getEntityDetail } from "../../lib/tauri";
import AtlasView from "./AtlasView";

const mockListEntities = vi.mocked(listEntities);
const mockGetEntityDetail = vi.mocked(getEntityDetail);

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
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

describe("AtlasView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSigmaInstances.length = 0;
  });

  it("shows a distinct loading state while entities are in flight, then resolves to empty", async () => {
    let resolveEntities!: (value: import("../../lib/tauri").Entity[]) => void;
    mockListEntities.mockReturnValue(
      new Promise((resolve) => {
        resolveEntities = resolve;
      }),
    );

    renderWithQuery(<AtlasView />);

    expect(await screen.findByText("Loading your knowledge graph…")).toBeInTheDocument();
    expect(screen.queryByText("Your constellation will appear as knowledge grows")).not.toBeInTheDocument();
    expect(capturedSigmaInstances).toHaveLength(0);

    resolveEntities([]);

    expect(
      await screen.findByText("Your constellation will appear as knowledge grows"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading your knowledge graph…")).not.toBeInTheDocument();
    expect(capturedSigmaInstances).toHaveLength(0);
  });

  it("renders the empty state when there are no entities", async () => {
    mockListEntities.mockResolvedValue([]);

    renderWithQuery(<AtlasView />);

    expect(
      await screen.findByText("Your constellation will appear as knowledge grows"),
    ).toBeInTheDocument();
    expect(capturedSigmaInstances).toHaveLength(0);
  });

  it("shows an error panel with retry on query failure, distinct from empty, and retry recovers", async () => {
    mockListEntities.mockRejectedValueOnce(new Error("daemon unreachable"));

    renderWithQuery(<AtlasView />);

    expect(await screen.findByText("Couldn't load your knowledge graph.")).toBeInTheDocument();
    expect(screen.queryByText("Your constellation will appear as knowledge grows")).not.toBeInTheDocument();
    expect(capturedSigmaInstances).toHaveLength(0);

    const entities = [makeEntity({ id: "e1", name: "Alice" })];
    mockListEntities.mockResolvedValueOnce(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    screen.getByRole("button", { name: "Retry" }).click();

    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
  });

  it("mounts a sigma renderer once entities and details resolve, and tears it down on unmount", async () => {
    const entities = [makeEntity({ id: "e1", name: "Alice", entity_type: "person" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    const { unmount } = renderWithQuery(<AtlasView />);

    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
    const killSpy = vi.spyOn(capturedSigmaInstances[0], "kill");

    unmount();

    expect(killSpy).toHaveBeenCalledTimes(1);
  });

  it("fires onNodeClick with the sigma node id on clickNode", async () => {
    const entities = [makeEntity({ id: "e1", name: "Alice" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });
    const onNodeClick = vi.fn();

    renderWithQuery(<AtlasView onNodeClick={onNodeClick} />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));

    capturedSigmaInstances[0].handlers.get("clickNode")?.({ node: "e1" });

    expect(onNodeClick).toHaveBeenCalledWith("e1");
  });

  it("wires nodeReducer and edgeReducer functions into the sigma constructor settings", async () => {
    const entities = [makeEntity({ id: "e1", name: "Alice" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    renderWithQuery(<AtlasView />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));

    const { settings } = capturedSigmaInstances[0];
    expect(typeof settings.nodeReducer).toBe("function");
    expect(typeof settings.edgeReducer).toBe("function");
    // Must stay a no-op override: sigma's built-in hover renderer hardcodes a
    // #FFF label box that's unreadable under the dark theme's label ink.
    expect(typeof settings.defaultDrawNodeHover).toBe("function");
    expect(settings.defaultDrawNodeHover()).toBeUndefined();
  });

  it("wires the radial label drawer over the live graph and lowers sigma's edge-thickness floor", async () => {
    const entities = [makeEntity({ id: "e1", name: "Alice" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    renderWithQuery(<AtlasView />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));

    const { settings } = capturedSigmaInstances[0];
    // Edges are 1.5 CSS px — sigma's default floor (1.7) would bump them up.
    expect(settings.minEdgeThickness).toBe(1);

    // Drives the real drawRadialNodeLabel through the graph closure: the
    // drawer reads e1's graph position for the sector, so this throws if the
    // wiring doesn't reach the mounted graph.
    const ctx = {
      font: "",
      fillStyle: "",
      globalAlpha: 1,
      textAlign: "",
      textBaseline: "",
      fillText: vi.fn(),
    };
    settings.defaultDrawNodeLabel(
      ctx,
      { key: "e1", label: "Alice", size: 4, x: 10, y: 20 },
      { labelColor: { color: "#123456" } },
    );
    expect(ctx.fillText).toHaveBeenCalledWith("Alice", expect.any(Number), expect.any(Number));
    expect(ctx.font).toBe("12px -apple-system, sans-serif");
    expect(ctx.fillStyle).toBe("#123456");
  });

  it("renders the legend chips, connection sample, and count line over the graph", async () => {
    mockConnectedPair();

    renderWithQuery(<AtlasView />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));

    for (const label of ["Project", "Technology", "Organization", "Person", "Theme", "Connection"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Alice + Bob with one deduped relation between them.
    expect(screen.getByText("2 entities, 1 connection")).toBeInTheDocument();
  });

  it("refreshes on enterNode and again on leaveNode", async () => {
    const entities = [makeEntity({ id: "e1", name: "Alice" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    renderWithQuery(<AtlasView />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
    const instance = capturedSigmaInstances[0];
    const refreshSpy = vi.spyOn(instance, "refresh");

    instance.handlers.get("enterNode")?.({ node: "e1" });
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    instance.handlers.get("leaveNode")?.({});
    expect(refreshSpy).toHaveBeenCalledTimes(2);
  });

  it("locks hover while a drag is live — enter/leave neither repaint nor flip the cursor until release", async () => {
    mockConnectedPair();

    renderWithQuery(<AtlasView />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
    const instance = capturedSigmaInstances[0];
    const container = instance.container as HTMLElement;
    const mouseCaptor = instance.getMouseCaptor();

    instance.handlers.get("downNode")?.({ node: "e1" });
    expect(container.style.cursor).toBe("grabbing");

    const refreshSpy = vi.spyOn(instance, "refresh");
    instance.handlers.get("enterNode")?.({ node: "e2" });
    instance.handlers.get("leaveNode")?.({});
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(container.style.cursor).toBe("grabbing");

    mouseCaptor.handlers.get("mouseup")?.({});
    // Hover re-arms the moment the drag ends.
    instance.handlers.get("enterNode")?.({ node: "e2" });
    expect(container.style.cursor).toBe("pointer");
  });

  it("applies every wheel delta directly to the camera — no animated stepped zoom", async () => {
    mockConnectedPair();

    renderWithQuery(<AtlasView />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
    const instance = capturedSigmaInstances[0];
    const mouseCaptor = instance.getMouseCaptor();
    const preventSigmaDefault = vi.fn();

    // The mount zoom-out already called setState once; count from here.
    instance.camera.setState.mockClear();
    instance.camera.ratio = 1;
    mouseCaptor.handlers.get("wheel")?.({
      x: 100,
      y: 50,
      delta: 1,
      preventSigmaDefault,
      original: { deltaY: -120, deltaMode: 0, ctrlKey: false },
    });

    // Sigma's own eased-lurch handler must be suppressed...
    expect(preventSigmaDefault).toHaveBeenCalled();
    // ...and the camera set synchronously with d3-zoom's delta scale:
    // ratio 1 * 2^(-120 * 0.002) — zoomed toward the cursor.
    expect(instance.getViewportZoomedState).toHaveBeenCalledWith(
      { x: 100, y: 50 },
      Math.pow(2, -120 * 0.002),
    );
    expect(instance.camera.setState).toHaveBeenCalledWith({
      x: 100,
      y: 50,
      ratio: Math.pow(2, -120 * 0.002),
    });
  });

  it("suppresses onNodeClick when clickNode follows a moved drag", async () => {
    const entities = [makeEntity({ id: "e1", name: "Alice" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });
    const onNodeClick = vi.fn();

    renderWithQuery(<AtlasView onNodeClick={onNodeClick} />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
    const instance = capturedSigmaInstances[0];
    const mouseCaptor = instance.getMouseCaptor();

    instance.handlers.get("downNode")?.({ node: "e1" });
    mouseCaptor.handlers.get("mousemovebody")?.({
      x: 10,
      y: 10,
      preventSigmaDefault: () => {},
      original: { preventDefault: () => {}, stopPropagation: () => {} },
    });
    mouseCaptor.handlers.get("mouseup")?.({});
    instance.handlers.get("clickNode")?.({ node: "e1" });

    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it("still fires onNodeClick for a plain click with no prior drag", async () => {
    const entities = [makeEntity({ id: "e1", name: "Alice" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });
    const onNodeClick = vi.fn();

    renderWithQuery(<AtlasView onNodeClick={onNodeClick} />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));

    capturedSigmaInstances[0].handlers.get("clickNode")?.({ node: "e1" });

    expect(onNodeClick).toHaveBeenCalledWith("e1");
  });

  // A hub connected to one neighbor — enough to prove drag-follow moves the
  // neighbor, without pulling in the whole buildGraphModel relation-shape test
  // surface (that's model.test.ts's job).
  function mockConnectedPair() {
    const entities = [makeEntity({ id: "e1", name: "Alice" }), makeEntity({ id: "e2", name: "Bob" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockImplementation(async (id: string) => {
      if (id === "e1") {
        return {
          entity: entities[0],
          observations: [],
          relations: [
            {
              id: "rel-1",
              relation_type: "knows",
              direction: "outgoing" as const,
              entity_id: "e2",
              entity_name: "Bob",
              entity_type: "person",
              source_agent: null,
              created_at: Date.now(),
            },
          ],
        };
      }
      return { entity: entities[1], observations: [], relations: [] };
    });
    return entities;
  }

  // Same connected pair plus a third, unrelated entity — degree 0, so it
  // never joins the sim (see atlas.ts's createAtlasSimulation) and rides the
  // round-1 isolate ring instead.
  function mockConnectedPairWithIsolate() {
    const entities = [
      makeEntity({ id: "e1", name: "Alice" }),
      makeEntity({ id: "e2", name: "Bob" }),
      makeEntity({ id: "e3", name: "Isolate" }),
    ];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockImplementation(async (id: string) => {
      if (id === "e1") {
        return {
          entity: entities[0],
          observations: [],
          relations: [
            {
              id: "rel-1",
              relation_type: "knows",
              direction: "outgoing" as const,
              entity_id: "e2",
              entity_name: "Bob",
              entity_type: "person",
              source_agent: null,
              created_at: Date.now(),
            },
          ],
        };
      }
      return { entity: entities.find((e) => e.id === id)!, observations: [], relations: [] };
    });
    return entities;
  }

  const dragEvent = (x: number, y: number) => ({
    x,
    y,
    preventSigmaDefault: () => {},
    original: { preventDefault: () => {}, stopPropagation: () => {} },
  });

  it("zooms the fitted camera out to the fill-aware default density (60% fill, clamped [1.5, 3])", async () => {
    mockConnectedPair();

    renderWithQuery(<AtlasView />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
    const instance = capturedSigmaInstances[0];
    // Mock fit density 6 px/unit (graphToViewport scales by 6); target is
    // 0.6 * min(400, 600) / span 100 = 2.4 px/unit → ratio 6 / 2.4 = 2.5.
    expect(instance.camera.setState).toHaveBeenCalledWith({ ratio: 2.5 });
  });

  it("paints synchronously on every physics tick — the writeback drives sigma's refresh", async () => {
    mockConnectedPair();

    renderWithQuery(<AtlasView />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
    const instance = capturedSigmaInstances[0];
    const sim = (window as any).__ATLAS_SIM;

    const refreshSpy = vi.spyOn(instance, "refresh");
    sim.tick(1);
    // One frame late (sigma's own event-scheduled render) is the round-8
    // drag-latency bug — the writeback must paint in the same frame.
    expect(refreshSpy).toHaveBeenCalled();
  });

  it("moves a connected non-dragged node as the reheated sim ticks", async () => {
    mockConnectedPair();

    renderWithQuery(<AtlasView />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
    const instance = capturedSigmaInstances[0];
    const graph = instance.graph;
    const mouseCaptor = instance.getMouseCaptor();
    // d3-timer's automatic per-frame loop never fires on its own inside a
    // test — drive the DEV-only captured sim ref directly instead.
    // sim.tick() is synchronous and writes back to the graph (see atlas.ts's
    // createAtlasSimulation).
    const sim = (window as any).__ATLAS_SIM;
    const restartSpy = vi.spyOn(sim, "restart");

    const before = { x: graph.getNodeAttribute("e2", "x"), y: graph.getNodeAttribute("e2", "y") };

    instance.handlers.get("downNode")?.({ node: "e1" });

    // downNode pins the pressed node and reheats the sim: alpha JUMPS to 0.3
    // (not just alphaTarget's 3%/tick ramp from the settled 0 — that ramp is
    // the round-7 "drag feels laggy" bug).
    expect(restartSpy).toHaveBeenCalledTimes(1);
    expect(sim.alphaTarget()).toBeCloseTo(0.3);
    expect(sim.alpha()).toBeCloseTo(0.3);

    mouseCaptor.handlers.get("mousemovebody")?.(dragEvent(200, 200));
    sim.tick(30);

    const after = { x: graph.getNodeAttribute("e2", "x"), y: graph.getNodeAttribute("e2", "y") };
    expect(after).not.toEqual(before);
  });

  it("stops the sim (skipping the decay tail) on mouseup under prefers-reduced-motion, without gating the dragged node's own instant response", async () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true } as MediaQueryList);
    vi.stubGlobal("matchMedia", matchMediaMock);
    try {
      mockConnectedPair();

      renderWithQuery(<AtlasView />);
      await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
      const instance = capturedSigmaInstances[0];
      const graph = instance.graph;
      const mouseCaptor = instance.getMouseCaptor();
      const sim = (window as any).__ATLAS_SIM;
      const stopSpy = vi.spyOn(sim, "stop");

      const before = { x: graph.getNodeAttribute("e1", "x"), y: graph.getNodeAttribute("e1", "y") };

      instance.handlers.get("downNode")?.({ node: "e1" });
      mouseCaptor.handlers.get("mousemovebody")?.(dragEvent(200, 200));

      // Drag-follow is direct manipulation, not an animation — the dragged
      // node's own position updates instantly regardless of reduced motion.
      const afterDrag = { x: graph.getNodeAttribute("e1", "x"), y: graph.getNodeAttribute("e1", "y") };
      expect(afterDrag).not.toEqual(before);

      mouseCaptor.handlers.get("mouseup")?.({});

      expect(matchMediaMock).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
      expect(stopSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("places the isolate ring from the sim's SETTLED bbox, not a pre-settle one", async () => {
    mockConnectedPairWithIsolate();

    renderWithQuery(<AtlasView />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
    const graph = capturedSigmaInstances[0].graph;

    // This fails if placeIsolateRing ran BEFORE createAtlasSimulation's
    // settle: the isolate would be frozen at a ring radius derived from the
    // pre-settle bbox, which no longer matches the connected pair's actual
    // (post-settle) final bbox read here.
    const xs = ["e1", "e2"].map((id) => graph.getNodeAttribute(id, "x") as number);
    const ys = ["e1", "e2"].map((id) => graph.getNodeAttribute(id, "y") as number);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const expectedRadius =
      Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1) * 0.65;

    const dx = (graph.getNodeAttribute("e3", "x") as number) - cx;
    const dy = (graph.getNodeAttribute("e3", "y") as number) - cy;
    expect(Math.hypot(dx, dy)).toBeCloseTo(expectedRadius, 6);
  });

  it("mounts the cartography underlay canvas beneath sigma and removes it on unmount", async () => {
    mockConnectedPair();

    const { unmount } = renderWithQuery(<AtlasView />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));

    const container = capturedSigmaInstances[0].container as HTMLElement;
    const underlay = document.querySelector('canvas[data-testid="atlas-cartography"]');
    expect(underlay).toBeInTheDocument();
    // Appended BEFORE the sigma mock ran, so it stacks under sigma's canvases.
    expect(underlay!.parentElement).toBe(container);

    unmount();
    // Query the DETACHED container, not the document: React unmount removes
    // the whole subtree from the document either way, so a document-level
    // query passes even if the cleanup leaks the canvas (mutation-proven).
    expect(container.querySelector('canvas[data-testid="atlas-cartography"]')).toBeNull();
  });

  it("repaints the underlay on every sigma afterRender: dashed graticule rings from the live graph", async () => {
    mockConnectedPair();

    renderWithQuery(<AtlasView />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
    const instance = capturedSigmaInstances[0];

    const handler = instance.handlers.get("afterRender");
    expect(typeof handler).toBe("function");

    // jsdom's getContext("2d") is null (the mount-time paint no-ops on that);
    // hand the handler a recording ctx and re-fire it like a render would.
    const underlay = document.querySelector(
      'canvas[data-testid="atlas-cartography"]',
    ) as HTMLCanvasElement;
    const ctx = {
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
      lineJoin: "",
      lineCap: "",
      font: "",
      letterSpacing: "",
      textAlign: "",
      textBaseline: "",
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      setLineDash: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
    };
    underlay.getContext = vi.fn().mockReturnValue(ctx) as any;

    handler!({});

    // Sized to sigma's viewport and cleared before painting.
    expect(underlay.width).toBe(400);
    expect(underlay.height).toBe(600);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 400, 600);
    // The settled pair sits off-origin, so the graticule paints: 3 dashed
    // rings. (Two singleton communities → no hulls, no bridges — MIN_REGION_SIZE.)
    expect(ctx.setLineDash).toHaveBeenCalledWith([1, 7]);
    expect(ctx.arc).toHaveBeenCalledTimes(3);
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("drags an isolate by direct manipulation, without restarting the sim", async () => {
    mockConnectedPairWithIsolate();

    renderWithQuery(<AtlasView />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
    const instance = capturedSigmaInstances[0];
    const graph = instance.graph;
    const mouseCaptor = instance.getMouseCaptor();
    const sim = (window as any).__ATLAS_SIM;
    const restartSpy = vi.spyOn(sim, "restart");

    const before = { x: graph.getNodeAttribute("e3", "x"), y: graph.getNodeAttribute("e3", "y") };

    // Isolates aren't sim members — downNode's lookup misses, so there's
    // nothing to pin or reheat.
    instance.handlers.get("downNode")?.({ node: "e3" });
    expect(restartSpy).not.toHaveBeenCalled();

    mouseCaptor.handlers.get("mousemovebody")?.(dragEvent(500, 500));

    const after = { x: graph.getNodeAttribute("e3", "x"), y: graph.getNodeAttribute("e3", "y") };
    expect(after).not.toEqual(before);
  });
});

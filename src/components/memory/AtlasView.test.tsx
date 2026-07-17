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
    getBBox() {
      return { x: [0, 0], y: [0, 0] };
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

  const dragEvent = (x: number, y: number) => ({
    x,
    y,
    preventSigmaDefault: () => {},
    original: { preventDefault: () => {}, stopPropagation: () => {} },
  });

  // Deterministic requestAnimationFrame/cancelAnimationFrame stand-in — jsdom
  // has neither. Models real single-in-flight-handle cancel semantics (the
  // settle loop only ever has one frame scheduled at a time) rather than a
  // bare FIFO, so the "new downNode cancels it" assertion is meaningful.
  function stubRaf() {
    let nextHandle = 0;
    const scheduled = new Map<number, FrameRequestCallback>();
    const order: number[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const handle = ++nextHandle;
      scheduled.set(handle, cb);
      order.push(handle);
      return handle;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
      scheduled.delete(handle);
    });
    return {
      runFrame(): boolean {
        while (order.length > 0) {
          const handle = order.shift()!;
          const cb = scheduled.get(handle);
          if (cb) {
            scheduled.delete(handle);
            cb(0);
            return true;
          }
        }
        return false;
      },
      pendingCount: () => order.filter((h) => scheduled.has(h)).length,
    };
  }

  it("moves a connected non-dragged node when the dragged node is moved", async () => {
    mockConnectedPair();

    renderWithQuery(<AtlasView />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
    const instance = capturedSigmaInstances[0];
    const graph = instance.graph;
    const mouseCaptor = instance.getMouseCaptor();

    const before = { x: graph.getNodeAttribute("e2", "x"), y: graph.getNodeAttribute("e2", "y") };

    instance.handlers.get("downNode")?.({ node: "e1" });
    mouseCaptor.handlers.get("mousemovebody")?.(dragEvent(40, 40));

    const after = { x: graph.getNodeAttribute("e2", "x"), y: graph.getNodeAttribute("e2", "y") };
    expect(after).not.toEqual(before);
  });

  it("keeps stepping neighbor positions across settle frames after a moved drag, and a new downNode cancels it", async () => {
    const raf = stubRaf();
    try {
      mockConnectedPair();

      renderWithQuery(<AtlasView />);
      await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
      const instance = capturedSigmaInstances[0];
      const graph = instance.graph;
      const mouseCaptor = instance.getMouseCaptor();

      instance.handlers.get("downNode")?.({ node: "e1" });
      mouseCaptor.handlers.get("mousemovebody")?.(dragEvent(40, 40));
      mouseCaptor.handlers.get("mouseup")?.({});

      expect(raf.pendingCount()).toBe(1);
      const postMouseup = { x: graph.getNodeAttribute("e2", "x"), y: graph.getNodeAttribute("e2", "y") };

      for (let i = 0; i < 5; i += 1) raf.runFrame();
      const afterFrames = { x: graph.getNodeAttribute("e2", "x"), y: graph.getNodeAttribute("e2", "y") };
      expect(afterFrames).not.toEqual(postMouseup);
      expect(raf.pendingCount()).toBe(1); // still settling, next frame queued

      instance.handlers.get("downNode")?.({ node: "e2" });
      expect(raf.pendingCount()).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips the settle loop under prefers-reduced-motion, without gating drag-follow itself", async () => {
    const raf = stubRaf();
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true } as MediaQueryList);
    vi.stubGlobal("matchMedia", matchMediaMock);
    try {
      mockConnectedPair();

      renderWithQuery(<AtlasView />);
      await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
      const instance = capturedSigmaInstances[0];
      const graph = instance.graph;
      const mouseCaptor = instance.getMouseCaptor();

      const before = { x: graph.getNodeAttribute("e2", "x"), y: graph.getNodeAttribute("e2", "y") };

      instance.handlers.get("downNode")?.({ node: "e1" });
      mouseCaptor.handlers.get("mousemovebody")?.(dragEvent(40, 40));

      // Drag-follow is direct manipulation, not an animation — it must run
      // regardless of the reduced-motion preference.
      const afterDrag = { x: graph.getNodeAttribute("e2", "x"), y: graph.getNodeAttribute("e2", "y") };
      expect(afterDrag).not.toEqual(before);

      mouseCaptor.handlers.get("mouseup")?.({});

      expect(matchMediaMock).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
      expect(raf.pendingCount()).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from "vitest";
import type Graph from "graphology";
import type { ForceLink, SimulationLinkDatum } from "d3-force";
import type { GraphModel, GraphNode, GraphEdge } from "./model";
import type { GraphPalette } from "./palette";
import {
  buildAtlasGraph,
  runAtlasLayout,
  createAtlasSimulation,
  placeIsolateRing,
  isolateIds,
  hoverStateFor,
  nodeDisplay,
  edgeDisplay,
} from "./atlas";
import type { HoverState, AtlasSimNode } from "./atlas";

const PALETTE: GraphPalette = {
  project: "#111111",
  tool: "#222222",
  org: "#333333",
  person: "#444444",
  concept: "#555555",
  neutral: "#666666",
  edge: "#777777",
  edgeStrong: "#888888",
  label: "#999999",
};

function node(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: overrides.id ?? "n1",
    kind: "entity",
    name: overrides.name ?? "Node",
    entityType: overrides.entityType ?? "concept",
    confirmed: overrides.confirmed ?? true,
    degree: overrides.degree ?? 0,
    communityId: overrides.communityId ?? null,
    createdAt: overrides.createdAt ?? 100,
    updatedAt: overrides.updatedAt ?? 200,
  };
}

function edge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: overrides.id ?? "e1",
    source: overrides.source ?? "n1",
    target: overrides.target ?? "n2",
    type: overrides.type ?? "knows",
    confidence: overrides.confidence ?? null,
    createdAt: overrides.createdAt ?? 100,
  };
}

function makeModel(nodes: GraphNode[], edges: GraphEdge[] = []): GraphModel {
  return { nodes, edges, coverage: { relationsFetchedFor: nodes.length, totalEntities: nodes.length } };
}

describe("buildAtlasGraph", () => {
  it("carries every model node and edge into the graphology graph", () => {
    const model = makeModel(
      [node({ id: "a" }), node({ id: "b" }), node({ id: "c" })],
      [edge({ id: "e1", source: "a", target: "b" }), edge({ id: "e2", source: "b", target: "c" })],
    );
    const graph = buildAtlasGraph(model, PALETTE);
    expect(graph.order).toBe(3);
    expect(graph.size).toBe(2);
  });

  it("is deterministic: the same model produces identical node attributes and positions", () => {
    const model = makeModel(
      [node({ id: "a", degree: 3 }), node({ id: "b", degree: 1 })],
      [edge({ id: "e1", source: "a", target: "b" })],
    );
    const g1 = buildAtlasGraph(model, PALETTE);
    const g2 = buildAtlasGraph(model, PALETTE);
    expect(g1.getNodeAttributes("a")).toEqual(g2.getNodeAttributes("a"));
    expect(g1.getNodeAttributes("b")).toEqual(g2.getNodeAttributes("b"));
  });

  it("scales node size monotonically with degree", () => {
    const model = makeModel([
      node({ id: "a", degree: 0 }),
      node({ id: "b", degree: 1 }),
      node({ id: "c", degree: 4 }),
      node({ id: "d", degree: 9 }),
    ]);
    const graph = buildAtlasGraph(model, PALETTE);
    const sizes = ["a", "b", "c", "d"].map((id) => graph.getNodeAttribute(id, "size") as number);
    expect(sizes[0]).toBeLessThan(sizes[1]);
    expect(sizes[1]).toBeLessThan(sizes[2]);
    expect(sizes[2]).toBeLessThan(sizes[3]);
  });

  it("colors nodes by their entityType's palette slot", () => {
    const model = makeModel([
      node({ id: "p", entityType: "project" }),
      node({ id: "t", entityType: "technology" }),
      node({ id: "x", entityType: "place" }), // unknown type -> neutral
    ]);
    const graph = buildAtlasGraph(model, PALETTE);
    expect(graph.getNodeAttribute("p", "color")).toBe(PALETTE.project);
    expect(graph.getNodeAttribute("t", "color")).toBe(PALETTE.tool);
    expect(graph.getNodeAttribute("x", "color")).toBe(PALETTE.neutral);
  });

  it("colors edges with the palette's quiet edge tone, size 2 (CSS px — old graph's effective weight)", () => {
    const model = makeModel(
      [node({ id: "a" }), node({ id: "b" })],
      [edge({ id: "e1", source: "a", target: "b" })],
    );
    const graph = buildAtlasGraph(model, PALETTE);
    expect(graph.getEdgeAttribute("e1", "color")).toBe(PALETTE.edge);
    expect(graph.getEdgeAttribute("e1", "size")).toBe(2);
  });

  it("keeps distinct parallel relations between the same pair as distinct edges", () => {
    // GraphModel's parallel-edge policy (see model.ts) keeps these as two
    // separate edges — a non-multi graph would throw adding the second one.
    const model = makeModel(
      [node({ id: "a" }), node({ id: "b" })],
      [
        edge({ id: "e1", source: "a", target: "b", type: "founded" }),
        edge({ id: "e2", source: "a", target: "b", type: "mentors" }),
      ],
    );
    const graph = buildAtlasGraph(model, PALETTE);
    expect(graph.size).toBe(2);
  });

  it("seeds finite deterministic positions before any layout has run", () => {
    const model = makeModel([node({ id: "a" }), node({ id: "b" }), node({ id: "c" })]);
    const graph = buildAtlasGraph(model, PALETTE);
    for (const id of ["a", "b", "c"]) {
      expect(Number.isFinite(graph.getNodeAttribute(id, "x"))).toBe(true);
      expect(Number.isFinite(graph.getNodeAttribute(id, "y"))).toBe(true);
    }
  });
});

describe("runAtlasLayout", () => {
  it("leaves every node with finite coordinates after layout", () => {
    const model = makeModel(
      [node({ id: "a" }), node({ id: "b" }), node({ id: "c" }), node({ id: "d" })],
      [
        edge({ id: "e1", source: "a", target: "b" }),
        edge({ id: "e2", source: "b", target: "c" }),
        edge({ id: "e3", source: "c", target: "d" }),
      ],
    );
    const graph = buildAtlasGraph(model, PALETTE);
    runAtlasLayout(graph);
    graph.forEachNode((_id, attrs) => {
      expect(Number.isFinite(attrs.x)).toBe(true);
      expect(Number.isFinite(attrs.y)).toBe(true);
    });
  });

  it("is deterministic: laying out identically-built graphs lands on the same positions", () => {
    const model = makeModel(
      [node({ id: "a" }), node({ id: "b" }), node({ id: "c" })],
      [edge({ id: "e1", source: "a", target: "b" }), edge({ id: "e2", source: "b", target: "c" })],
    );
    const g1 = buildAtlasGraph(model, PALETTE);
    const g2 = buildAtlasGraph(model, PALETTE);
    runAtlasLayout(g1);
    runAtlasLayout(g2);
    for (const id of ["a", "b", "c"]) {
      expect(g1.getNodeAttribute(id, "x")).toBeCloseTo(g2.getNodeAttribute(id, "x") as number, 10);
      expect(g1.getNodeAttribute(id, "y")).toBeCloseTo(g2.getNodeAttribute(id, "y") as number, 10);
    }
  });
});

describe("placeIsolateRing", () => {
  it("parks degree-0 isolates on a ring outside the connected cluster's CURRENT bbox", () => {
    const model = makeModel(
      [node({ id: "a", degree: 1 }), node({ id: "b", degree: 1 }), node({ id: "iso1" }), node({ id: "iso2" })],
      [edge({ id: "e1", source: "a", target: "b" })],
    );
    const graph = buildAtlasGraph(model, PALETTE);
    // Move the connected pair AFTER building — proves the ring is computed
    // from the bbox at CALL time, not wherever buildAtlasGraph originally
    // seeded them (round 5: this runs after the sim settles, so the
    // connected cluster has moved by the time this is called).
    graph.setNodeAttribute("a", "x", 5);
    graph.setNodeAttribute("a", "y", 0);
    graph.setNodeAttribute("b", "x", -5);
    graph.setNodeAttribute("b", "y", 0);

    placeIsolateRing(graph);

    const xs = ["a", "b"].map((id) => graph.getNodeAttribute(id, "x") as number);
    const ys = ["a", "b"].map((id) => graph.getNodeAttribute(id, "y") as number);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    // The contract: isolates sit exactly on the deterministic ring at
    // 0.65 x the cluster's larger bbox dimension (> the 0.5 x half-extent,
    // so always outside the cluster) — not wherever FA2's gravity left them.
    const expectedRadius =
      Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1) * 0.65;
    for (const id of ["iso1", "iso2"]) {
      const dx = (graph.getNodeAttribute(id, "x") as number) - cx;
      const dy = (graph.getNodeAttribute(id, "y") as number) - cy;
      expect(Math.hypot(dx, dy)).toBeCloseTo(expectedRadius, 6);
    }
  });
});

describe("createAtlasSimulation", () => {
  function starGraph(): Graph {
    // Hub "h" with four spokes, laid out once so the spokes start near the hub.
    const model = makeModel(
      [node({ id: "h" }), node({ id: "s1" }), node({ id: "s2" }), node({ id: "s3" }), node({ id: "s4" })],
      [
        edge({ id: "e1", source: "h", target: "s1" }),
        edge({ id: "e2", source: "h", target: "s2" }),
        edge({ id: "e3", source: "h", target: "s3" }),
        edge({ id: "e4", source: "h", target: "s4" }),
      ],
    );
    const graph = buildAtlasGraph(model, PALETTE);
    runAtlasLayout(graph);
    return graph;
  }

  it("pulls a neighbor closer to a hub displaced via fx/fy", () => {
    const graph = starGraph();
    const sim = createAtlasSimulation(graph);
    const simNodes = sim.nodes();
    const hub = simNodes.find((n) => n.id === "h")!;
    const neighbor = simNodes.find((n) => n.id === "s1")!;

    const newHub = { x: hub.x! + 300, y: hub.y! + 300 };
    const distBefore = Math.hypot(neighbor.x! - newHub.x, neighbor.y! - newHub.y);

    hub.fx = newHub.x;
    hub.fy = newHub.y;
    sim.alpha(1);
    sim.tick(30);

    const distAfter = Math.hypot(neighbor.x! - newHub.x, neighbor.y! - newHub.y);
    expect(distAfter).toBeLessThan(distBefore);
  });

  it("excludes isolates from the simulation entirely — the ring-hold is structural, not fx/fy", () => {
    const model = makeModel(
      [node({ id: "a", degree: 1 }), node({ id: "b", degree: 1 }), node({ id: "iso" })],
      [edge({ id: "e1", source: "a", target: "b" })],
    );
    const graph = buildAtlasGraph(model, PALETTE);
    const sim = createAtlasSimulation(graph);
    expect(sim.nodes().some((n) => n.id === "iso")).toBe(false);
  });

  it("EQUILIBRIUM INVARIANT: settles to near-zero alpha at creation, and reheating without a drag barely moves the connected cluster", () => {
    const graph = starGraph();
    const sim = createAtlasSimulation(graph);

    expect(sim.alpha()).toBeLessThanOrEqual(0.01);

    const bboxDiagonal = () => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const n of sim.nodes()) {
        minX = Math.min(minX, n.x!);
        maxX = Math.max(maxX, n.x!);
        minY = Math.min(minY, n.y!);
        maxY = Math.max(maxY, n.y!);
      }
      return Math.hypot(maxX - minX, maxY - minY);
    };

    const before = bboxDiagonal();
    // Reheat WITHOUT touching fx/fy on anything — no drag in progress, so a
    // sim already at its own equilibrium should barely move.
    sim.alphaTarget(0);
    sim.alpha(0.3);
    sim.tick(60);
    const after = bboxDiagonal();

    expect(Math.abs(after - before) / before).toBeLessThan(0.03);
  });

  it("collapses parallel edges between the same pair to a single sim link", () => {
    const model = makeModel(
      [node({ id: "a" }), node({ id: "b" })],
      [
        edge({ id: "e1", source: "a", target: "b", type: "founded" }),
        edge({ id: "e2", source: "a", target: "b", type: "mentors" }),
      ],
    );
    const graph = buildAtlasGraph(model, PALETTE);
    const sim = createAtlasSimulation(graph);
    const linkForce = sim.force<ForceLink<AtlasSimNode, SimulationLinkDatum<AtlasSimNode>>>("link");
    expect(linkForce?.links()).toHaveLength(1);
  });

  it("syncs ticked positions back onto the graphology graph for connected nodes", () => {
    const graph = starGraph();
    const before = {
      x: graph.getNodeAttribute("s1", "x") as number,
      y: graph.getNodeAttribute("s1", "y") as number,
    };

    const sim = createAtlasSimulation(graph);
    sim.alpha(1);
    sim.tick(30);

    const after = {
      x: graph.getNodeAttribute("s1", "x") as number,
      y: graph.getNodeAttribute("s1", "y") as number,
    };
    expect(after).not.toEqual(before);
  });

  it("invokes onTick after every writeback — once for the settle batch, once per manual tick", () => {
    const graph = starGraph();
    const onTick = vi.fn();
    const sim = createAtlasSimulation(graph, onTick);
    // The settle runs as a single wrapped tick(220) call → one writeback.
    expect(onTick).toHaveBeenCalledTimes(1);
    sim.tick(1);
    expect(onTick).toHaveBeenCalledTimes(2);
  });
});

describe("full atlas pipeline", () => {
  it("is deterministic end to end: FA2 seed, sim settle, and ring placement land on identical positions", () => {
    const model = makeModel(
      [node({ id: "a" }), node({ id: "b" }), node({ id: "c" }), node({ id: "iso" })],
      [edge({ id: "e1", source: "a", target: "b" }), edge({ id: "e2", source: "b", target: "c" })],
    );

    function run(): Graph {
      const graph = buildAtlasGraph(model, PALETTE);
      runAtlasLayout(graph);
      createAtlasSimulation(graph);
      placeIsolateRing(graph);
      return graph;
    }

    const g1 = run();
    const g2 = run();
    for (const id of ["a", "b", "c", "iso"]) {
      expect(g1.getNodeAttribute(id, "x")).toBeCloseTo(g2.getNodeAttribute(id, "x") as number, 6);
      expect(g1.getNodeAttribute(id, "y")).toBeCloseTo(g2.getNodeAttribute(id, "y") as number, 6);
    }
  });
});

describe("isolateIds", () => {
  it("returns exactly the degree-0 node ids", () => {
    const model = makeModel(
      [node({ id: "a" }), node({ id: "b" }), node({ id: "iso1" }), node({ id: "iso2" })],
      [edge({ id: "e1", source: "a", target: "b" })],
    );
    const graph = buildAtlasGraph(model, PALETTE);
    expect(new Set(isolateIds(graph))).toEqual(new Set(["iso1", "iso2"]));
  });
});

describe("hoverStateFor", () => {
  it("returns the empty state when nothing is hovered", () => {
    const model = makeModel(
      [node({ id: "a" }), node({ id: "b" })],
      [edge({ id: "e1", source: "a", target: "b" })],
    );
    const graph = buildAtlasGraph(model, PALETTE);
    const state = hoverStateFor(graph, null);
    expect(state.hovered).toBeNull();
    expect(state.neighbors.size).toBe(0);
  });

  it("collects the exact neighbor set for a hovered node with edges", () => {
    const model = makeModel(
      [node({ id: "a" }), node({ id: "b" }), node({ id: "c" }), node({ id: "d" })],
      [edge({ id: "e1", source: "a", target: "b" }), edge({ id: "e2", source: "a", target: "c" })],
    );
    const graph = buildAtlasGraph(model, PALETTE);
    const state = hoverStateFor(graph, "a");
    expect(state.hovered).toBe("a");
    expect(state.neighbors).toEqual(new Set(["b", "c"]));
  });

  it("returns an empty neighbor set for an isolated node", () => {
    const model = makeModel([node({ id: "a" }), node({ id: "iso" })]);
    const graph = buildAtlasGraph(model, PALETTE);
    const state = hoverStateFor(graph, "iso");
    expect(state.neighbors.size).toBe(0);
  });
});

describe("nodeDisplay", () => {
  const attrs = { label: "Alice", color: "#123456", size: 8 };

  it("passes attrs through unchanged when nothing is hovered", () => {
    const state: HoverState = { hovered: null, neighbors: new Set() };
    expect(nodeDisplay(state, "a", attrs, PALETTE)).toEqual(attrs);
  });

  it("keeps the hovered node's own color, forces its label, and puts it on top", () => {
    const state: HoverState = { hovered: "a", neighbors: new Set(["b"]) };
    const result = nodeDisplay(state, "a", attrs, PALETTE);
    expect(result.color).toBe(attrs.color);
    expect(result.label).toBe(attrs.label);
    expect(result.forceLabel).toBe(true);
    expect(result.zIndex).toBe(2);
  });

  it("keeps a neighbor's own color and label, at zIndex 1", () => {
    const state: HoverState = { hovered: "a", neighbors: new Set(["b"]) };
    const result = nodeDisplay(state, "b", attrs, PALETTE);
    expect(result.color).toBe(attrs.color);
    expect(result.label).toBe(attrs.label);
    expect(result.forceLabel).toBeUndefined();
    expect(result.zIndex).toBe(1);
  });

  it("mutes and blanks everyone else, at zIndex 0", () => {
    const state: HoverState = { hovered: "a", neighbors: new Set(["b"]) };
    const result = nodeDisplay(state, "c", attrs, PALETTE);
    expect(result.color).toBe(PALETTE.edge);
    expect(result.label).toBe("");
    expect(result.zIndex).toBe(0);
  });
});

describe("edgeDisplay", () => {
  const attrs = { color: "#abcdef", size: 1 };

  it("passes attrs through unchanged when nothing is hovered", () => {
    const state: HoverState = { hovered: null, neighbors: new Set() };
    expect(edgeDisplay(state, "e1", "a", "b", attrs, PALETTE)).toEqual(attrs);
  });

  it("emphasizes an edge incident to the hovered node as source", () => {
    const state: HoverState = { hovered: "a", neighbors: new Set(["b"]) };
    const result = edgeDisplay(state, "e1", "a", "b", attrs, PALETTE);
    expect(result.color).toBe(PALETTE.edgeStrong);
    expect(result.zIndex).toBe(1);
    expect(result.hidden).toBeUndefined();
  });

  it("emphasizes an edge incident to the hovered node as target", () => {
    const state: HoverState = { hovered: "b", neighbors: new Set(["a"]) };
    const result = edgeDisplay(state, "e1", "a", "b", attrs, PALETTE);
    expect(result.color).toBe(PALETTE.edgeStrong);
    expect(result.zIndex).toBe(1);
  });

  it("hides a non-incident edge while hovering", () => {
    const state: HoverState = { hovered: "a", neighbors: new Set(["b"]) };
    const result = edgeDisplay(state, "e2", "b", "c", attrs, PALETTE);
    expect(result.hidden).toBe(true);
  });

  it("emphasizes both parallel edges between the hovered node and a neighbor", () => {
    const state: HoverState = { hovered: "a", neighbors: new Set(["b"]) };
    const r1 = edgeDisplay(state, "e1", "a", "b", attrs, PALETTE);
    const r2 = edgeDisplay(state, "e2", "a", "b", attrs, PALETTE);
    expect(r1.color).toBe(PALETTE.edgeStrong);
    expect(r2.color).toBe(PALETTE.edgeStrong);
  });
});

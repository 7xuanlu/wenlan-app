// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "vitest";
import type Graph from "graphology";
import type { GraphModel, GraphNode, GraphEdge } from "./model";
import type { GraphPalette } from "./palette";
import {
  buildAtlasGraph,
  runAtlasLayout,
  stepAtlasLayout,
  isolateIds,
  hoverStateFor,
  nodeDisplay,
  edgeDisplay,
} from "./atlas";
import type { HoverState } from "./atlas";

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

  it("colors edges with the palette's quiet edge tone, size 1", () => {
    const model = makeModel(
      [node({ id: "a" }), node({ id: "b" })],
      [edge({ id: "e1", source: "a", target: "b" })],
    );
    const graph = buildAtlasGraph(model, PALETTE);
    expect(graph.getEdgeAttribute("e1", "color")).toBe(PALETTE.edge);
    expect(graph.getEdgeAttribute("e1", "size")).toBe(1);
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

  it("parks degree-0 isolates on a ring outside the connected cluster", () => {
    const model = makeModel(
      [node({ id: "a", degree: 1 }), node({ id: "b", degree: 1 }), node({ id: "iso1" }), node({ id: "iso2" })],
      [edge({ id: "e1", source: "a", target: "b" })],
    );
    const graph = buildAtlasGraph(model, PALETTE);
    runAtlasLayout(graph);
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

describe("stepAtlasLayout", () => {
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

  it("pulls a distant displaced hub's neighbor closer", () => {
    const graph = starGraph();
    const hubX = graph.getNodeAttribute("h", "x") as number;
    const hubY = graph.getNodeAttribute("h", "y") as number;
    const newHub = { x: hubX + 50, y: hubY + 50 };

    const neighborBefore = {
      x: graph.getNodeAttribute("s1", "x") as number,
      y: graph.getNodeAttribute("s1", "y") as number,
    };
    graph.setNodeAttribute("h", "x", newHub.x);
    graph.setNodeAttribute("h", "y", newHub.y);
    const distBefore = Math.hypot(neighborBefore.x - newHub.x, neighborBefore.y - newHub.y);

    stepAtlasLayout(graph, { pinned: new Map([["h", newHub]]) });

    const distAfter = Math.hypot(
      (graph.getNodeAttribute("s1", "x") as number) - newHub.x,
      (graph.getNodeAttribute("s1", "y") as number) - newHub.y,
    );
    expect(distAfter).toBeLessThan(distBefore);
  });

  it("restores pinned entries exactly after the step", () => {
    const graph = starGraph();
    const pinned = new Map([
      ["h", { x: 12.5, y: -7.25 }],
      ["s2", { x: 3, y: 4 }],
    ]);
    stepAtlasLayout(graph, { pinned });
    expect(graph.getNodeAttribute("h", "x")).toBeCloseTo(12.5, 10);
    expect(graph.getNodeAttribute("h", "y")).toBeCloseTo(-7.25, 10);
    expect(graph.getNodeAttribute("s2", "x")).toBeCloseTo(3, 10);
    expect(graph.getNodeAttribute("s2", "y")).toBeCloseTo(4, 10);
  });

  it("is deterministic: identical graphs stepped identically land identical", () => {
    const g1 = starGraph();
    const g2 = starGraph();
    const pinned = new Map([["h", { x: 1, y: 1 }]]);
    stepAtlasLayout(g1, { pinned: new Map(pinned) });
    stepAtlasLayout(g2, { pinned: new Map(pinned) });
    for (const id of ["h", "s1", "s2", "s3", "s4"]) {
      expect(g1.getNodeAttribute(id, "x")).toBeCloseTo(g2.getNodeAttribute(id, "x") as number, 10);
      expect(g1.getNodeAttribute(id, "y")).toBeCloseTo(g2.getNodeAttribute(id, "y") as number, 10);
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

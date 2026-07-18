// SPDX-License-Identifier: AGPL-3.0-only
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { GraphModel } from "./model";
import { colorForEntityType, type GraphPalette } from "./palette";

const MIN_NODE_SIZE = 3;
const MAX_NODE_SIZE = 12;

// Sqrt-scaled so a 10x-degree hub isn't a 10x-radius node — keeps the
// busiest entity legible without swallowing the canvas.
function sizeForDegree(degree: number): number {
  return Math.min(MAX_NODE_SIZE, MIN_NODE_SIZE + Math.sqrt(degree) * 2);
}

/**
 * GraphModel -> a graphology instance sigma can render directly. Positions
 * seed on a deterministic circle (node array order), so the result is
 * reproducible without running a layout; runAtlasLayout refines it from
 * there. `multi: true` because GraphModel's parallel-edge policy keeps
 * distinct relations between the same pair as distinct edges (see model.ts)
 * — a simple graph would throw adding the second one.
 */
export function buildAtlasGraph(model: GraphModel, palette: GraphPalette): Graph {
  const graph = new Graph({ multi: true });
  const n = model.nodes.length;
  model.nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / Math.max(n, 1);
    graph.addNode(node.id, {
      label: node.name,
      size: sizeForDegree(node.degree),
      color: colorForEntityType(node.entityType, palette),
      entityType: node.entityType,
      x: Math.cos(angle),
      y: Math.sin(angle),
    });
  });

  // ponytail: parallel edges between the same pair draw fully overlapped —
  // a view decision (see model.ts's parallel-edge note), fine at round-1 scale.
  for (const edge of model.edges) {
    graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      // Rendered 1:1 in CSS px (AtlasView pins zoomToSizeRatioFunction to 1),
      // calibrated to the old canvas graph's ~2px effective stroke.
      size: 2,
      color: palette.edge,
    });
  }
  return graph;
}

/**
 * Force-directed refinement of the seeded circle, synchronous — fine at
 * today's top-20-cap scale.
 * ponytail: sync FA2, move to a graphology worker when the bulk relations
 * endpoint lands and node counts stop being top-20-capped.
 */
export function runAtlasLayout(graph: Graph): void {
  const iterations = Math.min(600, Math.max(100, graph.order * 6));
  forceAtlas2.assign(graph, { iterations, settings: forceAtlas2.inferSettings(graph) });
}

/**
 * Parks degree-0 isolates on a deterministic ring just outside the connected
 * cluster instead of wherever FA2's gravity-only diffusion (or the d3 sim's
 * settle) left them: quiet periphery, honest bbox. Computed from the graph's
 * CURRENT connected-node bbox at call time — round 5 calls this AFTER the
 * sim settles (see createAtlasSimulation) so the ring tracks the graph's
 * rest-state extent, not FA2's raw seed packing.
 */
export function placeIsolateRing(graph: Graph): void {
  const isolates = isolateIds(graph);
  const isolateSet = new Set(isolates);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  graph.forEachNode((id, attrs) => {
    if (isolateSet.has(id)) return;
    minX = Math.min(minX, attrs.x as number);
    maxX = Math.max(maxX, attrs.x as number);
    minY = Math.min(minY, attrs.y as number);
    maxY = Math.max(maxY, attrs.y as number);
  });
  // No isolates, or nothing BUT isolates (the seed circle is already fine).
  if (isolates.length === 0 || minX === Infinity) return;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const radius = Math.max(maxX - minX, maxY - minY, 1) * 0.65;
  isolates.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / isolates.length;
    graph.setNodeAttribute(id, "x", cx + radius * Math.cos(angle));
    graph.setNodeAttribute(id, "y", cy + radius * Math.sin(angle));
  });
}

/** Degree-0 node ids — the round-1 isolate ring that gravity would otherwise
 *  pull inward during a live layout step. */
export function isolateIds(graph: Graph): string[] {
  const isolates: string[] = [];
  graph.forEachNode((id) => {
    if (graph.degree(id) === 0) isolates.push(id);
  });
  return isolates;
}

export interface AtlasSimNode extends SimulationNodeDatum {
  id: string;
}

interface AtlasSimLink {
  source: string;
  target: string;
}

/** d3-force simulation over the live graphology graph — the interaction engine.
 *  Sim nodes are the CONNECTED subgraph only (degree > 0) — isolates hold
 *  their round-1 ring position structurally (see placeIsolateRing) and are
 *  never simulated. Matches the retired ConstellationMap feel: charge -40,
 *  forceCenter(0, 0), alphaDecay 0.03, velocityDecay 0.25, d3-default link
 *  force. Parallel edges collapse to one link per undirected pair (d3 sums
 *  pull per link; sigma still RENDERS every parallel edge). Settles
 *  synchronously to its own equilibrium before returning — a FA2 seed handed
 *  straight to a fresh sim explodes toward the sim's roomier rest state on
 *  first drag; settling here means the graph the caller paints is already at
 *  rest, and a drag only flexes it (see round 5 spec). Every tick writes sim
 *  x/y back into the graph (sigma auto-repaints on attr change). */
export function createAtlasSimulation(
  graph: Graph,
  onTick?: () => void,
): Simulation<AtlasSimNode, undefined> {
  const isolates = new Set(isolateIds(graph));
  const nodes: AtlasSimNode[] = [];
  graph.forEachNode((id, attrs) => {
    if (isolates.has(id)) return;
    nodes.push({ id, x: attrs.x as number, y: attrs.y as number });
  });

  const seenPairs = new Set<string>();
  const links: AtlasSimLink[] = [];
  graph.forEachEdge((_edge, _attrs, source, target) => {
    const pairKey = [source, target].sort().join("|");
    if (seenPairs.has(pairKey)) return;
    seenPairs.add(pairKey);
    links.push({ source, target });
  });

  const sim = forceSimulation(nodes)
    .force("link", forceLink<AtlasSimNode, AtlasSimLink>(links).id((d) => d.id))
    .force("charge", forceManyBody<AtlasSimNode>().strength(-40))
    .force("center", forceCenter(0, 0))
    .alphaDecay(0.03)
    .velocityDecay(0.25);

  // onTick runs after every position writeback so the caller can PAINT in
  // the same frame the physics stepped. Relying on sigma's graph-event
  // scheduled render instead paints every tick one frame late: d3's timer
  // and sigma's scheduler are separate rAF queues, and a render requested
  // mid-frame only runs on the next one — a constant extra frame of drag
  // latency (the old force-graph loop ticked and painted together).
  const writeBack = () => {
    for (const node of nodes) {
      if (node.fx != null && node.fy != null) continue;
      graph.setNodeAttribute(node.id, "x", node.x);
      graph.setNodeAttribute(node.id, "y", node.y);
    }
    onTick?.();
  };
  sim.on("tick", writeBack);

  // d3's own per-frame loop (driven by restart()) calls its internal tick
  // step directly, bypassing this method — wrapping it only affects manual
  // callers, which keeps sim.tick() synchronous AND graph-synced for tests
  // without double-writing during live, restart()-driven dragging.
  const rawTick = sim.tick.bind(sim);
  sim.tick = (iterations?: number) => {
    rawTick(iterations);
    writeBack();
    return sim;
  };

  // Settle to equilibrium synchronously before first paint (≈ full alpha
  // decay at 0.03) — see the doc comment above.
  sim.tick(220);
  sim.alpha(0);
  sim.stop();
  return sim;
}

export interface HoverState {
  hovered: string | null;
  neighbors: Set<string>;
}

/** Hovered node id plus its neighbor set, or the empty state when nothing is hovered. */
export function hoverStateFor(graph: Graph, hovered: string | null): HoverState {
  if (hovered === null) return { hovered: null, neighbors: new Set() };
  return { hovered, neighbors: new Set(graph.neighbors(hovered)) };
}

// sigma's own nodeReducer/edgeReducer types resolve `data` to graphology's
// permissive `Attributes` (`{[name: string]: any}`) for a default-generic
// Graph, and expect a return assignable to `Partial<NodeDisplayData>` /
// `Partial<EdgeDisplayData>` — neither of which this package exposes without
// pulling in graphology-types as a new direct dependency. `any` matches what
// sigma already passes through, so it typechecks both ways without one.

/**
 * Node display override for the hover reducer — pure so it's unit-testable
 * without a sigma renderer. Four cases, pinned by the round-2 spec: no-hover
 * passthrough, the hovered node itself, its neighbors, everyone else.
 */
export function nodeDisplay(
  state: HoverState,
  nodeId: string,
  attrs: Record<string, any>,
  palette: GraphPalette,
): Record<string, any> {
  if (state.hovered === null) return attrs;
  if (nodeId === state.hovered) return { ...attrs, forceLabel: true, zIndex: 2 };
  if (state.neighbors.has(nodeId)) return { ...attrs, zIndex: 1 };
  return { ...attrs, color: palette.edge, label: "", zIndex: 0 };
}

/**
 * Edge display override for the hover reducer — edges incident to the
 * hovered node get emphasized, everything else hides.
 */
export function edgeDisplay(
  state: HoverState,
  _edgeId: string,
  source: string,
  target: string,
  attrs: Record<string, any>,
  palette: GraphPalette,
): Record<string, any> {
  if (state.hovered === null) return attrs;
  if (source === state.hovered || target === state.hovered) {
    return { ...attrs, color: palette.edgeStrong, zIndex: 1 };
  }
  return { ...attrs, hidden: true };
}

// SPDX-License-Identifier: AGPL-3.0-only
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
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
      size: 1,
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

  // FA2 moves degree-0 nodes by gravity alone, so they linger near their
  // seed-circle positions while the connected cluster packs the middle —
  // and the camera then fits the stale circle's bbox, shoving the real graph
  // off-center. Park isolates on a deterministic ring just outside the
  // cluster instead: quiet periphery, honest bbox.
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

/** One (or a few) FA2 refinement steps over the live graph. `pinned` positions
 *  are restored after the step — the dragged node under the pointer, and the
 *  round-1 isolate ring (gravity would otherwise pull parked isolates inward). */
export function stepAtlasLayout(
  graph: Graph,
  opts: { iterations?: number; pinned?: ReadonlyMap<string, { x: number; y: number }> } = {},
): void {
  const { iterations = 1, pinned } = opts;
  forceAtlas2.assign(graph, { iterations, settings: forceAtlas2.inferSettings(graph) });
  pinned?.forEach((pos, id) => {
    graph.setNodeAttribute(id, "x", pos.x);
    graph.setNodeAttribute(id, "y", pos.y);
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

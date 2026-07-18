// SPDX-License-Identifier: AGPL-3.0-only
import type Graph from "graphology";
import type { GraphModel } from "./model";
import type { GraphPalette } from "./palette";

// The Atlas cartography layer (design-mockup artifact, screen 01 —
// "Cartography, not physics"): named community regions wrapped in translucent
// hulls, dashed orientation rings, and amber bridge edges between regions.
// Everything here is pure math / pure canvas drawing; AtlasView owns the
// underlay canvas and the sigma afterRender wiring.

/** Minimum members before a community earns a hull + name — a 1-2 node
 *  "region" is noise, not geography. */
const MIN_REGION_SIZE = 3;

/** Screen-px padding between a member node and its hull edge. */
const HULL_PAD = 26;

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Node id -> community id. Daemon truth wins: if ANY node carries a daemon
 * community_id, those ids are used verbatim and nodes without one become
 * singletons (never guessed into a group — the model.ts "absent stays null"
 * rule). Only when the daemon exposes nothing (wenlan-types 0.12.0 today)
 * does the client-side fallback run: steepest-ascent peak-climbing — every
 * node follows its highest-degree neighbor (strictly higher than its own
 * degree) upward until a local degree peak, and the peak is the community.
 * Deterministic (degree ties break on the smaller id), terminating (degree
 * strictly increases along a climb), and it can't leak across a hub–hub
 * bridge the way deterministic label propagation does: two equal-degree hubs
 * are each their own peak. ponytail: crude next to Louvain, but zero deps
 * and hub-shaped like this data; dies the day entities.community_id lands.
 */
export function communitiesFor(model: GraphModel): Map<string, number> {
  const fromDaemon = model.nodes.some((n) => n.communityId !== null);
  if (fromDaemon) {
    const result = new Map<string, number>();
    // Singletons start after the daemon's id range so they can never collide.
    let nextSingleton =
      Math.max(...model.nodes.map((n) => n.communityId ?? -1)) + 1;
    for (const node of model.nodes) {
      result.set(node.id, node.communityId ?? nextSingleton++);
    }
    return result;
  }

  // Distinct-neighbor adjacency: parallel edges and self-loops must not
  // inflate the degree that drives the climb.
  const adjacency = new Map<string, Set<string>>();
  for (const node of model.nodes) adjacency.set(node.id, new Set());
  for (const edge of model.edges) {
    if (edge.source === edge.target) continue;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }
  const degree = (id: string) => adjacency.get(id)?.size ?? 0;

  const stepUp = (id: string): string => {
    let best: string | null = null;
    for (const neighbor of adjacency.get(id) ?? []) {
      if (degree(neighbor) <= degree(id)) continue;
      if (
        best === null ||
        degree(neighbor) > degree(best) ||
        (degree(neighbor) === degree(best) && neighbor < best)
      ) {
        best = neighbor;
      }
    }
    return best ?? id;
  };

  const peakOf = new Map<string, string>();
  const climb = (id: string): string => {
    const cached = peakOf.get(id);
    if (cached !== undefined) return cached;
    const next = stepUp(id);
    const peak = next === id ? id : climb(next);
    peakOf.set(id, peak);
    return peak;
  };

  const peaks = [...new Set(model.nodes.map((n) => climb(n.id)))].sort();
  const peakIndex = new Map(peaks.map((peak, i) => [peak, i]));
  return new Map(model.nodes.map((n) => [n.id, peakIndex.get(peakOf.get(n.id)!)!]));
}

/**
 * Per-edge bridge test, sizes precomputed once. A bridge spans two DIFFERENT
 * communities that are both real regions (>= MIN_REGION_SIZE members) — an
 * edge poking out of a 2-node islet is not map furniture.
 */
export function bridgeEdgeTest(
  communities: Map<string, number>,
): (source: string, target: string) => boolean {
  const sizes = new Map<number, number>();
  for (const community of communities.values()) {
    sizes.set(community, (sizes.get(community) ?? 0) + 1);
  }
  return (source, target) => {
    const a = communities.get(source);
    const b = communities.get(target);
    return (
      a !== undefined &&
      b !== undefined &&
      a !== b &&
      (sizes.get(a) ?? 0) >= MIN_REGION_SIZE &&
      (sizes.get(b) ?? 0) >= MIN_REGION_SIZE
    );
  };
}

export interface Region {
  /** Convex hull of member GRAPH positions, counter-clockwise. */
  hull: { x: number; y: number }[];
  /** Highest-degree member's name — the region's label. */
  name: string;
  memberCount: number;
}

/**
 * Andrew's monotone chain convex hull. Returns the hull counter-clockwise
 * without repeating the first point; degenerate inputs (<3 points, collinear)
 * return what they can — the fat-stroke drawing below renders a 2-point hull
 * as a capsule, which is fine.
 */
export function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Regions worth naming: communities with >= MIN_REGION_SIZE members, hulled
 * over their CURRENT graph positions (so hulls flex live with a drag) and
 * named after their highest-degree member (degree ties break alphabetically,
 * then by id — deterministic). Sorted largest-first so the caller can give
 * the dominant region the bigger type.
 */
export function communityRegions(graph: Graph, communities: Map<string, number>): Region[] {
  const members = new Map<number, string[]>();
  for (const [id, community] of communities) {
    if (!graph.hasNode(id)) continue;
    pushInto(members, community, id);
  }
  const regions: Region[] = [];
  for (const ids of members.values()) {
    if (ids.length < MIN_REGION_SIZE) continue;
    let hubId = ids[0];
    for (const id of ids) {
      const d = graph.degree(id);
      const hubD = graph.degree(hubId);
      const name = graph.getNodeAttribute(id, "label") as string;
      const hubName = graph.getNodeAttribute(hubId, "label") as string;
      if (d > hubD || (d === hubD && (name < hubName || (name === hubName && id < hubId)))) {
        hubId = id;
      }
    }
    regions.push({
      hull: convexHull(
        ids.map((id) => ({
          x: graph.getNodeAttribute(id, "x") as number,
          y: graph.getNodeAttribute(id, "y") as number,
        })),
      ),
      name: graph.getNodeAttribute(hubId, "label") as string,
      memberCount: ids.length,
    });
  }
  return regions.sort((a, b) => b.memberCount - a.memberCount || (a.name < b.name ? -1 : 1));
}

/** The three dashed orientation rings: even steps out to just past the
 *  farthest node. Zero/negative extent -> no rings. */
export function graticuleRadii(maxNodeRadius: number): number[] {
  if (maxNodeRadius <= 0) return [];
  const outer = maxNodeRadius * 1.05;
  return [outer / 3, (outer * 2) / 3, outer];
}

export interface CartographyScene {
  regions: Region[];
  /** Graph-space distance of the farthest node from the origin (forceCenter
   *  pins the cluster there), for the graticule. */
  maxNodeRadius: number;
}

/** Everything drawCartography needs, computed once per paint from live state. */
export function cartographyScene(graph: Graph, communities: Map<string, number>): CartographyScene {
  let maxNodeRadius = 0;
  graph.forEachNode((_id, attrs) => {
    maxNodeRadius = Math.max(maxNodeRadius, Math.hypot(attrs.x as number, attrs.y as number));
  });
  return { regions: communityRegions(graph, communities), maxNodeRadius };
}

/**
 * Trace the hull expanded outward by `pad` px with rounded joins: each edge
 * shifted along its outward normal, consecutive edges connected by an arc of
 * radius `pad` around the shared vertex. One closed path -> ONE translucent
 * fill stays uniform (the earlier fat-stroke trick stacked stroke ink over
 * fill ink across the whole pad band, reading as a heavy donut instead of
 * the artifact's faint wash). Degenerate hulls (1 distinct point) become a
 * circle; 2 points fall out of the generic loop as a capsule.
 */
function traceExpandedHull(
  ctx: CanvasRenderingContext2D,
  hull: { x: number; y: number }[],
  pad: number,
): void {
  const pts = hull.filter(
    (p, i) =>
      i === 0 || Math.hypot(p.x - hull[i - 1].x, p.y - hull[i - 1].y) > 1e-6,
  );
  if (
    pts.length > 1 &&
    Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) <= 1e-6
  ) {
    pts.pop();
  }
  if (pts.length === 0) return;
  if (pts.length === 1) {
    ctx.moveTo(pts[0].x + pad, pts[0].y);
    ctx.arc(pts[0].x, pts[0].y, pad, 0, 2 * Math.PI);
    return;
  }

  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  // Outward normal per edge — "away from the centroid", which sidesteps
  // winding entirely (projection flips graph-space CCW to screen CW).
  const normals = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let nx = (b.y - a.y) / len;
    let ny = -(b.x - a.x) / len;
    if (nx * ((a.x + b.x) / 2 - cx) + ny * ((a.y + b.y) / 2 - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { nx, ny };
  });

  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const n = normals[i];
    const from = { x: a.x + n.nx * pad, y: a.y + n.ny * pad };
    if (i === 0) ctx.moveTo(from.x, from.y);
    else ctx.lineTo(from.x, from.y);
    ctx.lineTo(b.x + n.nx * pad, b.y + n.ny * pad);
    // Round the corner at b: sweep from this edge's normal to the next's.
    const next = normals[(i + 1) % pts.length];
    ctx.arc(
      b.x,
      b.y,
      pad,
      Math.atan2(n.ny, n.nx),
      Math.atan2(next.ny, next.nx),
      // Convex corner: the shorter way round. Cross product sign of the two
      // normals says which direction that is.
      n.nx * next.ny - n.ny * next.nx < 0,
    );
  });
}

/**
 * Paint the cartography underlay in VIEWPORT space. `project` maps graph
 * coords to viewport CSS px (AtlasView passes sigma's graphToViewport).
 * Draw order: graticule (deepest) -> hull blobs -> region names. Each hull
 * is the pad-expanded outline filled once with the translucent wash and
 * stroked once with a 1px border — the artifact's exact hull anatomy
 * (fill --kg-hull, stroke --kg-hull-border, stroke-width 1).
 */
export function drawCartography(
  ctx: CanvasRenderingContext2D,
  scene: CartographyScene,
  project: (pos: { x: number; y: number }) => { x: number; y: number },
  palette: GraphPalette,
): void {
  const center = project({ x: 0, y: 0 });
  const edge = project({ x: scene.maxNodeRadius, y: 0 });
  const pxPerUnit =
    scene.maxNodeRadius > 0
      ? Math.hypot(edge.x - center.x, edge.y - center.y) / scene.maxNodeRadius
      : 0;

  ctx.save();
  ctx.strokeStyle = palette.graticule;
  ctx.lineWidth = 1;
  ctx.setLineDash([1, 7]);
  for (const radius of graticuleRadii(scene.maxNodeRadius)) {
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * pxPerUnit, 0, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const region of scene.regions) {
    const screenHull = region.hull.map(project);
    if (screenHull.length === 0) continue;
    ctx.beginPath();
    traceExpandedHull(ctx, screenHull, HULL_PAD);
    ctx.closePath();
    ctx.fillStyle = palette.hull;
    ctx.fill();
    ctx.strokeStyle = palette.hullBorder;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Region names last, above their hulls: italic serif with wide tracking
  // (the artifact's .region style), centered above the hull's top edge. The
  // dominant region gets 16px, the rest 13px (.region.minor).
  scene.regions.forEach((region, i) => {
    const screenHull = region.hull.map(project);
    if (screenHull.length === 0) return;
    const cx = screenHull.reduce((s, p) => s + p.x, 0) / screenHull.length;
    const top = Math.min(...screenHull.map((p) => p.y));
    const size = i === 0 ? 16 : 13;
    ctx.font = `italic 500 ${size}px Fraunces, Georgia, serif`;
    // Wide tracking is part of the artifact spec; jsdom's mock ctx simply
    // ignores the property.
    ctx.letterSpacing = `${(size * 0.14).toFixed(1)}px`;
    ctx.fillStyle = palette.labelMuted;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(region.name, cx, top - HULL_PAD - 8);
    ctx.letterSpacing = "0px";
  });
  ctx.restore();
}

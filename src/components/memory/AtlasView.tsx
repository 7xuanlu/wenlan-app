// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Graph from "graphology";
import Sigma from "sigma";
import type { Simulation } from "d3-force";
import { listEntities, getEntityDetail } from "../../lib/tauri";
import type { Entity, EntityDetail } from "../../lib/tauri";
import { buildGraphModel } from "../../lib/graph/model";
import {
  buildAtlasGraph,
  runAtlasLayout,
  createAtlasSimulation,
  placeIsolateRing,
  hoverStateFor,
  nodeDisplay,
  edgeDisplay,
} from "../../lib/graph/atlas";
import type { HoverState, AtlasSimNode } from "../../lib/graph/atlas";
import { useGraphPalette, colorForEntityType } from "../../lib/graph/palette";
import type { GraphPalette } from "../../lib/graph/palette";

interface AtlasViewProps {
  onNodeClick?: (entityId: string) => void;
}

// jsdom has no matchMedia; treat its absence as "no preference" rather than
// throwing (see the mouseup wiring below, which is exercised by tests that
// don't stub it).
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * sigma-rendered whole-graph view. Consumes the same daemon queries and
 * GraphModel as ConstellationMap (see that file's query block) — the two
 * share a query cache and disagree only on renderer. ConstellationMap stays
 * the shipped view; this is Atlas round 1, preview-addressable only (no
 * Main.tsx wiring yet).
 */
export default function AtlasView({ onNodeClick }: AtlasViewProps) {
  const { t } = useTranslation();
  const palette = useGraphPalette();
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const simRef = useRef<Simulation<AtlasSimNode, undefined> | null>(null);
  // Reducer inputs, read from refs so hover/theme changes repaint without a
  // React re-render or a renderer rebuild (see the mount effect below).
  const hoverStateRef = useRef<HoverState>({ hovered: null, neighbors: new Set() });
  const paletteRef = useRef<GraphPalette>(palette);
  // Node-drag state: which node (if any) is being dragged, and whether the
  // pointer actually moved during the current press — the latter gates
  // clickNode so a drag-release doesn't also fire entity navigation.
  const draggedNodeRef = useRef<string | null>(null);
  const movedDuringPressRef = useRef(false);

  const {
    data: entities = [],
    isLoading: entitiesLoading,
    isError: entitiesError,
    refetch: refetchEntities,
  } = useQuery({
    queryKey: ["constellation-entities"],
    queryFn: () => listEntities(),
    refetchInterval: 120_000,
  });

  const top20Ids = useMemo(
    () => entities.slice(0, 20).map((e: Entity) => e.id),
    [entities],
  );

  const {
    data: details = [],
    isLoading: detailsLoading,
    isError: detailsError,
    refetch: refetchDetails,
  } = useQuery({
    queryKey: ["constellation-relations", top20Ids],
    queryFn: async () => {
      const settled = await Promise.allSettled(top20Ids.map((id) => getEntityDetail(id)));
      const succeeded = settled
        .filter((r): r is PromiseFulfilledResult<EntityDetail> => r.status === "fulfilled")
        .map((r) => r.value);
      // One flaky detail fetch shouldn't blank the whole graph — only a
      // total wipeout is a real outage worth the full error screen.
      if (succeeded.length === 0) {
        throw new Error("All entity detail fetches failed");
      }
      return succeeded;
    },
    enabled: top20Ids.length > 0,
    refetchInterval: 300_000,
    staleTime: 120_000,
  });

  const model = useMemo(() => buildGraphModel(entities, details), [entities, details]);

  // Mount/rebuild sigma whenever the model changes. `palette` is read here
  // (fresh at build time) but deliberately not a dependency — a theme flip
  // recolors the existing graph in place (below) instead of tearing down and
  // remounting the whole renderer.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || model.nodes.length === 0) return;

    const graph = buildAtlasGraph(model, palette);
    runAtlasLayout(graph);
    graphRef.current = graph;

    const sim = createAtlasSimulation(graph);
    simRef.current = sim;
    if (import.meta.env.DEV) {
      // Preview/debug handle only — stripped from prod builds.
      (window as unknown as Record<string, unknown>).__ATLAS_SIM = sim;
    }
    placeIsolateRing(graph);

    const renderer = new Sigma(graph, container, {
      labelRenderedSizeThreshold: 6,
      // Default camera fit maps the graph bbox edge-to-edge on the tighter
      // axis, half-clipping the extreme nodes; give the map a margin.
      stagePadding: 40,
      // Sigma's default label ink is black regardless of theme; pass the
      // resolved text token instead (updated on theme flip below).
      labelColor: { color: palette.label },
      // Off by default in sigma — without it, the zIndex values nodeDisplay/
      // edgeDisplay return are computed but never affect paint order.
      zIndex: true,
      // Sigma's default hover renderer (drawDiscNodeHover) paints a hardcoded
      // #FFF label box — unreadable under the dark theme's light label ink.
      // The hovered label already renders theme-correct on the labels layer
      // (nodeDisplay forces it; renderLabels doesn't skip the hovered node),
      // so the box is pure loss. No-op it.
      defaultDrawNodeHover: () => {},
      nodeReducer: (node, attrs) => nodeDisplay(hoverStateRef.current, node, attrs, paletteRef.current),
      edgeReducer: (edge, attrs) => {
        const [source, target] = graph.extremities(edge);
        return edgeDisplay(hoverStateRef.current, edge, source, target, attrs, paletteRef.current);
      },
    });
    sigmaRef.current = renderer;
    if (import.meta.env.DEV) {
      // Preview/debug handle only — stripped from prod builds.
      (window as unknown as Record<string, unknown>).__ATLAS_SIGMA = renderer;
    }
    renderer.on("clickNode", ({ node }) => {
      // A moved drag must not also navigate on release.
      if (movedDuringPressRef.current) return;
      onNodeClick?.(node);
    });
    renderer.on("enterNode", ({ node }) => {
      hoverStateRef.current = hoverStateFor(graph, node);
      container.style.cursor = "pointer";
      renderer.refresh();
    });
    renderer.on("leaveNode", () => {
      hoverStateRef.current = hoverStateFor(graph, null);
      container.style.cursor = "default";
      renderer.refresh();
    });

    // Node drag — sigma v3's mouse-manipulation pattern (see mouse.d.ts /
    // sigma.esm.js MouseCaptor): downNode starts it, the captor's own
    // mousemovebody/mouseup/mousedown carry the rest. Physics now come from
    // the d3-force simulation (see atlas.ts's createAtlasSimulation) instead
    // of a stepped FA2 loop — downNode pins the pressed node and reheats the
    // sim; mousemovebody drags that pin along with the pointer; mouseup
    // releases it and lets alpha decay naturally (or stops outright under
    // reduced motion).
    renderer.on("downNode", ({ node }) => {
      draggedNodeRef.current = node;
      movedDuringPressRef.current = false;
      graph.setNodeAttribute(node, "highlighted", true);
      container.style.cursor = "grabbing";
      const simNode = sim.nodes().find((n) => n.id === node);
      // Isolates aren't sim members (see createAtlasSimulation) — an isolate
      // drag is pure direct manipulation via mousemovebody's graphology
      // writes, so there's nothing here to pin or reheat.
      if (simNode) {
        simNode.fx = simNode.x;
        simNode.fy = simNode.y;
        sim.alphaTarget(0.3).restart();
      }
    });
    const mouseCaptor = renderer.getMouseCaptor();
    mouseCaptor.on("mousedown", () => {
      // Freeze the camera frame so dragging a boundary node doesn't re-fit it.
      if (!renderer.getCustomBBox()) renderer.setCustomBBox(renderer.getBBox());
    });
    mouseCaptor.on("mousemovebody", (e) => {
      const draggedNode = draggedNodeRef.current;
      if (!draggedNode) return;
      movedDuringPressRef.current = true;
      const pos = renderer.viewportToGraph(e);
      graph.setNodeAttribute(draggedNode, "x", pos.x);
      graph.setNodeAttribute(draggedNode, "y", pos.y);
      // Instant response between ticks — the dragged node's own position
      // isn't waiting on the next sim tick; its neighbors flow toward this
      // pin as the sim (reheated on downNode) keeps ticking.
      const simNode = sim.nodes().find((n) => n.id === draggedNode);
      if (simNode) {
        simNode.fx = pos.x;
        simNode.fy = pos.y;
      }
      // Sigma's own click suppression (draggedEvents vs. draggedEventsTolerance)
      // never sees this drag — preventSigmaDefault short-circuits handleMove
      // before that counter increments — so movedDuringPressRef above is what
      // actually guards clickNode.
      e.preventSigmaDefault();
      e.original.preventDefault();
      e.original.stopPropagation();
    });
    mouseCaptor.on("mouseup", () => {
      const draggedNode = draggedNodeRef.current;
      if (draggedNode) {
        graph.setNodeAttribute(draggedNode, "highlighted", false);
        const simNode = sim.nodes().find((n) => n.id === draggedNode);
        if (simNode) {
          simNode.fx = null;
          simNode.fy = null;
        }
        draggedNodeRef.current = null;
      }
      container.style.cursor = hoverStateRef.current.hovered ? "pointer" : "default";
      // Natural decay is the inertia tail; reduced motion skips it outright.
      if (prefersReducedMotion()) sim.stop();
      else sim.alphaTarget(0);
    });

    return () => {
      sim.stop();
      simRef.current = null;
      sigmaRef.current = null;
      graphRef.current = null;
      renderer.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // Theme flip: recolor the live graph and repaint — no remount. Also keeps
  // paletteRef current so nodeReducer/edgeReducer (read at paint time) see
  // the new theme without the renderer being rebuilt.
  useEffect(() => {
    paletteRef.current = palette;
    const graph = graphRef.current;
    const renderer = sigmaRef.current;
    if (!graph || !renderer) return;
    graph.updateEachNodeAttributes((_id, attrs) => ({
      ...attrs,
      color: colorForEntityType(attrs.entityType, palette),
    }));
    graph.updateEachEdgeAttributes((_id, attrs) => ({ ...attrs, color: palette.edge }));
    renderer.setSetting("labelColor", { color: palette.label });
    renderer.refresh();
  }, [palette]);

  const statusStyle = {
    height: "100%",
    width: "100%",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    background: "var(--mem-surface)",
    fontFamily: "var(--mem-font-body)",
  };

  // Honest states: a dead daemon must never look like an empty graph.
  if (entitiesError || detailsError) {
    return (
      <div data-testid="atlas-view" style={statusStyle}>
        <p className="entity-empty" style={{ color: "var(--mem-status-danger-text)" }}>
          {t("constellationMap.loadError")}
        </p>
        <button
          type="button"
          className="memory-detail-text-button"
          onClick={() => {
            refetchEntities();
            refetchDetails();
          }}
        >
          {t("constellationMap.retry")}
        </button>
      </div>
    );
  }

  if (entitiesLoading || detailsLoading) {
    return (
      <div data-testid="atlas-view" style={statusStyle}>
        <span className="entity-empty">{t("constellationMap.loading")}</span>
      </div>
    );
  }

  if (entities.length === 0) {
    return (
      <div data-testid="atlas-view" style={statusStyle}>
        <span className="entity-empty">{t("constellationMap.empty")}</span>
      </div>
    );
  }

  return <div ref={containerRef} data-testid="atlas-view" style={{ height: "100%", width: "100%" }} />;
}

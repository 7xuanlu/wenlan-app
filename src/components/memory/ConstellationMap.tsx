// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import ForceGraph2D from "react-force-graph-2d";
import { listEntities, getEntityDetail, listMemoriesRich, listPages } from "../../lib/tauri";
import type { Entity, EntityDetail } from "../../lib/tauri";
import { buildGraphModel } from "../../lib/graph/model";
import { useGraphPalette, colorForEntityType } from "../../lib/graph/palette";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ConstellationMapProps {
  onNodeClick?: (entityId: string) => void;
}

interface GraphNode {
  id: string;
  name: string;
  entityType: string;
  stability: string;
  connectionCount: number;
  isMemory?: boolean;
  isDistilled?: boolean;
  isPage?: boolean;
}

interface GraphLink {
  source: string;
  target: string;
}

// Legend order matches the validated 5-slot palette (project/tool/org/person/
// concept); place, event, and unknown types fold to neutral and get no swatch.
// concept: entity_type is labeled "Theme" here to match the product's
// rebranded copy, not the raw wire vocabulary word.
const LEGEND_ITEMS: { label: string; key: string }[] = [
  { label: "Project", key: "project" },
  { label: "Technology", key: "technology" },
  { label: "Organization", key: "organization" },
  { label: "Person", key: "person" },
  { label: "Theme", key: "concept" },
];

function nodeRadius(stability: string, connectionCount: number): number {
  const base = stability === "confirmed" ? 4 : stability === "learned" ? 3.5 : 3;
  return Math.min(8, Math.max(3, base + connectionCount * 0.5));
}

// Page nodes render as a fixed-size square (not degree-scaled like entities).
const PAGE_HALF_SIDE = 5.5; // ~11px side at base scale
const PAGE_CORNER_RADIUS = 2.5;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ConstellationMap({ onNodeClick }: ConstellationMapProps) {
  const { t } = useTranslation();
  const palette = useGraphPalette();
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 400, height: 600 });
  const [showMemories, setShowMemories] = useState(() => localStorage.getItem("constellation-show-memories") === "true");
  const [showPages, setShowPages] = useState(() => localStorage.getItem("constellation-show-pages") === "true");
  const [showLabels, setShowLabels] = useState(() => localStorage.getItem("constellation-show-labels") !== "false");

  // Responsive sizing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
        // Re-zoom after dimension change settles (ForceGraph2D resets zoom on resize).
        setTimeout(() => {
          fgRef.current?.zoomToFit?.(0, -40);
        }, 50);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fetch entities
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

  // Fetch relations for top 20 entities
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
      // One flaky detail fetch shouldn't blank the whole graph — the coverage
      // chip already communicates "fetched for fewer than exist". Only a
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

  // Fetch memories when toggle is on
  const { data: memories = [] } = useQuery({
    queryKey: ["constellation-memories"],
    queryFn: () => listMemoriesRich(undefined, undefined, undefined, 200),
    enabled: showMemories,
    refetchInterval: 120_000,
  });

  // Fetch pages when toggle is on
  const { data: pages = [] } = useQuery({
    queryKey: ["constellation-pages"],
    queryFn: () => listPages(undefined, undefined, 200),
    enabled: showPages,
    refetchInterval: 120_000,
  });

  // GraphModel folds entities + fetched details into deduped, direction-
  // normalized nodes/edges once; the memo below only adapts that shape into
  // what react-force-graph expects and appends memory nodes.
  const model = useMemo(() => buildGraphModel(entities, details), [entities, details]);

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = model.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      entityType: n.entityType,
      // null (unknown, e.g. a synthesized neighbor) buckets with false — same
      // visual "new" stability — but stays an explicit comparison, not a
      // silent truthy coercion of null.
      stability: n.confirmed === true ? "confirmed" : "new",
      connectionCount: n.degree,
      isMemory: false,
    }));

    // The canvas draws undirected lines and d3-force sums pull per link, so
    // stacked parallel relations between the same pair would overdraw and
    // double the sim's link force — collapse to one line per undirected pair,
    // keeping the first. GraphModel intentionally keeps every relation as a
    // distinct edge (see model.ts's parallel-edge policy); collapsing here is
    // this view's decision, matching pre-rewrite behavior.
    const seenPairs = new Set<string>();
    const links: GraphLink[] = [];
    for (const e of model.edges) {
      const pairKey = [e.source, e.target].sort().join("|");
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      links.push({ source: e.source, target: e.target });
    }

    // Add memory nodes when toggle is on. addedMemIds is tracked outside the
    // toggle check because the page loop below needs to know which memory
    // nodes actually made it onto the canvas (regardless of showMemories).
    const addedMemIds = new Set<string>();
    if (showMemories && memories.length > 0) {
      const entityIds = new Set(entities.map((e: Entity) => e.id));
      // Build name→id map for client-side matching (entity_id is rarely set)
      const entityByName = new Map<string, string>();
      for (const e of entities) {
        entityByName.set(e.name.toLowerCase(), e.id);
      }

      for (const mem of memories) {
        // Try entity_id first (most precise)
        let linkedEntityId = mem.entity_id && entityIds.has(mem.entity_id) ? mem.entity_id : null;

        // Fallback: match entity name in memory title or domain
        if (!linkedEntityId) {
          const titleLower = (mem.title || "").toLowerCase();
          const domainLower = (mem.domain || "").toLowerCase();
          for (const [eName, eId] of entityByName) {
            if (eName.length >= 3 && (titleLower.includes(eName) || domainLower === eName)) {
              linkedEntityId = eId;
              break;
            }
          }
        }

        if (linkedEntityId && !addedMemIds.has(mem.source_id)) {
          addedMemIds.add(mem.source_id);
          const memId = `mem:${mem.source_id}`;
          nodes.push({
            id: memId,
            name: mem.title || "",
            entityType: mem.memory_type ?? "fact",
            stability: mem.stability ?? (mem.confirmed ? "confirmed" : "new"),
            connectionCount: 0,
            isMemory: true,
            isDistilled: mem.is_recap === true,
          });
          links.push({ source: memId, target: linkedEntityId });
        }
      }
    }

    // Add page nodes when toggle is on — appended AFTER memories so
    // page→memory citation links can check which memory nodes are present.
    if (showPages && pages.length > 0) {
      const entityIds = new Set(entities.map((e: Entity) => e.id));
      const entityByName = new Map<string, string>();
      for (const e of entities) {
        entityByName.set(e.name.toLowerCase(), e.id);
      }

      for (const page of pages) {
        if (page.status === "archived") continue;

        let linkedEntityId = page.entity_id && entityIds.has(page.entity_id) ? page.entity_id : null;

        // Fallback: match entity name in page title or domain
        if (!linkedEntityId) {
          const titleLower = (page.title || "").toLowerCase();
          const domainLower = (page.domain || "").toLowerCase();
          for (const [eName, eId] of entityByName) {
            if (eName.length >= 3 && (titleLower.includes(eName) || domainLower === eName)) {
              linkedEntityId = eId;
              break;
            }
          }
        }

        const citedMemIds = (page.source_memory_ids ?? []).filter((id) => addedMemIds.has(id));

        // No floating orphans — same rule as memories.
        if (!linkedEntityId && citedMemIds.length === 0) continue;

        const pageNodeId = `page:${page.id}`;
        nodes.push({
          id: pageNodeId,
          name: page.title,
          entityType: "page",
          stability: "new",
          connectionCount: 0,
          isPage: true,
        });
        if (linkedEntityId) links.push({ source: pageNodeId, target: linkedEntityId });
        for (const id of citedMemIds) links.push({ source: pageNodeId, target: `mem:${id}` });
      }
    }

    return { nodes, links };
  }, [model, entities, showMemories, memories, showPages, pages]);

  // Stabilize graphData reference — only update when node/link IDs actually change
  const prevGraphRef = useRef(graphData);
  const stableGraphData = useMemo(() => {
    const prev = prevGraphRef.current;
    const sameNodes = prev.nodes.length === graphData.nodes.length
      && prev.nodes.every((n, i) => n.id === graphData.nodes[i]?.id);
    const sameLinks = prev.links.length === graphData.links.length
      && prev.links.every((l, i) => {
        const gl = graphData.links[i];
        const lSrc = typeof l.source === "object" ? (l.source as any).id : l.source;
        const glSrc = typeof gl?.source === "object" ? (gl.source as any).id : gl?.source;
        const lTgt = typeof l.target === "object" ? (l.target as any).id : l.target;
        const glTgt = typeof gl?.target === "object" ? (gl.target as any).id : gl?.target;
        return lSrc === glSrc && lTgt === glTgt;
      });
    if (sameNodes && sameLinks) {
      // Topology is unchanged, so keep the same node OBJECT REFERENCES — d3
      // stashes simulation position (x/y/vx/vy) directly on them, and
      // swapping in fresh objects would re-heat the sim. But a refetch can
      // still carry updated display fields (name/entityType/stability/
      // connectionCount) for the same ids, so merge those onto the retained
      // references rather than silently keeping stale display data.
      prev.nodes.forEach((n, i) => {
        const { x: _x, y: _y, vx: _vx, vy: _vy, ...updated } = graphData.nodes[i] as any;
        Object.assign(n, updated);
      });
      return prev;
    }
    prevGraphRef.current = graphData;
    return graphData;
  }, [graphData]);

  // Stats
  const entityCount = entities.length;
  const connectionCount = graphData.links.length;
  const cornerLabel = useMemo(() => {
    if (entityCount === 0) return "";
    const parts = [`${entityCount} ${entityCount === 1 ? "entity" : "entities"}`];
    if (connectionCount > 0) {
      parts.push(`${connectionCount} ${connectionCount === 1 ? "connection" : "connections"}`);
    }
    return parts.join(", ");
  }, [entityCount, connectionCount]);

  // Helper: get node radius
  const getNodeRadius = useCallback((node: any) => {
    if (node.isMemory) return node.stability === "confirmed" || node.isDistilled ? 4.5 : 3;
    if (node.isPage) return PAGE_HALF_SIDE;
    return nodeRadius(node.stability ?? "new", node.connectionCount);
  }, []);

  // Identify the user's entity — the person node with the most connections.
  // Matches IdentityCard's "first person" convention but picks the most-central
  // person instead of `[0]`, which avoids the "first recently-updated contact
  // isn't you" failure mode when the graph has many person entities.
  const userNodeId = useMemo(() => {
    const persons = graphData.nodes
      .filter((n) => !n.isMemory && n.entityType === "person")
      .sort((a, b) => (b.connectionCount ?? 0) - (a.connectionCount ?? 0));
    return persons[0]?.id ?? null;
  }, [graphData.nodes]);

  // Top-20 hubs by connection count (excluding memories — those are embers,
  // not named entities) — the persistent-label set.
  const topHubIds = useMemo(() => {
    const sorted = [...graphData.nodes]
      .filter((n) => !n.isMemory)
      .sort((a, b) => (b.connectionCount ?? 0) - (a.connectionCount ?? 0));
    return sorted.slice(0, 20).map((n) => n.id);
  }, [graphData.nodes]);

  // Which nodes get persistent text labels: the top-20 hubs plus the user node.
  const labeledNodeIds = useMemo(() => {
    const ids = new Set<string>(topHubIds);
    if (userNodeId) ids.add(userNodeId);
    return ids;
  }, [topHubIds, userNodeId]);

  // Configure the d3 charge force via ref (not available as JSX props in types)
  useEffect(() => {
    if (!fgRef.current) return;
    fgRef.current.d3Force("charge")?.strength(-40);
  }, [stableGraphData]);

  // Text token, not a slot color (labels never wear series color) — hoisted
  // out of paintNode so canvas frames don't pay a style recalc per labeled
  // node; palette's identity changes on theme flip, so this re-reads then.
  const labelColor = useMemo(
    () =>
      getComputedStyle(document.documentElement).getPropertyValue("--mem-text-tertiary").trim() ||
      "#6a6a8a",
    [palette],
  );

  // Custom node rendering. `globalScale` is the current zoom factor from
  // react-force-graph — used to keep label size screen-constant so text
  // doesn't balloon when zoomed in or shrink to invisible when zoomed out.
  // Colors come from `palette` (React state, re-read on theme flip) — never
  // read a theme token inside this callback.
  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    // Memory nodes: neutral-slot embers
    if (node.isMemory) {
      const isStrong = node.stability === "confirmed" || node.isDistilled;
      const isLearned = node.stability === "learned";
      const r = isStrong ? 4.5 : 3;

      if (isStrong) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
        ctx.fillStyle = palette.neutral;
        ctx.globalAlpha = 0.12;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = palette.neutral;
      ctx.globalAlpha = isStrong ? 0.8 : isLearned ? 0.55 : 0.3;
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }

    // Page nodes: fixed-size rounded square, neutral-slot color
    if (node.isPage) {
      const side = PAGE_HALF_SIDE * 2;
      ctx.beginPath();
      ctx.roundRect(node.x - PAGE_HALF_SIDE, node.y - PAGE_HALF_SIDE, side, side, PAGE_CORNER_RADIUS);
      ctx.fillStyle = palette.neutral;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1;

      if (showLabels && labeledNodeIds.has(node.id)) {
        const screenFontPx = 12;
        const screenPadPx = 8;
        const fontSize = screenFontPx / globalScale;
        const pad = PAGE_HALF_SIDE + screenPadPx / globalScale;

        const angle = Math.atan2(node.y, node.x);
        const sector = Math.round((angle + Math.PI) / (Math.PI / 2)) % 4;

        ctx.font = `${fontSize}px -apple-system, sans-serif`;
        ctx.fillStyle = labelColor;
        ctx.globalAlpha = 0.85;

        if (sector === 0 || sector === 2) {
          const isRight = sector === 0;
          ctx.textAlign = isRight ? "left" : "right";
          ctx.textBaseline = "middle";
          ctx.fillText(node.name, node.x + (isRight ? pad : -pad), node.y);
        } else {
          const isBelow = sector === 1;
          ctx.textAlign = "center";
          ctx.textBaseline = isBelow ? "top" : "bottom";
          ctx.fillText(node.name, node.x, node.y + (isBelow ? pad : -pad));
        }
        ctx.globalAlpha = 1;
      }
      return;
    }

    const r = nodeRadius(node.stability ?? "new", node.connectionCount);
    const color = colorForEntityType(node.entityType, palette);

    // Subtle glow for confirmed
    if (node.stability === "confirmed") {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.1;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Main node
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.globalAlpha = node.stability === "confirmed" ? 0.9 : node.stability === "learned" ? 0.7 : 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Label — only for top-20 hub nodes (+ user node), when the label toggle is on.
    if (showLabels && labeledNodeIds.has(node.id)) {
      const screenFontPx = 12;
      const screenPadPx = 8;
      const fontSize = screenFontPx / globalScale;
      const pad = r + screenPadPx / globalScale;

      // Position in one of 4 directions based on node's angle from center.
      const angle = Math.atan2(node.y, node.x);
      const sector = Math.round((angle + Math.PI) / (Math.PI / 2)) % 4;

      ctx.font = `${fontSize}px -apple-system, sans-serif`;
      ctx.fillStyle = labelColor;
      ctx.globalAlpha = 0.85;

      if (sector === 0 || sector === 2) {
        // Left or right
        const isRight = sector === 0;
        ctx.textAlign = isRight ? "left" : "right";
        ctx.textBaseline = "middle";
        ctx.fillText(node.name, node.x + (isRight ? pad : -pad), node.y);
      } else {
        // Above or below
        const isBelow = sector === 1;
        ctx.textAlign = "center";
        ctx.textBaseline = isBelow ? "top" : "bottom";
        ctx.fillText(node.name, node.x, node.y + (isBelow ? pad : -pad));
      }
      ctx.globalAlpha = 1;
    }
  }, [showLabels, labeledNodeIds, palette, labelColor]);

  // Custom link rendering — lines stop at node borders
  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D) => {
    const src = link.source;
    const tgt = link.target;
    if (!src || !tgt || src.x == null || tgt.x == null) return;

    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return;

    const srcR = getNodeRadius(src);
    const tgtR = getNodeRadius(tgt);

    // Shorten line by each node's radius
    const ux = dx / dist;
    const uy = dy / dist;
    const x1 = src.x + ux * srcR;
    const y1 = src.y + uy * srcR;
    const x2 = tgt.x - ux * tgtR;
    const y2 = tgt.y - uy * tgtR;

    const isMemLink = src.isMemory || tgt.isMemory || src.isPage || tgt.isPage;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = palette.edge;
    ctx.lineWidth = isMemLink ? 0.5 : 1;
    if (isMemLink) ctx.setLineDash([2, 3]);
    else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [getNodeRadius, palette]);

  const statusContainerStyle = {
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
      <div data-testid="constellation-map" ref={containerRef} style={statusContainerStyle}>
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
      <div data-testid="constellation-map" ref={containerRef} style={statusContainerStyle}>
        <span className="entity-empty">{t("constellationMap.loading")}</span>
      </div>
    );
  }

  if (entities.length === 0) {
    return (
      <div data-testid="constellation-map" ref={containerRef} style={statusContainerStyle}>
        <span className="entity-empty">{t("constellationMap.empty")}</span>
      </div>
    );
  }

  const isPartialCoverage = model.coverage.relationsFetchedFor < model.coverage.totalEntities;

  return (
    <div
      data-testid="constellation-map"
      ref={containerRef}
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        background: "var(--mem-surface)",
        overflow: "hidden",
      }}
    >
      <ForceGraph2D
        ref={fgRef}
        graphData={stableGraphData}
        width={dimensions.width}
        height={dimensions.height}
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
          const r = node.isMemory ? 3 : node.isPage ? PAGE_HALF_SIDE : nodeRadius(node.stability ?? "new", node.connectionCount);
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 2, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        linkCanvasObject={paintLink}
        linkCanvasObjectMode={() => "replace"}
        nodeLabel={(node: any) => node.name}
        nodeRelSize={1}
        nodeVal={(node: any) => {
          if (node.isMemory) return node.stability === "confirmed" || node.isDistilled ? 4.5 : 3;
          if (node.isPage) return PAGE_HALF_SIDE;
          return nodeRadius(node.stability ?? "new", node.connectionCount);
        }}
        backgroundColor="rgba(0,0,0,0)"
        enableNodeDrag={true}
        enableZoomInteraction={true}
        enablePanInteraction={true}
        warmupTicks={0}
        cooldownTicks={100}
        d3AlphaDecay={0.03}
        d3VelocityDecay={0.25}
        onNodeClick={(node: any) => {
          // Memory nodes pass source_id (without mem: prefix); page nodes pass
          // their id as-is (already `page:<id>`); entity nodes pass entity id.
          onNodeClick?.(node.isMemory ? `memory:${node.id.replace("mem:", "")}` : node.id);
        }}
        onEngineStop={() => {
          // Negative padding here bleeds the bbox past the viewport edges,
          // producing a noticeable "zoom in to see meaningful connections"
          // effect. Without it, the graph sat comfortably in the middle with
          // a band of empty space top and bottom.
          fgRef.current?.zoomToFit?.(400, -40);
        }}
      />

      {/* Corner label */}
      <div
        style={{
          position: "absolute",
          bottom: 6,
          right: 8,
          fontSize: 10,
          color: "var(--mem-text-tertiary)",
          fontFamily: "var(--mem-font-body)",
          pointerEvents: "none",
        }}
      >
        {cornerLabel}
      </div>

      {/* Legend — top-right */}
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          display: "flex",
          flexDirection: "column",
          gap: 3,
          pointerEvents: "none",
        }}
      >
        {/* Legend box */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 5,
            padding: "6px 10px",
            fontSize: 10,
            fontFamily: "var(--mem-font-body)",
            color: "var(--mem-text-tertiary)",
            background: "var(--mem-surface)",
            border: "1px solid var(--mem-border)",
            borderRadius: 6,
            opacity: 0.85,
          }}
        >
          {LEGEND_ITEMS.map(({ label, key }) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: colorForEntityType(key, palette),
                  opacity: 0.7,
                  flexShrink: 0,
                }}
              />
              <span>{label}</span>
            </div>
          ))}
          {showMemories && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  backgroundColor: palette.neutral,
                  opacity: 0.7,
                  flexShrink: 0,
                  marginLeft: 1,
                }}
              />
              <span style={{ opacity: 0.7 }}>Memory</span>
            </div>
          )}
          {showPages && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: 1.5,
                  backgroundColor: palette.neutral,
                  opacity: 0.7,
                  flexShrink: 0,
                  marginLeft: 1,
                }}
              />
              <span style={{ opacity: 0.7 }}>Page</span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{
              display: "inline-block",
              width: 12,
              height: 0,
              borderTop: "1px solid var(--mem-text-tertiary)",
              opacity: 0.5,
              flexShrink: 0,
            }} />
            <span>Connection</span>
          </div>
        </div>

        {/* Toggles — grouped below legend */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          padding: "4px 6px",
          background: "var(--mem-surface)",
          border: "1px solid var(--mem-border)",
          borderRadius: 6,
          opacity: 0.85,
          pointerEvents: "auto",
        }}>
          {isPartialCoverage && (
            <span
              data-testid="constellation-coverage-chip"
              style={{
                padding: "2px 4px",
                fontSize: 10,
                fontFamily: "var(--mem-font-body)",
                color: "var(--mem-text-tertiary)",
              }}
            >
              {t("constellationMap.coverageChip", {
                fetched: model.coverage.relationsFetchedFor,
                total: model.coverage.totalEntities,
              })}
            </span>
          )}
          {[
            { label: "Memories", on: showMemories, toggle: () => setShowMemories((v) => { const next = !v; localStorage.setItem("constellation-show-memories", String(next)); return next; }), testId: "memory-toggle" },
            { label: "Pages", on: showPages, toggle: () => setShowPages((v) => { const next = !v; localStorage.setItem("constellation-show-pages", String(next)); return next; }), testId: "page-toggle" },
            { label: "Labels", on: showLabels, toggle: () => setShowLabels((v) => { const next = !v; localStorage.setItem("constellation-show-labels", String(next)); return next; }) },
          ].map(({ label, on, toggle, testId }) => (
            <button
              key={label}
              onClick={(e) => { e.stopPropagation(); toggle(); }}
              data-testid={testId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 4px",
                fontSize: 10,
                fontFamily: "var(--mem-font-body)",
                color: on ? "var(--mem-text-primary)" : "var(--mem-text-tertiary)",
                background: "none",
                border: "none",
                cursor: "pointer",
                opacity: on ? 1 : 0.5,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {on
                  ? <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9 12l2 2 4-4" /></>
                  : <rect x="3" y="3" width="18" height="18" rx="3" />
                }
              </svg>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

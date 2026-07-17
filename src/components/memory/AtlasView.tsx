// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Graph from "graphology";
import Sigma from "sigma";
import { listEntities, getEntityDetail } from "../../lib/tauri";
import type { Entity, EntityDetail } from "../../lib/tauri";
import { buildGraphModel } from "../../lib/graph/model";
import { buildAtlasGraph, runAtlasLayout } from "../../lib/graph/atlas";
import { useGraphPalette, colorForEntityType } from "../../lib/graph/palette";

interface AtlasViewProps {
  onNodeClick?: (entityId: string) => void;
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

    const renderer = new Sigma(graph, container, {
      labelRenderedSizeThreshold: 6,
      // Default camera fit maps the graph bbox edge-to-edge on the tighter
      // axis, half-clipping the extreme nodes; give the map a margin.
      stagePadding: 40,
      // Sigma's default label ink is black regardless of theme; pass the
      // resolved text token instead (updated on theme flip below).
      labelColor: { color: palette.label },
    });
    sigmaRef.current = renderer;
    if (import.meta.env.DEV) {
      // Preview/debug handle only — stripped from prod builds.
      (window as unknown as Record<string, unknown>).__ATLAS_SIGMA = renderer;
    }
    renderer.on("clickNode", ({ node }) => onNodeClick?.(node));
    renderer.on("enterNode", () => {
      container.style.cursor = "pointer";
    });
    renderer.on("leaveNode", () => {
      container.style.cursor = "default";
    });

    return () => {
      sigmaRef.current = null;
      graphRef.current = null;
      renderer.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // Theme flip: recolor the live graph and repaint — no remount.
  useEffect(() => {
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

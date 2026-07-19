// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  asPageMapApiError,
  getPageMap,
  improvePageMap,
  patchPageMapNode,
  putPageMapLayout,
  type PageMapLayoutPosition,
  type PageMapNode,
  type PageMapStatus,
} from "../../lib/tauri";
import { layoutMap } from "../../lib/pageMap/tree";
import { useGraphPalette } from "../../lib/graph/palette";
import CanvasNode, { type CanvasNodeData } from "./canvas/CanvasNode";

interface PageCanvasProps {
  pageId: string;
  pageTitle: string;
  /** "{ref_kind}:{ref_id}" -> display name, for nodes the daemon left label:null */
  labelOverrides: ReadonlyMap<string, string>;
  onMemoryClick: (sourceId: string) => void;
  onPageClick?: (pageId: string) => void;
  onEntityClick?: (entityId: string) => void;
}

// The map shape this build knows how to edit. A map stamped higher was written
// by a newer Wenlan: render it, never write to it (spec: degrade, never
// corrupt).
const SUPPORTED_MAP_SCHEMA = 1;
const LAYOUT_DEBOUNCE_MS = 600;

const nodeTypes: NodeTypes = { pageMapNode: CanvasNode as NodeTypes[string] };

export default function PageCanvas(props: PageCanvasProps) {
  // useReactFlow (for the viewport we persist) only works under a provider.
  return (
    <ReactFlowProvider>
      <PageCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function PageCanvasInner({
  pageId,
  pageTitle,
  labelOverrides,
  onMemoryClick,
  onPageClick,
  onEntityClick,
}: PageCanvasProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const palette = useGraphPalette();
  const { getViewport } = useReactFlow();
  const [notice, setNotice] = useState<string | null>(null);
  // Positions the user dropped that the daemon has not acknowledged yet.
  const [dragged, setDragged] = useState<Record<string, { x: number; y: number }>>({});

  const {
    data: map,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["page-map", pageId],
    queryFn: () => getPageMap(pageId),
    retry: false,
  });

  const readOnly = !!map && map.map_schema > SUPPORTED_MAP_SCHEMA;

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["page-map", pageId] }),
    [queryClient, pageId],
  );

  useEffect(() => {
    setDragged({});
    setNotice(null);
  }, [pageId]);

  const untitled = t("pageCanvas.untitled");
  const views = useMemo(
    () => layoutMap(map?.nodes ?? [], labelOverrides, untitled),
    [map?.nodes, labelOverrides, untitled],
  );

  // A losing race is not an error the user caused: say what happened, refresh
  // to the server's truth, and let them redo the one action.
  const handleMutationError = useCallback(
    (e: unknown) => {
      if (asPageMapApiError(e)?.status === 409) {
        setNotice(t("pageCanvas.conflict"));
        void invalidate();
        void refetch();
        return;
      }
      setNotice(t("pageCanvas.mutationError"));
    },
    [invalidate, refetch, t],
  );

  const improveMutation = useMutation({
    mutationFn: () => improvePageMap(pageId),
    onSuccess: () => {
      setNotice(null);
      void invalidate();
    },
    onError: handleMutationError,
  });

  const statusMutation = useMutation({
    mutationFn: ({ nodeId, status }: { nodeId: string; status: PageMapStatus }) =>
      patchPageMapNode(pageId, nodeId, {
        base_revision: map?.revision ?? 0,
        status,
      }),
    onSuccess: () => {
      setNotice(null);
      void invalidate();
    },
    onError: handleMutationError,
  });

  const layoutPayload = useMemo<PageMapLayoutPosition[]>(
    () =>
      views.map((v) => {
        // Views carry box centers; React Flow positions are top-left. Store
        // centers so a round-trip through layoutMap lands where it started.
        const drag = dragged[v.node.id];
        return {
          node_id: v.node.id,
          x: drag ? drag.x + v.width / 2 : v.x,
          y: drag ? drag.y + v.height / 2 : v.y,
          width: v.width,
          height: v.height,
          collapsed: v.node.collapsed,
        };
      }),
    [views, dragged],
  );

  const layoutPayloadRef = useRef(layoutPayload);
  const revisionRef = useRef(map?.revision ?? 0);
  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    layoutPayloadRef.current = layoutPayload;
  }, [layoutPayload]);
  useEffect(() => {
    revisionRef.current = map?.revision ?? 0;
  }, [map?.revision]);
  useEffect(
    () => () => {
      if (layoutTimer.current) clearTimeout(layoutTimer.current);
    },
    [],
  );

  const flushLayout = useCallback(async () => {
    const positions = layoutPayloadRef.current;
    if (positions.length === 0) return;
    const viewport = getViewport();
    const put = (base_revision: number) =>
      putPageMapLayout(pageId, { base_revision, viewport, positions });

    try {
      await put(revisionRef.current);
    } catch (e) {
      if (asPageMapApiError(e)?.status !== 409) {
        setNotice(t("pageCanvas.mutationError"));
        return;
      }
      // Where the user dropped a node IS the intent, so it wins the race:
      // refetch the revision and replay the same coordinates exactly once.
      const fresh = await refetch();
      const rev = fresh.data?.revision;
      if (rev === undefined) {
        setNotice(t("pageCanvas.conflict"));
        return;
      }
      try {
        await put(rev);
      } catch {
        setNotice(t("pageCanvas.conflict"));
        return;
      }
    }
    setDragged({});
    setNotice(null);
    void invalidate();
  }, [getViewport, pageId, refetch, invalidate, t]);

  // One PUT per burst: every drop restarts the timer, so dragging five nodes
  // in a row sends one request carrying all five.
  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      setDragged((d) => ({ ...d, [node.id]: { ...node.position } }));
      if (layoutTimer.current) clearTimeout(layoutTimer.current);
      layoutTimer.current = setTimeout(() => {
        layoutTimer.current = null;
        void flushLayout();
      }, LAYOUT_DEBOUNCE_MS);
    },
    [flushLayout],
  );

  const openNode = useCallback(
    (node: PageMapNode) => {
      if (node.ref_kind === "memory") onMemoryClick(node.ref_id);
      else if (node.ref_kind === "page") onPageClick?.(node.ref_id);
      else if (node.ref_kind === "entity") onEntityClick?.(node.ref_id);
      // "section" is a pure grouping node — there is nothing behind it to open.
    },
    [onMemoryClick, onPageClick, onEntityClick],
  );

  const rfNodes = useMemo<Node[]>(
    () =>
      views.map((v) => {
        const data: CanvasNodeData = {
          label: v.label,
          refKind: v.node.ref_kind,
          status: v.node.status,
          dangling: v.node.ref_state === "dangling",
          isRoot: v.node.parent_id === null,
          readOnly,
          palette,
          width: v.width,
          height: v.height,
          onOpen: () => openNode(v.node),
          onAccept: () =>
            statusMutation.mutate({ nodeId: v.node.id, status: "active" }),
          onDismiss: () =>
            statusMutation.mutate({ nodeId: v.node.id, status: "dismissed" }),
        };
        return {
          id: v.node.id,
          type: "pageMapNode",
          draggable: !readOnly,
          position: dragged[v.node.id] ?? {
            x: v.x - v.width / 2,
            y: v.y - v.height / 2,
          },
          data,
        };
      }),
    [views, dragged, readOnly, palette, openNode, statusMutation],
  );

  const rfEdges = useMemo<Edge[]>(() => {
    const rendered = new Set(views.map((v) => v.node.id));
    const edges: Edge[] = [];
    for (const v of views) {
      const parent = v.node.parent_id;
      if (!parent || !rendered.has(parent)) continue;
      // "tree-" prefix keeps derived spine edges out of the server id space.
      edges.push({
        id: `tree-${v.node.id}`,
        source: parent,
        target: v.node.id,
        style: { stroke: palette.edge, strokeWidth: 1.2 },
      });
    }
    for (const e of map?.edges ?? []) {
      if (e.status === "dismissed") continue;
      if (!rendered.has(e.from_node) || !rendered.has(e.to_node)) continue;
      edges.push({
        id: e.id,
        source: e.from_node,
        target: e.to_node,
        label: e.label ?? undefined,
        style: {
          stroke: palette.bridge,
          strokeWidth: 1,
          strokeDasharray: "4 3",
        },
      });
    }
    return edges;
  }, [views, map?.edges, palette]);

  if (isLoading) return null;

  if (error) {
    const status = asPageMapApiError(error)?.status;
    if (status === 404 || status === 405) {
      return (
        <CanvasMessage
          title={t("pageCanvas.daemonOutdatedTitle")}
          body={t("pageCanvas.daemonOutdatedBody")}
        />
      );
    }
    return (
      <CanvasMessage
        title={t("pageCanvas.loadErrorTitle")}
        body={t("pageCanvas.loadErrorBody")}
        action={
          <button type="button" onClick={() => void refetch()} style={primaryButtonStyle}>
            {t("pageCanvas.retry")}
          </button>
        }
      />
    );
  }

  if (!map || map.revision === 0 || views.length === 0) {
    return (
      <CanvasMessage
        title={t("pageCanvas.emptyTitle")}
        body={t("pageCanvas.emptyBody")}
        action={
          <button
            type="button"
            onClick={() => improveMutation.mutate()}
            disabled={improveMutation.isPending || readOnly}
            style={primaryButtonStyle}
          >
            {improveMutation.isPending
              ? t("pageCanvas.generating")
              : t("pageCanvas.generate")}
          </button>
        }
      />
    );
  }

  return (
    <div className="page-canvas">
      <div className="page-canvas-toolbar">
        <button
          type="button"
          onClick={() => improveMutation.mutate()}
          disabled={improveMutation.isPending || readOnly}
          style={primaryButtonStyle}
        >
          {improveMutation.isPending
            ? t("pageCanvas.improving")
            : t("pageCanvas.improve")}
        </button>
        {readOnly && (
          <span className="page-canvas-badge" title={t("pageCanvas.readOnlyNotice")}>
            {t("pageCanvas.readOnlyBadge")}
          </span>
        )}
        {notice && (
          <span role="status" aria-live="polite" className="page-canvas-notice">
            {notice}
          </span>
        )}
      </div>
      {readOnly && (
        <p role="status" className="page-canvas-banner">
          {t("pageCanvas.readOnlyNotice")}
        </p>
      )}
      <div
        className="page-canvas-surface"
        role="region"
        aria-label={t("pageCanvas.regionLabel", { title: pageTitle })}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodeDragStop={handleNodeDragStop}
          nodesDraggable={!readOnly}
          nodesConnectable={false}
          edgesFocusable={false}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color={palette.graticule} gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  fontFamily: "var(--mem-font-body)",
  fontSize: 12,
  fontWeight: 500,
  padding: "5px 12px",
  borderRadius: 7,
  border: "1px solid var(--mem-border)",
  backgroundColor: "var(--mem-surface)",
  color: "var(--mem-text-secondary)",
  cursor: "pointer",
};

function CanvasMessage({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-canvas-message">
      <p className="page-canvas-message-title">{title}</p>
      {body && <p className="page-canvas-message-body">{body}</p>}
      {action}
    </div>
  );
}

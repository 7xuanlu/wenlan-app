// SPDX-License-Identifier: AGPL-3.0-only
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  asPageMapApiError,
  createPageMapNode,
  deletePageMapNode,
  getPage,
  getPageMap,
  improvePageMap,
  patchPageMapNode,
  putPageMapLayout,
  updatePage,
  type PageMapLayoutPosition,
  type PageMapNode,
  type PageMapStatus,
} from "../../lib/tauri";
import { layoutMap, NODE_HEIGHT } from "../../lib/pageMap/tree";
import { slugify, withHeading } from "../../lib/pageMap/slug";
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

// A box the user is still naming. It lives only in local state and never
// reaches the daemon: a node's `ref_id` is fixed at creation (PATCH takes
// label/pinned/status/rank/parent_id and nothing else), so the name has to be
// settled *before* the create call rather than patched in afterwards.
const DRAFT_ID = "__draft__";
const DRAFT_SIZE = { width: 170, height: NODE_HEIGHT };
// Where a new box lands relative to its parent, until the next layout pass
// gives it a real radial slot.
const DRAFT_OFFSET = { x: 150, y: 64 };

// Key caps stay expressions rather than literal JSX text: they name physical
// keys, not copy, so they are not translated and must not read as new
// hardcoded strings.
// `as const` is load-bearing: i18n keys are a literal union here, and a
// `string` annotation would widen them past the point where t() type-checks.
const SHORTCUTS = [
  { cap: "Tab", key: "pageCanvas.hintAddChild" },
  { cap: "Enter", key: "pageCanvas.hintAddSibling" },
  { cap: "F2", key: "pageCanvas.hintRename" },
  { cap: "Delete", key: "pageCanvas.hintDelete" },
] as const;

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
  // Node state is local and React Flow owns it during a drag. This is what
  // makes dragging cheap: a pointer move rewrites one node's position instead
  // of re-deriving the whole tree, and every other node keeps its identity so
  // memo(CanvasNode) actually holds.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [draft, setDraft] = useState<{ parentId: string; x: number; y: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

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

  // Nodes the user has moved whose positions the daemon has not stored yet. A
  // resync must not overwrite these or the box snaps back to its old slot
  // mid-burst, which reads as the drag being ignored.
  //
  // Stamped per drop rather than kept as a plain set: a drag that starts while
  // the previous PUT is still in flight would otherwise be cleared by that
  // PUT's completion, and the refetch behind it would yank the box back to the
  // position the user just moved it away from.
  const dirtyRef = useRef(new Map<string, number>());
  const dragSeq = useRef(0);
  const nodesRef = useRef<Node[]>([]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    dirtyRef.current.clear();
    setDraft(null);
    setEditingId(null);
    setNotice(null);
  }, [pageId]);

  const untitled = t("pageCanvas.untitled");
  const views = useMemo(
    () => layoutMap(map?.nodes ?? [], labelOverrides, untitled),
    [map?.nodes, labelOverrides, untitled],
  );

  // Box metrics and collapse state by id, so the layout PUT can be built from
  // local positions without walking the tree again.
  const metaRef = useRef(new Map<string, { width: number; height: number; collapsed: boolean }>());
  useEffect(() => {
    metaRef.current = new Map(
      views.map((v) => [
        v.node.id,
        { width: v.width, height: v.height, collapsed: v.node.collapsed },
      ]),
    );
  }, [views]);

  const revisionRef = useRef(map?.revision ?? 0);
  useEffect(() => {
    revisionRef.current = map?.revision ?? 0;
  }, [map?.revision]);

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

  const onMutated = useCallback(() => {
    setNotice(null);
    void invalidate();
  }, [invalidate]);

  const improveMutation = useMutation({
    mutationFn: () => improvePageMap(pageId),
    onSuccess: onMutated,
    onError: handleMutationError,
  });

  const statusMutation = useMutation({
    mutationFn: ({ nodeId, status }: { nodeId: string; status: PageMapStatus }) =>
      patchPageMapNode(pageId, nodeId, {
        base_revision: revisionRef.current,
        status,
      }),
    onSuccess: onMutated,
    onError: handleMutationError,
  });

  const renameMutation = useMutation({
    mutationFn: ({ nodeId, label }: { nodeId: string; label: string }) =>
      patchPageMapNode(pageId, nodeId, {
        base_revision: revisionRef.current,
        label,
      }),
    onSuccess: onMutated,
    onError: handleMutationError,
  });

  const removeMutation = useMutation({
    mutationFn: (nodeId: string) =>
      deletePageMapNode(pageId, nodeId, { base_revision: revisionRef.current }),
    onSuccess: onMutated,
    onError: handleMutationError,
  });

  // A new box is a new section of the page. The daemon recomputes a section
  // node's liveness from the page's own headings on every read
  // (`compute_ref_state`), so the heading has to exist before the node does —
  // otherwise the box the user just drew comes back marked as gone.
  const addMutation = useMutation({
    mutationFn: async ({ parentId, label }: { parentId: string; label: string }) => {
      const page = await getPage(pageId);
      const content = page?.content ?? "";
      const next = withHeading(content, label);
      if (next !== content) await updatePage(pageId, next);
      return createPageMapNode(pageId, {
        base_revision: revisionRef.current,
        parent_id: parentId,
        ref_kind: "section",
        ref_id: `${pageId}#${slugify(label)}`,
        label,
      });
    },
    onSuccess: () => {
      setNotice(null);
      // The page body gained a heading, so the Read tab and the revision list
      // are both stale now.
      void queryClient.invalidateQueries({ queryKey: ["page", pageId] });
      void queryClient.invalidateQueries({ queryKey: ["page-revisions", pageId] });
      void invalidate();
    },
    onError: handleMutationError,
  });

  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (layoutTimer.current) clearTimeout(layoutTimer.current);
    },
    [],
  );

  const flushLayout = useCallback(async () => {
    // Snapshot the stamps this PUT is answering for, so a drop that lands
    // while it is in flight stays dirty.
    const flushing = new Map(dirtyRef.current);
    const meta = metaRef.current;
    const positions: PageMapLayoutPosition[] = [];
    for (const n of nodesRef.current) {
      const m = meta.get(n.id);
      if (!m) continue; // the draft box, or a node the last refetch dropped
      // React Flow positions are top-left; the daemon stores box centers, so a
      // round-trip through layoutMap lands where the user let go.
      positions.push({
        node_id: n.id,
        x: n.position.x + m.width / 2,
        y: n.position.y + m.height / 2,
        width: m.width,
        height: m.height,
        collapsed: m.collapsed,
      });
    }
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
    for (const [id, stamp] of flushing) {
      if (dirtyRef.current.get(id) === stamp) dirtyRef.current.delete(id);
    }
    setNotice(null);
    void invalidate();
  }, [getViewport, pageId, refetch, invalidate, t]);

  // One PUT per burst: every drop restarts the timer, so dragging five nodes
  // in a row sends one request carrying all five.
  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      dragSeq.current += 1;
      dirtyRef.current.set(node.id, dragSeq.current);
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

  const { mutate: mutateStatus } = statusMutation;
  const { mutate: mutateRename } = renameMutation;
  const { mutate: mutateRemove } = removeMutation;
  const { mutate: mutateAdd } = addMutation;

  // Server-derived nodes. Rebuilt only when the map itself changes, never on a
  // drag frame — every callback below closes over stable identities so the
  // `data` object can survive a whole drag untouched.
  const serverNodes = useMemo<Node[]>(
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
          editing: false,
          onOpen: () => openNode(v.node),
          onAccept: () => mutateStatus({ nodeId: v.node.id, status: "active" }),
          onDismiss: () => mutateStatus({ nodeId: v.node.id, status: "dismissed" }),
          onCommit: (label: string) => {
            setEditingId(null);
            const trimmed = label.trim();
            if (trimmed && trimmed !== v.label) {
              mutateRename({ nodeId: v.node.id, label: trimmed });
            }
          },
          onCancel: () => setEditingId(null),
        };
        return {
          id: v.node.id,
          type: "pageMapNode",
          draggable: !readOnly,
          position: { x: v.x - v.width / 2, y: v.y - v.height / 2 },
          data,
        };
      }),
    [views, readOnly, palette, openNode, mutateStatus, mutateRename],
  );

  // Fold the server's copy into local state, keeping what the user has done
  // since: an unflushed drag outranks the stored position, and selection must
  // survive a refetch or the map deselects itself every time it saves.
  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return serverNodes.map((n) => {
        const old = prevById.get(n.id);
        if (!old) return n;
        return {
          ...n,
          position: dirtyRef.current.has(n.id) ? old.position : n.position,
          selected: old.selected,
        };
      });
    });
  }, [serverNodes, setNodes]);

  const commitDraft = useCallback(
    (label: string) => {
      const pending = draft;
      setDraft(null);
      if (!pending) return;
      const trimmed = label.trim();
      if (!trimmed) return; // named nothing, added nothing
      if (!slugify(trimmed)) {
        setNotice(t("pageCanvas.badSectionName"));
        return;
      }
      mutateAdd({ parentId: pending.parentId, label: trimmed });
    },
    [draft, mutateAdd, t],
  );

  const draftNode = useMemo<Node | null>(() => {
    if (!draft) return null;
    const data: CanvasNodeData = {
      label: "",
      refKind: "section",
      status: "active",
      dangling: false,
      isRoot: false,
      readOnly: false,
      palette,
      width: DRAFT_SIZE.width,
      height: DRAFT_SIZE.height,
      editing: true,
      placeholder: t("pageCanvas.newSectionPlaceholder"),
      onOpen: () => {},
      onAccept: () => {},
      onDismiss: () => {},
      onCommit: commitDraft,
      onCancel: () => setDraft(null),
    };
    return {
      id: DRAFT_ID,
      type: "pageMapNode",
      draggable: false,
      selectable: false,
      position: { x: draft.x, y: draft.y },
      data,
    };
  }, [draft, palette, commitDraft, t]);

  const startDraft = useCallback(
    (mode: "child" | "sibling") => {
      const rootId = views.find((v) => v.node.parent_id === null)?.node.id;
      if (!rootId) return;
      const selected = nodesRef.current.find((n) => n.selected);
      const anchorId = selected?.id ?? rootId;
      const parentId =
        !selected || mode === "child"
          ? anchorId
          : (views.find((v) => v.node.id === anchorId)?.node.parent_id ?? rootId);
      const base =
        nodesRef.current.find((n) => n.id === anchorId)?.position ?? { x: 0, y: 0 };
      setEditingId(null);
      setDraft({
        parentId,
        x: base.x + DRAFT_OFFSET.x,
        y: base.y + DRAFT_OFFSET.y,
      });
    },
    [views],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (readOnly) return;
      const target = e.target as HTMLElement | null;
      // Typing a box's name is not a canvas shortcut.
      if (target && (target.tagName === "INPUT" || target.isContentEditable)) return;
      const selected = nodesRef.current.find((n) => n.selected);
      switch (e.key) {
        case "Tab":
          e.preventDefault();
          startDraft("child");
          break;
        case "Enter":
          e.preventDefault();
          startDraft("sibling");
          break;
        case "F2":
          e.preventDefault();
          if (selected) setEditingId(selected.id);
          break;
        case "Delete":
        case "Backspace": {
          e.preventDefault();
          if (!selected) break;
          const view = views.find((v) => v.node.id === selected.id);
          if (view?.node.parent_id === null) {
            setNotice(t("pageCanvas.rootUndeletable"));
            break;
          }
          mutateRemove(selected.id);
          break;
        }
        case "Escape":
          setDraft(null);
          setEditingId(null);
          break;
        default:
          break;
      }
    },
    [readOnly, startDraft, views, mutateRemove, t],
  );

  // The array React Flow actually renders. In the common case — including
  // every frame of a drag — this IS the local state, so nothing is rebuilt and
  // memo(CanvasNode) holds for every box.
  const displayNodes = useMemo<Node[]>(() => {
    // First frame with data: state is still empty because the sync effect has
    // not run yet, and mounting React Flow on an empty array would make
    // fitView frame nothing.
    const base = nodes.length === 0 ? serverNodes : nodes;
    if (!editingId && !draftNode) return base;
    const out = editingId
      ? base.map((n) =>
          n.id === editingId ? { ...n, data: { ...n.data, editing: true } } : n,
        )
      : base.slice();
    if (draftNode) out.push(draftNode);
    return out;
  }, [nodes, serverNodes, editingId, draftNode]);

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
          onClick={() => startDraft("child")}
          disabled={readOnly}
          style={primaryButtonStyle}
        >
          {t("pageCanvas.addSection")}
        </button>
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
        onKeyDown={handleKeyDown}
      >
        <ReactFlow
          nodes={displayNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={handleNodeDragStop}
          nodesDraggable={!readOnly}
          nodesConnectable={false}
          edgesFocusable={false}
          // Delete is handled above, against the map's revision. Left to React
          // Flow it would drop the box from the canvas locally and leave the
          // daemon's copy untouched.
          deleteKeyCode={null}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color={palette.graticule} gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {!readOnly && <CanvasHints />}
    </div>
  );
}

function CanvasHints() {
  const { t } = useTranslation();
  return (
    <div
      role="note"
      aria-label={t("pageCanvas.hintsLabel")}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "6px 10px",
        fontFamily: "var(--mem-font-body)",
        fontSize: 11,
        color: "var(--mem-text-tertiary, var(--mem-text-secondary))",
      }}
    >
      {SHORTCUTS.map((s) => (
        <span key={s.cap} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <kbd
            style={{
              fontFamily: "var(--mem-font-mono, ui-monospace, monospace)",
              fontSize: 10,
              lineHeight: 1.4,
              padding: "1px 5px",
              borderRadius: 4,
              border: "1px solid var(--mem-border)",
              backgroundColor: "var(--mem-surface)",
            }}
          >
            {s.cap}
          </kbd>
          {t(s.key)}
        </span>
      ))}
      <span style={{ opacity: 0.75 }}>{t("pageCanvas.hintSectionNote")}</span>
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

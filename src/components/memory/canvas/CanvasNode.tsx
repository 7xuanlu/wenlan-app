// SPDX-License-Identifier: AGPL-3.0-only
import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import {
  compositeOver,
  type GraphPalette,
  type GraphSlot,
} from "../../../lib/graph/palette";
import type { PageMapRefKind, PageMapStatus } from "../../../lib/tauri";

// Page-map ref kinds are not entity types, so they get their own mapping onto
// the validated 5-slot Atlas palette rather than going through
// slotForEntityType. Same inks, same theme reactivity, no new colors.
const SLOT_BY_REF_KIND: Record<PageMapRefKind, GraphSlot> = {
  page: "project",
  memory: "neutral",
  entity: "concept",
  section: "tool",
};

export interface CanvasNodeData extends Record<string, unknown> {
  label: string;
  refKind: PageMapRefKind;
  status: PageMapStatus;
  dangling: boolean;
  isRoot: boolean;
  readOnly: boolean;
  palette: GraphPalette;
  width: number;
  height: number;
  onOpen: () => void;
  onAccept: () => void;
  onDismiss: () => void;
}

export type CanvasNodeType = Node<CanvasNodeData, "pageMapNode">;

// Both handles sit at the box center with zero opacity: a mind map reads as
// center-to-center spokes, and edge-anchored handles would kink every spoke
// on a radial layout.
const CENTER_HANDLE = {
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  opacity: 0,
  pointerEvents: "none",
} as const;

function CanvasNode({ data }: NodeProps<CanvasNodeType>) {
  const { t } = useTranslation();
  const {
    label,
    refKind,
    status,
    dangling,
    isRoot,
    readOnly,
    palette,
    width,
    height,
  } = data;

  const slotColor = palette[SLOT_BY_REF_KIND[refKind]];
  const suggested = status === "suggested";
  const showControls = suggested && !isRoot && !readOnly;

  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        alignItems: "center",
        gap: 6,
        boxSizing: "border-box",
        padding: "0 10px",
        borderRadius: 10,
        border: `${isRoot ? 1.5 : 1}px ${suggested ? "dashed" : "solid"} ${slotColor}`,
        backgroundColor: compositeOver(
          slotColor,
          palette.surface,
          isRoot ? 0.22 : 0.1,
        ),
        opacity: dangling ? 0.45 : suggested ? 0.75 : 1,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={CENTER_HANDLE}
      />
      <button
        type="button"
        onClick={data.onOpen}
        title={dangling ? t("pageCanvas.dangling") : label}
        aria-label={
          dangling ? t("pageCanvas.danglingNode", { label }) : label
        }
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: "left",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: dangling ? palette.labelMuted : palette.label,
          fontFamily: "var(--mem-font-body)",
          fontSize: 12,
          fontWeight: isRoot ? 600 : 400,
        }}
      >
        {label}
      </button>
      {showControls && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onAccept();
            }}
            aria-label={t("pageCanvas.accept")}
            title={t("pageCanvas.accept")}
            style={controlStyle(palette.label)}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onDismiss();
            }}
            aria-label={t("pageCanvas.dismiss")}
            title={t("pageCanvas.dismiss")}
            style={controlStyle(palette.labelMuted)}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        style={CENTER_HANDLE}
      />
    </div>
  );
}

function controlStyle(color: string): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 18,
    height: 18,
    borderRadius: 5,
    border: "none",
    background: "none",
    cursor: "pointer",
    color,
  };
}

export default memo(CanvasNode);

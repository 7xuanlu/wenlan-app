// SPDX-License-Identifier: AGPL-3.0-only
import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";

/**
 * The stroke between a box and its parent, drawn as a mind map draws it.
 *
 * React Flow's own bezier is wrong here, and not by a little: it derives its
 * control points from the handle's `Position` enum, so with our handles pinned
 * at the box center as Top and Bottom every curve leaves the parent going down
 * and enters the child going down. On a radial map, where a child can sit at
 * any angle, that reads as an S laid over the spoke. `straight` avoided the S
 * but drew the map as a wire diagram.
 *
 * A quadratic with its control point pushed off the chord's own midpoint has no
 * opinion about which way is down: the arc follows wherever the child actually
 * is, which is the only direction that means anything on a ring.
 */

/**
 * How far the arc bows, as a fraction of the distance between the two boxes.
 *
 * Proportional rather than fixed so a long spoke to the outer ring and a short
 * one between siblings bow by the same visual amount. Kept small on purpose:
 * boxes on one ring are separated by their own width, not by room for a curve,
 * so a deep bow on a crowded ring will lean a stroke into the neighbouring box.
 */
const BOW = 0.11;

function SpineEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
}: EdgeProps) {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const span = Math.hypot(dx, dy);
  // Perpendicular to the chord, one consistent rotational sense for every edge
  // on the map. Mixing the sign per edge makes siblings bow toward each other
  // and the fan stops reading as a fan.
  const offset = span * BOW;
  const cx = (sourceX + targetX) / 2 + (-dy / (span || 1)) * offset;
  const cy = (sourceY + targetY) / 2 + (dx / (span || 1)) * offset;

  return (
    <BaseEdge
      path={`M${sourceX},${sourceY} Q${cx},${cy} ${targetX},${targetY}`}
      style={style}
      markerEnd={markerEnd}
    />
  );
}

export default SpineEdge;
export type SpineEdgeType = Edge<Record<string, unknown>, "spine">;

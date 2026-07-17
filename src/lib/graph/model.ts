// SPDX-License-Identifier: AGPL-3.0-only
import type { Entity, EntityDetail, RelationWithEntity } from "../tauri";

// The renderer-neutral graph every view consumes. Daemon response shapes are
// translated into this once (here); no view reads raw relation records for
// drawing. Keeps renderers (SVG Focus now, Reagraph Atlas later) as leaves.
//
// Parallel edges: distinct relation ids with identical (source, type, target)
// intentionally stay distinct edges here — collapsing them is a view decision,
// deferred to the Atlas phase.

export type GraphNodeKind = "entity" | "memory" | "page";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  name: string;
  /** Daemon vocabulary string, verbatim (e.g. "person", "technology"). */
  entityType: string;
  /** null = unknown (matches the communityId convention below). */
  confirmed: boolean | null;
  /** Number of deduped edges touching this node in THIS model. */
  degree: number;
  /** null until wenlan-types exposes community_id on Entity. */
  communityId: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface GraphEdge {
  id: string;
  /** Semantic origin — direction is normalized so source→target is the verb's subject→object. */
  source: string;
  target: string;
  /** relation_type verb, verbatim. */
  type: string;
  /** null until wenlan-types exposes confidence on RelationWithEntity. */
  confidence: number | null;
  createdAt: number;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Honesty metadata: how many entities we actually pulled relations for. */
  coverage: { relationsFetchedFor: number; totalEntities: number };
}

// wenlan-types 0.12.0 carries neither field; read them defensively so the day
// the daemon adds them the model lights up with zero call-site changes. Never
// fabricate a value — absent stays null.
function communityIdOf(entity: Entity): number | null {
  const value = (entity as { community_id?: number | null }).community_id;
  return typeof value === "number" ? value : null;
}

function confidenceOf(rel: RelationWithEntity): number | null {
  const value = (rel as { confidence?: number | null }).confidence;
  return typeof value === "number" ? value : null;
}

function nodeFromEntity(entity: Entity): GraphNode {
  return {
    id: entity.id,
    kind: "entity",
    name: entity.name,
    entityType: entity.entity_type,
    confirmed: entity.confirmed,
    degree: 0,
    communityId: communityIdOf(entity),
    createdAt: entity.created_at,
    updatedAt: entity.updated_at,
  };
}

// A neighbor that appears only inside a relation (not in the entities list) —
// we know only what the relation record carries. confirmed is unknown here
// (null), not false: with the daemon's top-20 detail-fetch cap, synthesized
// neighbors are often real confirmed entities, and claiming false would be
// fabrication. Timestamps borrow the relation's (the entity's own are
// unavailable).
function nodeFromRelation(rel: RelationWithEntity): GraphNode {
  return {
    id: rel.entity_id,
    kind: "entity",
    name: rel.entity_name,
    entityType: rel.entity_type,
    confirmed: null,
    degree: 0,
    communityId: null,
    createdAt: rel.created_at,
    updatedAt: rel.created_at,
  };
}

// direction is relative to the home entity whose detail carried this relation.
// "incoming" means neighbor→home; "outgoing" means home→neighbor.
function edgeFromRelation(homeId: string, rel: RelationWithEntity): GraphEdge {
  const incoming = rel.direction === "incoming";
  const source = incoming ? rel.entity_id : homeId;
  const target = incoming ? homeId : rel.entity_id;
  const type = rel.relation_type;
  // A relation with no id (daemon gap) still needs a stable, non-empty id for
  // renderer keys — fall back to the same composite used to dedupe it below.
  const id = rel.id || `${source}:${type}:${target}`;
  return {
    id,
    source,
    target,
    type,
    confidence: confidenceOf(rel),
    createdAt: rel.created_at,
  };
}

/**
 * Fold a set of entities and their fetched details into one GraphModel.
 * Edges are direction-normalized and deduped; degree is computed over the
 * deduped set; neighbor-only entities are synthesized as nodes. No filtering
 * (caps / orphan-dropping) happens here — those are per-view decisions.
 */
export function buildGraphModel(entities: Entity[], details: EntityDetail[]): GraphModel {
  const nodes = new Map<string, GraphNode>();
  for (const entity of entities) nodes.set(entity.id, nodeFromEntity(entity));

  const edges = new Map<string, GraphEdge>();
  for (const detail of details) {
    const homeId = detail.entity.id;
    // The home entity should be in `entities`, but seed from the detail if not
    // so its edges always have both endpoints present.
    if (!nodes.has(homeId)) nodes.set(homeId, nodeFromEntity(detail.entity));

    for (const rel of detail.relations) {
      if (!nodes.has(rel.entity_id)) nodes.set(rel.entity_id, nodeFromRelation(rel));

      const edge = edgeFromRelation(homeId, rel);
      // Dedupe by relation id first (the same relation surfaces on both
      // endpoints' details); fall back to the endpoints+verb composite when id
      // is empty — edge.id already carries that composite, so reuse it.
      const key = rel.id ? `id:${rel.id}` : `k:${edge.id}`;
      if (!edges.has(key)) edges.set(key, edge);
    }
  }

  for (const edge of edges.values()) {
    const source = nodes.get(edge.source);
    if (source) source.degree += 1;
    const target = nodes.get(edge.target);
    if (target) target.degree += 1;
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
    coverage: { relationsFetchedFor: details.length, totalEntities: entities.length },
  };
}

/** 1-hop ego graph: the center entity plus its direct neighbors. */
export function buildEgoModel(detail: EntityDetail): GraphModel {
  return buildGraphModel([detail.entity], [detail]);
}

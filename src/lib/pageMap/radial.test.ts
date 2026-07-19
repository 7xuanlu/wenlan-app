import { describe, expect, it } from 'vitest';
import {
  findCollisions,
  radialNaive,
  radialPolar,
  type MapNodeInput,
  type PlacedNode,
} from './radial';

// Box sizes measured from the approved mockup (screen 01): root card,
// branch pills, leaf cards, ghost suggestion cards.
const ROOT = { width: 210, height: 60 };
const BRANCH = { width: 170, height: 36 };
const LEAF = { width: 230, height: 52 };
const GHOST = { width: 250, height: 76 };

let seq = 0;
const node = (
  size: { width: number; height: number },
  children?: MapNodeInput[],
): MapNodeInput => ({ id: `n${seq++}`, ...size, children });

/** 12 wide branches, one narrow child each — the council's failure case:
 * inner-ring arc per branch is smaller than the branch box itself. */
const crowdedTree = (): MapNodeInput =>
  node(
    ROOT,
    Array.from({ length: 12 }, () =>
      node(BRANCH, [node({ width: 40, height: 24 })]),
    ),
  );

/** Page-map-shaped tree: 3 branches, mixed leaf/ghost fan-outs, depth 3. */
const pageTree = (): MapNodeInput =>
  node(ROOT, [
    node(BRANCH, [node(LEAF), node(LEAF, [node(GHOST)])]),
    node(BRANCH, [node(LEAF), node(LEAF), node(GHOST)]),
    node(BRANCH, [node(LEAF, [node(LEAF), node(GHOST)])]),
  ]);

const byDepth = (placed: PlacedNode[], depth: number) =>
  placed.filter((p) => p.depth === depth);

describe('radialNaive (kept only as the documented failure)', () => {
  it('re-collides wide boxes near the center — why it is not used', () => {
    expect(findCollisions(radialNaive(crowdedTree())).length).toBeGreaterThan(
      0,
    );
  });
});

describe('radialPolar', () => {
  it('lays out the crowded tree with zero collisions', () => {
    expect(findCollisions(radialPolar(crowdedTree()))).toEqual([]);
  });

  it('grows ring 1 until the full circumference fits every branch box', () => {
    const placed = radialPolar(crowdedTree());
    const ring1 = byDepth(placed, 1);
    const r1 = Math.hypot(ring1[0].x, ring1[0].y);
    const needed = ring1.reduce((sum, p) => sum + p.width, 0);
    expect(2 * Math.PI * r1).toBeGreaterThanOrEqual(needed);
  });

  it('lays out a page-map-shaped tree with zero collisions', () => {
    expect(findCollisions(radialPolar(pageTree()))).toEqual([]);
  });

  it('survives the 0/TAU seam when spreading to a full circle', () => {
    // Few, wide children: large spread factor, so the first and last boxes
    // meet across the seam — the case a plain fill-the-circle scale breaks.
    const tree = node(
      ROOT,
      Array.from({ length: 4 }, () => node(GHOST)),
    );
    expect(findCollisions(radialPolar(tree))).toEqual([]);
  });

  it('keeps every node exactly on its depth ring', () => {
    const placed = radialPolar(pageTree());
    for (let depth = 1; depth <= 3; depth++) {
      const ring = byDepth(placed, depth);
      const radius = Math.hypot(ring[0].x, ring[0].y);
      for (const p of ring) {
        expect(Math.hypot(p.x, p.y)).toBeCloseTo(radius, 6);
      }
    }
  });

  it('preserves sibling input order as monotonic angles', () => {
    const tree = node(ROOT, [node(BRANCH), node(BRANCH), node(BRANCH)]);
    const ring1 = byDepth(radialPolar(tree), 1);
    const angles = ring1.map((p) => Math.atan2(p.y, p.x));
    const unwrapped = angles.map((a) => (a < angles[0] ? a + 2 * Math.PI : a));
    expect(unwrapped).toEqual([...unwrapped].sort((a, b) => a - b));
  });

  it('handles a root-only map', () => {
    const placed = radialPolar(node(ROOT));
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ x: 0, y: 0, depth: 0 });
  });
});

describe('findCollisions', () => {
  it('reports touching-but-not-overlapping boxes as clear', () => {
    const a = { id: 'a', x: 0, y: 0, width: 100, height: 40, depth: 1 };
    const b = { id: 'b', x: 100, y: 0, width: 100, height: 40, depth: 1 };
    expect(findCollisions([a, b])).toEqual([]);
    expect(findCollisions([a, { ...b, x: 90 }])).toEqual([['a', 'b']]);
  });
});

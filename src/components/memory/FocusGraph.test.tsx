// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Entity, EntityDetail, RelationWithEntity } from "../../lib/tauri";
import FocusGraph from "./FocusGraph";

// jsdom has no ResizeObserver; FocusGraph observes its container for the SVG
// viewBox width. The stub keeps the default width (arrowheads still render).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const KG_TOKENS = ["project", "tool", "org", "person", "concept", "neutral", "edge", "edge-strong"];

afterEach(() => {
  cleanup();
  for (const token of KG_TOKENS) document.documentElement.style.removeProperty(`--kg-${token}`);
});

function normalizeColor(value: string): string {
  const probe = document.createElement("div");
  probe.style.backgroundColor = value;
  return probe.style.backgroundColor;
}

function makeEntity(o: Partial<Entity> = {}): Entity {
  return {
    id: o.id ?? "E",
    name: o.name ?? "Origin",
    entity_type: o.entity_type ?? "concept",
    domain: null,
    space: null,
    source_agent: null,
    confidence: null,
    confirmed: o.confirmed ?? true,
    created_at: 100,
    updated_at: 200,
  };
}

function makeRel(
  o: Partial<RelationWithEntity> & { confidence?: number | null } = {},
): RelationWithEntity {
  return {
    id: o.id ?? "r1",
    relation_type: o.relation_type ?? "knows",
    direction: o.direction ?? "outgoing",
    entity_id: o.entity_id ?? "B",
    entity_name: o.entity_name ?? "Bob",
    entity_type: o.entity_type ?? "person",
    source_agent: null,
    created_at: 150,
    ...(o.confidence !== undefined ? { confidence: o.confidence } : {}),
  } as RelationWithEntity;
}

function makeDetail(entity: Entity, relations: RelationWithEntity[]): EntityDetail {
  return { entity, observations: [], relations };
}

describe("FocusGraph", () => {
  it("renders keyboard-reachable neighbor buttons for both directions", () => {
    const detail = makeDetail(makeEntity({ id: "E", name: "Origin" }), [
      makeRel({ id: "r1", direction: "outgoing", entity_id: "B", entity_name: "Bob", entity_type: "person", relation_type: "knows" }),
      makeRel({ id: "r2", direction: "incoming", entity_id: "A", entity_name: "Alice", entity_type: "project", relation_type: "created" }),
    ]);
    render(<FocusGraph detail={detail} onEntityClick={vi.fn()} />);

    const outgoing = screen.getByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    const incoming = screen.getByRole("button", { name: /Alice \(project\) · incoming · created/ });
    expect(outgoing.tagName).toBe("BUTTON");
    outgoing.focus();
    expect(outgoing).toHaveFocus();
    expect(incoming).toBeInTheDocument();
  });

  it("draws an arrowhead marker on the directed edges", () => {
    const detail = makeDetail(makeEntity({ id: "E" }), [
      makeRel({ id: "r1", direction: "outgoing", entity_id: "B" }),
    ]);
    const { container } = render(<FocusGraph detail={detail} onEntityClick={vi.fn()} />);
    expect(container.querySelector("marker")).toBeInTheDocument();
    const line = container.querySelector("line");
    expect(line).not.toBeNull();
    expect(line!.getAttribute("marker-end")).toMatch(/^url\(#focus-arrow-/);
  });

  it("labels each edge with its relation verb", () => {
    const detail = makeDetail(makeEntity({ id: "E" }), [
      makeRel({ id: "r1", direction: "outgoing", entity_id: "B", relation_type: "maintains" }),
      makeRel({ id: "r2", direction: "incoming", entity_id: "A", entity_name: "Alice", relation_type: "created" }),
    ]);
    const { container } = render(<FocusGraph detail={detail} onEntityClick={vi.fn()} />);
    const verbs = Array.from(container.querySelectorAll(".entity-graph-verb")).map((n) => n.textContent);
    expect(verbs).toContain("maintains");
    expect(verbs).toContain("created");
  });

  it("fires onEntityClick with the neighbor id", () => {
    const onEntityClick = vi.fn();
    const detail = makeDetail(makeEntity({ id: "E" }), [
      makeRel({ id: "r1", direction: "outgoing", entity_id: "B", entity_name: "Bob" }),
    ]);
    render(<FocusGraph detail={detail} onEntityClick={onEntityClick} />);
    fireEvent.click(screen.getByRole("button", { name: /Bob/ }));
    expect(onEntityClick).toHaveBeenCalledWith("B");
  });

  it("caps at 8 nodes and reports the hidden remainder", () => {
    const rels = Array.from({ length: 10 }, (_, i) =>
      makeRel({ id: `r${i}`, direction: "outgoing", entity_id: `n${i}`, entity_name: `N${i}`, relation_type: "rel" }),
    );
    render(<FocusGraph detail={makeDetail(makeEntity({ id: "E" }), rels)} onEntityClick={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(8);
    expect(screen.getByText("+2 more")).toBeInTheDocument();
  });

  it("colors a place neighbor with the neutral slot and a person with its own slot", () => {
    document.documentElement.style.setProperty("--kg-neutral", "#abcdef");
    document.documentElement.style.setProperty("--kg-person", "#654321");
    const detail = makeDetail(makeEntity({ id: "E" }), [
      makeRel({ id: "r1", direction: "outgoing", entity_id: "P", entity_name: "Paris", entity_type: "place", relation_type: "visited" }),
      makeRel({ id: "r2", direction: "outgoing", entity_id: "B", entity_name: "Bob", entity_type: "person", relation_type: "knows" }),
    ]);
    render(<FocusGraph detail={detail} onEntityClick={vi.fn()} />);

    const placeDot = screen
      .getByRole("button", { name: /Paris/ })
      .querySelector<HTMLElement>(".entity-graph-node-dot")!;
    const personDot = screen
      .getByRole("button", { name: /Bob/ })
      .querySelector<HTMLElement>(".entity-graph-node-dot")!;
    expect(placeDot.style.backgroundColor).toBe(normalizeColor("#abcdef"));
    expect(personDot.style.backgroundColor).toBe(normalizeColor("#654321"));
  });

  it("maps confidence to edge opacity when present, full opacity when null", () => {
    const withConf = makeDetail(makeEntity({ id: "E" }), [
      makeRel({ id: "r1", direction: "outgoing", entity_id: "B", confidence: 0.4 }),
    ]);
    const { container: c1 } = render(<FocusGraph detail={withConf} onEntityClick={vi.fn()} />);
    expect((c1.querySelector("line") as SVGLineElement).style.strokeOpacity).toBe("0.4");

    cleanup();

    const noConf = makeDetail(makeEntity({ id: "E" }), [
      makeRel({ id: "r1", direction: "outgoing", entity_id: "B" }),
    ]);
    const { container: c2 } = render(<FocusGraph detail={noConf} onEntityClick={vi.fn()} />);
    expect((c2.querySelector("line") as SVGLineElement).style.strokeOpacity).toBe("1");
  });
});

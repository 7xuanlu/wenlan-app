// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EntityDetail as EntityDetailType } from "../../lib/tauri";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("../../lib/tauri", () => ({
  getEntityDetail: vi.fn(),
  updateObservation: vi.fn(),
  deleteObservation: vi.fn(),
  addObservation: vi.fn(),
  confirmObservation: vi.fn(),
  confirmEntity: vi.fn(),
  deleteEntity: vi.fn(),
  search: vi.fn(() => Promise.resolve([])),
  FACET_COLORS: {},
}));

// ConstellationMap pulls in react-force-graph-2d (canvas), which jsdom can't
// render — stub it, but capture props so the overlay's wiring (highlightEntityId,
// onNodeClick) is still exercised.
vi.mock("./ConstellationMap", () => ({
  default: (props: { onNodeClick?: (id: string) => void; highlightEntityId?: string }) => (
    <div data-testid="mock-constellation-map" data-highlight={props.highlightEntityId}>
      <button type="button" onClick={() => props.onNodeClick?.("B")}>mock-node-click</button>
    </div>
  ),
}));

import { getEntityDetail } from "../../lib/tauri";
import EntityDetail from "./EntityDetail";

const mockGetEntityDetail = vi.mocked(getEntityDetail);

const detail: EntityDetailType = {
  entity: {
    id: "E",
    name: "Origin",
    entity_type: "project",
    domain: null,
    space: null,
    source_agent: null,
    confidence: null,
    confirmed: true,
    created_at: 100,
    updated_at: 200,
  },
  observations: [],
  relations: [
    { id: "r1", relation_type: "knows", direction: "outgoing", entity_id: "B", entity_name: "Bob", entity_type: "person", source_agent: null, created_at: 150 },
    { id: "r2", relation_type: "mentions", direction: "incoming", entity_id: "A", entity_name: "Alice", entity_type: "concept", source_agent: null, created_at: 150 },
  ],
};

function renderDetail(onEntityClick: (entityId: string) => void = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <EntityDetail entityId="E" onBack={vi.fn()} onEntityClick={onEntityClick} />
    </QueryClientProvider>,
  );
}

describe("EntityDetail connections card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEntityDetail.mockResolvedValue(detail);
  });

  it("renders FocusGraph neighbor buttons for the entity's relations", async () => {
    renderDetail();
    expect(
      await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Connection map for Origin" }),
    ).toBeInTheDocument();
  });

  it("keeps the relation ledger alongside the graph", async () => {
    renderDetail();
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    // The "verb →" / "← verb" arrow form is unique to the ledger rows.
    expect(screen.getByText("knows →")).toBeInTheDocument();
    expect(screen.getByText("← mentions")).toBeInTheDocument();
  });
});

describe("EntityDetail full graph overlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEntityDetail.mockResolvedValue(detail);
  });

  it("renders an expand-graph button with the i18n label", async () => {
    renderDetail();
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    expect(screen.getByRole("button", { name: "View full graph" })).toBeInTheDocument();
  });

  it("opens the full-graph dialog on click, passing the entity id as highlightEntityId", async () => {
    renderDetail();
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    fireEvent.click(screen.getByRole("button", { name: "View full graph" }));
    expect(screen.getByRole("dialog", { name: "View full graph" })).toBeInTheDocument();
    expect(screen.getByTestId("mock-constellation-map")).toHaveAttribute("data-highlight", "E");
  });

  it("closes the dialog on Escape", async () => {
    renderDetail();
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    fireEvent.click(screen.getByRole("button", { name: "View full graph" }));
    expect(screen.getByRole("dialog", { name: "View full graph" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "View full graph" })).not.toBeInTheDocument();
  });

  it("closes the dialog and forwards the clicked node id to onEntityClick", async () => {
    const onEntityClick = vi.fn();
    renderDetail(onEntityClick);
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    fireEvent.click(screen.getByRole("button", { name: "View full graph" }));
    fireEvent.click(screen.getByText("mock-node-click"));
    expect(onEntityClick).toHaveBeenCalledWith("B");
    expect(screen.queryByRole("dialog", { name: "View full graph" })).not.toBeInTheDocument();
  });
});

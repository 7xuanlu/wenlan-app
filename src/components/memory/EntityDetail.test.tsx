// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <EntityDetail entityId="E" onBack={vi.fn()} onEntityClick={vi.fn()} />
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

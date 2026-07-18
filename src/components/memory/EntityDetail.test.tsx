// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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

// AtlasView needs sigma's WebGL context that jsdom can't provide — the
// dedicated AtlasView.test.tsx exercises its internals against a sigma mock;
// here we only need to prove EntityDetail wires focusEntityId/onNodeClick
// correctly and swaps components on mode toggle.
vi.mock("./AtlasView", () => ({
  default: vi.fn((props: any) => (
    <div role="group" aria-label="atlas-view-stub" data-focus-entity-id={props.focusEntityId ?? ""}>
      <button type="button" onClick={() => props.onNodeClick?.("B")}>
        Bob node
      </button>
    </div>
  )),
}));

import { getEntityDetail, search } from "../../lib/tauri";
import EntityDetail from "./EntityDetail";

const mockGetEntityDetail = vi.mocked(getEntityDetail);
const mockSearch = vi.mocked(search);

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
    // Second edge to B — the toolbar count is distinct neighbors (2), not
    // raw relations (3).
    { id: "r3", relation_type: "cites", direction: "incoming", entity_id: "B", entity_name: "Bob", entity_type: "person", source_agent: null, created_at: 150 },
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
    expect(screen.getByRole("button", { name: "Full screen" })).toBeInTheDocument();
  });

  // FocusGraph is real here (not mocked): unlike AtlasView it's plain
  // SVG/DOM with no canvas dependency, and it's already exercised unmocked by
  // the "connections card" tests above in this same file — mocking it here
  // would also intercept that usage. The overlay renders the same FocusGraph
  // fed by the same `detail`, so both the card's and the overlay's copies are
  // in the DOM at once once the dialog is open; queries below are scoped with
  // `within(dialog)` to disambiguate, which also proves `detail` really
  // reached the overlay's FocusGraph (real neighbor buttons, not a stub).
  it("opens the full-screen dialog on click, rendering the same entity's FocusGraph", async () => {
    renderDetail();
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    const dialog = screen.getByRole("dialog", { name: "Full screen" });
    expect(within(dialog).getByRole("button", { name: /Bob \(person\) · outgoing · knows/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("group", { name: "Connection map for Origin" })).toBeInTheDocument();
  });

  it("closes the dialog on Escape", async () => {
    renderDetail();
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.getByRole("dialog", { name: "Full screen" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Full screen" })).not.toBeInTheDocument();
  });

  it("closes the dialog and forwards the clicked node id to onEntityClick", async () => {
    const onEntityClick = vi.fn();
    renderDetail(onEntityClick);
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    const dialog = screen.getByRole("dialog", { name: "Full screen" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Bob \(person\) · outgoing · knows/ }));
    expect(onEntityClick).toHaveBeenCalledWith("B");
    expect(screen.queryByRole("dialog", { name: "Full screen" })).not.toBeInTheDocument();
  });
});

describe("EntityDetail overlay mode toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEntityDetail.mockResolvedValue(detail);
    mockSearch.mockResolvedValue([]);
  });

  function openDialog() {
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    return screen.getByRole("dialog", { name: "Full screen" });
  }

  it("opens in focus mode, with the Atlas|Focus segment marking Focus active", async () => {
    renderDetail();
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    const dialog = openDialog();
    expect(within(dialog).getByRole("group", { name: "Connection map for Origin" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("group", { name: "atlas-view-stub" })).not.toBeInTheDocument();
    const seg = within(dialog).getByRole("group", { name: "Graph view" });
    expect(within(seg).getByRole("button", { name: "Focus" })).toHaveAttribute("aria-pressed", "true");
    expect(within(seg).getByRole("button", { name: "Atlas" })).toHaveAttribute("aria-pressed", "false");
  });

  it("switching the segment to Atlas shows the Atlas focused on this entity, and back to Focus", async () => {
    renderDetail();
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    const dialog = openDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Atlas" }));
    const atlasStub = within(dialog).getByRole("group", { name: "atlas-view-stub" });
    expect(atlasStub).toHaveAttribute("data-focus-entity-id", "E");
    expect(within(dialog).queryByRole("group", { name: "Connection map for Origin" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Atlas" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(dialog).getByRole("button", { name: "Focus" }));
    expect(within(dialog).getByRole("group", { name: "Connection map for Origin" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("group", { name: "atlas-view-stub" })).not.toBeInTheDocument();
  });

  it("resets to focus mode the next time the overlay is opened", async () => {
    renderDetail();
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    let dialog = openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Atlas" }));
    expect(within(dialog).getByRole("group", { name: "atlas-view-stub" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Full screen" })).not.toBeInTheDocument();

    dialog = openDialog();
    expect(within(dialog).getByRole("group", { name: "Connection map for Origin" })).toBeInTheDocument();
  });

  it("closes the dialog on Escape even while in map mode", async () => {
    renderDetail();
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Atlas" }));
    expect(within(dialog).getByRole("group", { name: "atlas-view-stub" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Full screen" })).not.toBeInTheDocument();
  });

  it("closes the dialog and forwards the clicked node id when a map-mode node is clicked", async () => {
    const onEntityClick = vi.fn();
    renderDetail(onEntityClick);
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Atlas" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Bob node" }));
    expect(onEntityClick).toHaveBeenCalledWith("B");
    expect(screen.queryByRole("dialog", { name: "Full screen" })).not.toBeInTheDocument();
  });
});

describe("EntityDetail overlay toolbar (artifact screen 02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEntityDetail.mockResolvedValue(detail);
    mockSearch.mockResolvedValue([]);
  });

  function openDialog() {
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    return screen.getByRole("dialog", { name: "Full screen" });
  }

  it("shows the crumb and the distinct-neighbor count in focus mode", async () => {
    renderDetail();
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    const dialog = openDialog();
    // Crumb: Atlas ▸ Focus: <entity>.
    expect(within(dialog).getByText("Focus: Origin")).toBeInTheDocument();
    // Two relations to two distinct entities; search returned no memories,
    // so the count line carries neighbors alone.
    expect(within(dialog).getByText("2 neighbors")).toBeInTheDocument();
  });

  it("appends the linked-memory count and renders the dot cluster when recall matches exist", async () => {
    mockSearch.mockResolvedValue([
      { id: "m1", source_id: "s1", entity_id: "E", score: 0.9, content: "memo one", memory_type: null, is_archived: false },
      { id: "m2", source_id: "s2", entity_id: "E", score: 0.8, content: "memo two", memory_type: null, is_archived: false },
    ] as any);
    renderDetail();
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    // The recall panel behind the overlay proves linkedMemories resolved.
    await screen.findByText("memo one");
    const dialog = openDialog();
    expect(within(dialog).getByText("2 neighbors · 2 memories")).toBeInTheDocument();
    expect(within(dialog).getByText("memories (2)")).toBeInTheDocument();
  });

  it("Show verbs chip toggles the verb labels off and back on", async () => {
    renderDetail();
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    const dialog = openDialog();

    expect(within(dialog).getByText("knows")).toBeInTheDocument();
    const chip = within(dialog).getByRole("button", { name: "Show verbs" });
    expect(chip).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(within(dialog).queryByText("knows")).not.toBeInTheDocument();

    fireEvent.click(chip);
    expect(within(dialog).getByText("knows")).toBeInTheDocument();
  });

  it("resets the verbs chip to on when the overlay reopens", async () => {
    renderDetail();
    await screen.findByRole("button", { name: /Bob \(person\) · outgoing · knows/ });
    let dialog = openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Show verbs" }));
    expect(within(dialog).queryByText("knows")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    dialog = openDialog();
    expect(within(dialog).getByText("knows")).toBeInTheDocument();
  });
});

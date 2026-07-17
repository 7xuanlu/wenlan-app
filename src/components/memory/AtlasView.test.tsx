// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/tauri", () => ({
  listEntities: vi.fn(),
  getEntityDetail: vi.fn(),
}));

// jsdom has no WebGL context — a real Sigma would throw trying to acquire
// one. Mocked at module level per repo convention for canvas/WebGL surfaces
// (see ConstellationMap.test.tsx's react-force-graph-2d mock); the drawn
// graph itself is verified live in preview. This test only proves the three
// states, retry, mount/teardown, and the click handoff.
const capturedSigmaInstances = vi.hoisted(() => [] as any[]);
vi.mock("sigma", () => {
  class SigmaMock {
    handlers = new Map<string, (payload: any) => void>();
    constructor(
      public graph: any,
      public container: any,
      public settings: any,
    ) {
      capturedSigmaInstances.push(this);
    }
    on(event: string, handler: (payload: any) => void) {
      this.handlers.set(event, handler);
      return this;
    }
    refresh() {}
    setSetting(_key: string, _value: unknown) {}
    kill() {}
  }
  return { default: SigmaMock };
});

import { listEntities, getEntityDetail } from "../../lib/tauri";
import AtlasView from "./AtlasView";

const mockListEntities = vi.mocked(listEntities);
const mockGetEntityDetail = vi.mocked(getEntityDetail);

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>), qc };
}

function makeEntity(overrides: Partial<import("../../lib/tauri").Entity> = {}): import("../../lib/tauri").Entity {
  return {
    id: overrides.id ?? "e1",
    name: overrides.name ?? "Entity",
    entity_type: overrides.entity_type ?? "concept",
    domain: overrides.domain ?? null,
    source_agent: overrides.source_agent ?? null,
    confidence: overrides.confidence ?? null,
    confirmed: overrides.confirmed ?? false,
    created_at: overrides.created_at ?? Date.now(),
    updated_at: overrides.updated_at ?? Date.now(),
  };
}

describe("AtlasView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSigmaInstances.length = 0;
  });

  it("shows a distinct loading state while entities are in flight, then resolves to empty", async () => {
    let resolveEntities!: (value: import("../../lib/tauri").Entity[]) => void;
    mockListEntities.mockReturnValue(
      new Promise((resolve) => {
        resolveEntities = resolve;
      }),
    );

    renderWithQuery(<AtlasView />);

    expect(await screen.findByText("Loading your knowledge graph…")).toBeInTheDocument();
    expect(screen.queryByText("Your constellation will appear as knowledge grows")).not.toBeInTheDocument();
    expect(capturedSigmaInstances).toHaveLength(0);

    resolveEntities([]);

    expect(
      await screen.findByText("Your constellation will appear as knowledge grows"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading your knowledge graph…")).not.toBeInTheDocument();
    expect(capturedSigmaInstances).toHaveLength(0);
  });

  it("renders the empty state when there are no entities", async () => {
    mockListEntities.mockResolvedValue([]);

    renderWithQuery(<AtlasView />);

    expect(
      await screen.findByText("Your constellation will appear as knowledge grows"),
    ).toBeInTheDocument();
    expect(capturedSigmaInstances).toHaveLength(0);
  });

  it("shows an error panel with retry on query failure, distinct from empty, and retry recovers", async () => {
    mockListEntities.mockRejectedValueOnce(new Error("daemon unreachable"));

    renderWithQuery(<AtlasView />);

    expect(await screen.findByText("Couldn't load your knowledge graph.")).toBeInTheDocument();
    expect(screen.queryByText("Your constellation will appear as knowledge grows")).not.toBeInTheDocument();
    expect(capturedSigmaInstances).toHaveLength(0);

    const entities = [makeEntity({ id: "e1", name: "Alice" })];
    mockListEntities.mockResolvedValueOnce(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    screen.getByRole("button", { name: "Retry" }).click();

    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
  });

  it("mounts a sigma renderer once entities and details resolve, and tears it down on unmount", async () => {
    const entities = [makeEntity({ id: "e1", name: "Alice", entity_type: "person" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });

    const { unmount } = renderWithQuery(<AtlasView />);

    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));
    const killSpy = vi.spyOn(capturedSigmaInstances[0], "kill");

    unmount();

    expect(killSpy).toHaveBeenCalledTimes(1);
  });

  it("fires onNodeClick with the sigma node id on clickNode", async () => {
    const entities = [makeEntity({ id: "e1", name: "Alice" })];
    mockListEntities.mockResolvedValue(entities);
    mockGetEntityDetail.mockResolvedValue({ entity: entities[0], observations: [], relations: [] });
    const onNodeClick = vi.fn();

    renderWithQuery(<AtlasView onNodeClick={onNodeClick} />);
    await waitFor(() => expect(capturedSigmaInstances).toHaveLength(1));

    capturedSigmaInstances[0].handlers.get("clickNode")?.({ node: "e1" });

    expect(onNodeClick).toHaveBeenCalledWith("e1");
  });
});

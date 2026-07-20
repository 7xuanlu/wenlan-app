// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PageMap, PageMapNode } from "../../lib/tauri";
import PageCanvas from "./PageCanvas";

// React Flow measures its container, and jsdom reports 0x0 — it would render
// no nodes at all. The module is faked down to "render each node through the
// registered node type", which keeps the real CanvasNode (and therefore the
// real accept/dismiss/navigate wiring) under test. Geometry is covered
// separately and without a renderer in src/lib/pageMap/tree.test.ts.
//
// The stub deliberately does NOT simulate dragging. Whether a drag tracks the
// cursor depends on React Flow's own controlled-flow contract, which a stub
// cannot re-prove — that one is verified by dragging in the running app.
// Selection is simulated, because the keyboard shortcuts are meaningless
// without it.
vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    ReactFlow: ({
      nodes,
      edges,
      nodeTypes,
      nodesDraggable,
      onNodesChange,
      onNodeDragStop,
      onNodeDoubleClick,
      onNodeContextMenu,
      onPaneContextMenu,
      onConnectEnd,
      selectionOnDrag,
      zoomOnDoubleClick,
      panOnScroll,
    }: any) => (
      <div
        data-testid="react-flow"
        data-edge-ids={edges.map((e: any) => e.id).join(",")}
        data-nodes-draggable={String(nodesDraggable)}
        // The pointer model is a set of props, so the props are what a test can
        // check. Whether the rubber band actually draws is React Flow's job.
        data-selection-on-drag={String(!!selectionOnDrag)}
        data-zoom-on-double-click={String(!!zoomOnDoubleClick)}
        data-pan-on-scroll={String(!!panOnScroll)}
      >
        <button
          aria-label="pane contextmenu"
          onClick={() =>
            onPaneContextMenu?.({
              preventDefault() {},
              clientX: 40,
              clientY: 50,
            })
          }
        />
        {nodes.map((n: any) => {
          const NodeComponent = nodeTypes[n.type];
          return (
            <div
              key={n.id}
              // The real class name, because PageCanvas's own double-click
              // handler uses `closest(".react-flow__node")` to tell a box from
              // the empty canvas behind it.
              className="react-flow__node"
              data-testid="rf-node"
              data-node-id={n.id}
              data-x={n.position?.x}
              data-y={n.position?.y}
            >
              <button
                aria-label={`contextmenu ${n.id}`}
                onClick={() =>
                  onNodeContextMenu?.(
                    { preventDefault() {}, clientX: 10, clientY: 20 },
                    n,
                  )
                }
              />
              <button
                aria-label={`doubleclick ${n.id}`}
                onClick={() => onNodeDoubleClick?.({}, n)}
              />
              {/* Releasing a connector: once over empty canvas (React Flow
                  reports the attempt as invalid), once onto another box. */}
              <button
                aria-label={`connectend empty ${n.id}`}
                onClick={() =>
                  onConnectEnd?.(
                    { clientX: 300, clientY: 400 },
                    { isValid: false, fromNode: { id: n.id } },
                  )
                }
              />
              <button
                aria-label={`connectend onto box ${n.id}`}
                onClick={() =>
                  onConnectEnd?.(
                    { clientX: 300, clientY: 400 },
                    { isValid: true, fromNode: { id: n.id } },
                  )
                }
              />
              <button
                aria-label={`drag ${n.id}`}
                onClick={() => {
                  // What a real drop does: React Flow commits the position
                  // through onNodesChange, then reports the drag ended.
                  const moved = { ...n, position: { x: 999, y: 999 } };
                  onNodesChange?.([
                    { id: n.id, type: "position", position: moved.position },
                  ]);
                  onNodeDragStop?.({}, moved);
                }}
              />
              <button
                aria-label={`select ${n.id}`}
                onClick={() =>
                  // Real React Flow emits a change for every node on a single
                  // click, deselecting the others. Emitting only the new
                  // selection would leave two boxes selected at once, which is
                  // a state the app never actually sees.
                  onNodesChange?.(
                    nodes.map((m: any) => ({
                      id: m.id,
                      type: "select",
                      selected: m.id === n.id,
                    })),
                  )
                }
              />
              <NodeComponent id={n.id} data={n.data} selected={n.selected} />
            </div>
          );
        })}
      </div>
    ),
    ReactFlowProvider: ({ children }: any) => <>{children}</>,
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
    useReactFlow: () => ({
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      // Identity is the right stub: the mapping is React Flow's, and the code
      // under test only cares that the click point comes back as flow coords.
      screenToFlowPosition: (p: { x: number; y: number }) => p,
      fitView: vi.fn(),
    }),
    useNodesState: (initial: any) => {
      const [ns, setNs] = React.useState(initial);
      const onNodesChange = React.useCallback((changes: any[]) => {
        setNs((cur: any[]) =>
          cur.map((n) => {
            const c = changes.find((ch) => ch.id === n.id);
            if (!c) return n;
            if (c.type === "select") return { ...n, selected: c.selected };
            if (c.type === "position" && c.position) return { ...n, position: c.position };
            return n;
          }),
        );
      }, []);
      return [ns, setNs, onNodesChange];
    },
  };
});

vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tauri")>()),
  getPageMap: vi.fn(),
  improvePageMap: vi.fn(),
  patchPageMapNode: vi.fn(),
  putPageMapLayout: vi.fn(),
  createPageMapNode: vi.fn(),
  deletePageMapNode: vi.fn(),
  getPage: vi.fn(),
  updatePage: vi.fn(),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

function node(o: Partial<PageMapNode> & { id: string }): PageMapNode {
  return {
    id: o.id,
    parent_id: o.parent_id ?? null,
    rank: o.rank ?? 0,
    ref_kind: o.ref_kind ?? "memory",
    ref_id: o.ref_id ?? o.id,
    label: o.label ?? null,
    status: o.status ?? "active",
    pinned: false,
    placed: false,
    collapsed: false,
    x: null,
    y: null,
    width: null,
    height: null,
    ref_state: o.ref_state ?? "live",
  };
}

function makeMap(o: Partial<PageMap> = {}): PageMap {
  return {
    page_id: "p1",
    revision: 7,
    map_schema: 1,
    viewport: null,
    nodes: [
      node({ id: "n_root", ref_kind: "page", ref_id: "p1" }),
      node({ id: "n_mem", parent_id: "n_root", rank: 0, ref_kind: "memory", ref_id: "mem_1" }),
      node({ id: "n_sug", parent_id: "n_root", rank: 1, ref_kind: "entity", ref_id: "ent_1", status: "suggested" }),
      node({ id: "n_sec", parent_id: "n_root", rank: 2, ref_kind: "section", ref_id: "sec_1", label: "Open questions" }),
      node({ id: "n_dead", parent_id: "n_root", rank: 3, ref_kind: "memory", ref_id: "mem_gone", ref_state: "dangling" }),
    ],
    edges: [
      { id: "edge_cross", from_node: "n_mem", to_node: "n_sug", kind: "link", label: null, status: "active" },
      { id: "edge_ghost", from_node: "n_mem", to_node: "n_absent", kind: "link", label: null, status: "active" },
    ],
    ...o,
  };
}

const overrides = new Map([
  ["page:p1", "Page One"],
  ["memory:mem_1", "Memory one"],
  ["entity:ent_1", "Entity one"],
  ["memory:mem_gone", "Gone memory"],
]);

const handlers = {
  onMemoryClick: vi.fn(),
  onPageClick: vi.fn(),
  onEntityClick: vi.fn(),
};

function renderCanvas() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={client}>
        <PageCanvas
          pageId="p1"
          pageTitle="Page One"
          labelOverrides={overrides}
          {...handlers}
        />
      </QueryClientProvider>,
    ),
  };
}

async function tauri() {
  return await import("../../lib/tauri");
}

const surface = () => screen.getByRole("region", { name: "Canvas for Page One" });

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("PageCanvas", () => {
  it("renders one node per live map node, resolving labels the daemon left null", async () => {
    const { getPageMap } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap());
    renderCanvas();

    expect(await screen.findByText("Page One")).toBeTruthy();
    expect(screen.getByText("Memory one")).toBeTruthy();
    expect(screen.getByText("Entity one")).toBeTruthy();
    // section nodes carry their own label and must not be overridden
    expect(screen.getByText("Open questions")).toBeTruthy();
    expect(screen.getAllByTestId("rf-node")).toHaveLength(5);
  });

  it("derives tree edges under a tree- prefix and drops cross-links with a missing endpoint", async () => {
    const { getPageMap } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap());
    renderCanvas();

    const flow = await screen.findByTestId("react-flow");
    const ids = (flow.getAttribute("data-edge-ids") ?? "").split(",");
    expect(ids).toContain("tree-n_mem");
    expect(ids).toContain("edge_cross");
    expect(ids).not.toContain("edge_ghost");
  });

  it("shows the daemon-too-old empty state when the endpoint is missing", async () => {
    const { getPageMap } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockRejectedValue(
      JSON.stringify({ status: 404, error: "no route" }),
    );
    renderCanvas();

    expect(
      await screen.findByText("Canvas needs a newer local runtime"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("offers a retry on any other load failure", async () => {
    const { getPageMap } = await tauri();
    const mock = getPageMap as ReturnType<typeof vi.fn>;
    mock.mockRejectedValue(new Error("transport died"));
    const { user } = renderCanvas();

    expect(await screen.findByText("Could not load the canvas")).toBeTruthy();
    mock.mockResolvedValue(makeMap());
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Memory one")).toBeTruthy();
  });

  it("offers Generate canvas when the page has no map yet", async () => {
    const { getPageMap, improvePageMap } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMap({ revision: 0, nodes: [], edges: [] }),
    );
    const { user } = renderCanvas();

    await user.click(await screen.findByRole("button", { name: "Generate canvas" }));
    expect(improvePageMap).toHaveBeenCalledWith("p1");
  });

  it("renders a newer map schema read-only, with every mutation control gone", async () => {
    const { getPageMap } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap({ map_schema: 2 }));
    renderCanvas();

    expect(await screen.findByText("Read-only")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Improve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add section" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    // The shortcuts are hidden too: advertising keys that do nothing is worse
    // than showing none.
    expect(screen.queryByRole("note", { name: "Canvas shortcuts" })).toBeNull();
    expect(screen.getByTestId("react-flow").getAttribute("data-nodes-draggable")).toBe("false");
  });

  it("accepts a suggestion against the map's current revision", async () => {
    const { getPageMap, patchPageMapNode } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap());
    (patchPageMapNode as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const { user } = renderCanvas();

    await user.click(await screen.findByRole("button", { name: "Accept" }));
    expect(patchPageMapNode).toHaveBeenCalledWith("p1", "n_sug", {
      base_revision: 7,
      status: "active",
    });
  });

  it("dismisses a suggestion without also navigating to it", async () => {
    const { getPageMap, patchPageMapNode } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap());
    (patchPageMapNode as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const { user } = renderCanvas();

    await user.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(patchPageMapNode).toHaveBeenCalledWith("p1", "n_sug", {
      base_revision: 7,
      status: "dismissed",
    });
    expect(handlers.onEntityClick).not.toHaveBeenCalled();
  });

  it("navigates by ref_kind, and does nothing for a section node", async () => {
    const { getPageMap } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap());
    const { user } = renderCanvas();

    await user.click(await screen.findByText("Memory one"));
    expect(handlers.onMemoryClick).toHaveBeenCalledWith("mem_1");
    await user.click(screen.getByText("Entity one"));
    expect(handlers.onEntityClick).toHaveBeenCalledWith("ent_1");
    await user.click(screen.getByText("Page One"));
    expect(handlers.onPageClick).toHaveBeenCalledWith("p1");

    await user.click(screen.getByText("Open questions"));
    expect(handlers.onMemoryClick).toHaveBeenCalledTimes(1);
    expect(handlers.onEntityClick).toHaveBeenCalledTimes(1);
    expect(handlers.onPageClick).toHaveBeenCalledTimes(1);
  });

  it("says out loud when the object behind a node is gone", async () => {
    const { getPageMap } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap());
    renderCanvas();

    expect(
      await screen.findByRole("button", {
        name: "Gone memory — what this node points at is gone",
      }),
    ).toBeTruthy();
  });

  it("recovers from a 409 by refetching and telling the user", async () => {
    const { getPageMap, patchPageMapNode } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap());
    (patchPageMapNode as ReturnType<typeof vi.fn>).mockRejectedValue(
      JSON.stringify({ status: 409, error: "revision moved" }),
    );
    const { user } = renderCanvas();

    await user.click(await screen.findByRole("button", { name: "Accept" }));
    expect(
      await screen.findByText(
        "This canvas changed somewhere else. Your last move was not saved.",
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect((getPageMap as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1),
    );
  });

  it("tells the user which keys do what", async () => {
    const { getPageMap } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap());
    renderCanvas();

    const hints = await screen.findByRole("note", { name: "Canvas shortcuts" });
    expect(hints.textContent).toContain("Tab");
    expect(hints.textContent).toContain("Add child");
    expect(hints.textContent).toContain("F2");
    expect(hints.textContent).toContain("Rename");
    // The one thing a user cannot guess: a new box is not free-floating, it
    // becomes a section of the page.
    expect(hints.textContent).toContain("New boxes become sections of the page.");
  });

  it("adds a box by writing the heading first, then pointing a node at it", async () => {
    const { getPageMap, getPage, updatePage, createPageMapNode } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap());
    (getPage as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      content: "# Page One\n\nBody.",
    });
    (updatePage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (createPageMapNode as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const { user } = renderCanvas();

    await user.click(await screen.findByRole("button", { name: "Add section" }));
    const field = await screen.findByRole("textbox", { name: "Section name" });
    await user.type(field, "Next steps{Enter}");

    // Order matters: the daemon recomputes a section's liveness from the page's
    // headings, so the heading has to land before the node that points at it.
    await waitFor(() =>
      expect(updatePage).toHaveBeenCalledWith("p1", "# Page One\n\nBody.\n\n## Next steps\n"),
    );
    await waitFor(() =>
      expect(createPageMapNode).toHaveBeenCalledWith("p1", {
        base_revision: 7,
        parent_id: "n_root",
        ref_kind: "section",
        ref_id: "p1#next-steps",
        label: "Next steps",
      }),
    );
  });

  it("refuses a name that would slugify to nothing instead of creating a dead box", async () => {
    const { getPageMap, createPageMapNode, updatePage } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap());
    const { user } = renderCanvas();

    await user.click(await screen.findByRole("button", { name: "Add section" }));
    const field = await screen.findByRole("textbox", { name: "Section name" });
    await user.type(field, "???{Enter}");

    expect(
      await screen.findByText("Give the section a name with letters or numbers in it."),
    ).toBeTruthy();
    expect(createPageMapNode).not.toHaveBeenCalled();
    expect(updatePage).not.toHaveBeenCalled();
  });

  it("adds under the selected box, not the root", async () => {
    const { getPageMap, getPage, updatePage, createPageMapNode } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap());
    (getPage as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1", content: "" });
    (updatePage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (createPageMapNode as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const { user } = renderCanvas();

    await user.click(await screen.findByRole("button", { name: "select n_sec" }));
    fireEvent.keyDown(surface(), { key: "Tab" });
    await user.type(
      await screen.findByRole("textbox", { name: "Section name" }),
      "Deeper{Enter}",
    );

    await waitFor(() =>
      expect(createPageMapNode).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ parent_id: "n_sec" }),
      ),
    );
  });

  it("renames the selected box on F2 without touching its ref", async () => {
    const { getPageMap, patchPageMapNode } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap());
    (patchPageMapNode as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const { user } = renderCanvas();

    await user.click(await screen.findByRole("button", { name: "select n_sec" }));
    fireEvent.keyDown(surface(), { key: "F2" });
    const field = await screen.findByRole("textbox", { name: "Section name" });
    await user.clear(field);
    await user.type(field, "Still open{Enter}");

    expect(patchPageMapNode).toHaveBeenCalledWith("p1", "n_sec", {
      base_revision: 7,
      label: "Still open",
    });
  });

  it("deletes the selected box, but refuses to delete the page itself", async () => {
    const { getPageMap, deletePageMapNode } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap());
    (deletePageMapNode as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const { user } = renderCanvas();

    await user.click(await screen.findByRole("button", { name: "select n_root" }));
    fireEvent.keyDown(surface(), { key: "Delete" });
    expect(
      await screen.findByText("The center box is the page itself. It can't be deleted."),
    ).toBeTruthy();
    expect(deletePageMapNode).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "select n_sec" }));
    fireEvent.keyDown(surface(), { key: "Delete" });
    await waitFor(() =>
      expect(deletePageMapNode).toHaveBeenCalledWith("p1", "n_sec", { base_revision: 7 }),
    );
  });

  it("keeps a drop that lands while the previous save is still in flight", async () => {
    const { getPageMap, putPageMapLayout } = await tauri();
    // The second read is what the daemon returns once the layout PUT landed:
    // n_sec now has a stored position. Returning a byte-identical map instead
    // would prove nothing — TanStack keeps the old object under structural
    // sharing, so no resync would happen at all and both boxes would "pass".
    const stored = makeMap({
      nodes: makeMap().nodes.map((n) =>
        n.id === "n_sec" ? { ...n, placed: true, x: 40, y: 40 } : n,
      ),
    });
    (getPageMap as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeMap())
      .mockResolvedValue(stored);
    let release: () => void = () => {};
    (putPageMapLayout as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => {
        release = () => resolve(stored);
      }),
    );
    const { user } = renderCanvas();
    await screen.findByTestId("react-flow");

    await user.click(screen.getByRole("button", { name: "drag n_sec" }));
    // The debounced PUT goes out and hangs, standing in for a slow daemon.
    await waitFor(() => expect(putPageMapLayout).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    // A second drop lands before that PUT comes back.
    await user.click(screen.getByRole("button", { name: "drag n_mem" }));
    release();

    // The refetch behind the completed save must not undo the second drop.
    // n_sec is the control: its save DID complete, so it goes back to taking
    // the server's (unplaced, radial) position rather than 999.
    await waitFor(() => {
      const flow = screen.getByTestId("react-flow");
      expect(
        flow.querySelector('[data-node-id="n_mem"]')?.getAttribute("data-x"),
      ).toBe("999");
      expect(
        flow.querySelector('[data-node-id="n_sec"]')?.getAttribute("data-x"),
      ).not.toBe("999");
    });
  });

  it("drops the draft box on Escape without writing anything", async () => {
    const { getPageMap, createPageMapNode, updatePage } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap());
    const { user } = renderCanvas();

    await user.click(await screen.findByRole("button", { name: "Add section" }));
    const field = await screen.findByRole("textbox", { name: "Section name" });
    await user.type(field, "Never mind{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Section name" })).toBeNull(),
    );
    expect(createPageMapNode).not.toHaveBeenCalled();
    expect(updatePage).not.toHaveBeenCalled();
  });
});

describe("PageCanvas direct manipulation", () => {
  // root -> branch -> leaf, so a delete has something to cascade through.
  function nestedMap(): PageMap {
    return makeMap({
      nodes: [
        node({ id: "n_root", ref_kind: "page", ref_id: "p1" }),
        node({
          id: "n_branch",
          parent_id: "n_root",
          ref_kind: "section",
          ref_id: "p1#branch",
          label: "Branch",
        }),
        node({
          id: "n_leaf",
          parent_id: "n_branch",
          ref_kind: "section",
          ref_id: "p1#leaf",
          label: "Leaf",
        }),
      ],
      edges: [],
    });
  }

  function menuItems() {
    return screen
      .getAllByRole("menuitem")
      .map((b) => b.textContent);
  }

  it("draws a box where the canvas was double-clicked", async () => {
    const { getPageMap } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap());
    const { user } = renderCanvas();
    await screen.findByTestId("react-flow");

    expect(screen.queryByLabelText("Section name")).toBeNull();
    await user.dblClick(screen.getByRole("region", { name: /Canvas for/ }));

    // The draft box is local until it is named — nothing has been created yet.
    expect(await screen.findByLabelText("Section name")).toBeTruthy();
    const { createPageMapNode } = await tauri();
    expect(createPageMapNode).not.toHaveBeenCalled();
  });

  it("renames rather than drawing when the double-click lands on a box", async () => {
    const { getPageMap } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(nestedMap());
    const { user } = renderCanvas();
    await screen.findByTestId("react-flow");

    await user.click(screen.getByLabelText("doubleclick n_leaf"));
    const field = await screen.findByLabelText("Section name");
    expect((field as HTMLInputElement).value).toBe("Leaf");
  });

  it("offers open/rename/delete on a box and only safe verbs on the canvas", async () => {
    const { getPageMap } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(nestedMap());
    const { user } = renderCanvas();
    await screen.findByTestId("react-flow");

    await user.click(screen.getByLabelText("contextmenu n_leaf"));
    expect(menuItems()).toEqual(["Add box inside", "Rename", "Delete"]);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    await user.click(screen.getByLabelText("pane contextmenu"));
    expect(menuItems()).toEqual(["New box here", "Select all", "Fit to view"]);
  });

  it("says so in the menu when deleting takes the boxes underneath too", async () => {
    const { getPageMap } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(nestedMap());
    const { user } = renderCanvas();
    await screen.findByTestId("react-flow");

    await user.click(screen.getByLabelText("contextmenu n_branch"));
    expect(menuItems()).toContain("Delete, with everything inside");
  });

  it("never offers to delete the box that is the page itself", async () => {
    const { getPageMap } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(nestedMap());
    const { user } = renderCanvas();
    await screen.findByTestId("react-flow");

    await user.click(screen.getByLabelText("contextmenu n_root"));
    const items = menuItems();
    expect(items.some((label) => label?.startsWith("Delete"))).toBe(false);
  });

  it("tombstones a subtree leaf-first, so no live box is left without a parent", async () => {
    const { getPageMap, deletePageMapNode } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(nestedMap());
    (deletePageMapNode as ReturnType<typeof vi.fn>).mockResolvedValue(
      node({ id: "n_leaf", status: "dismissed" }),
    );
    const { user } = renderCanvas();
    await screen.findByTestId("react-flow");

    await user.click(screen.getByLabelText("contextmenu n_branch"));
    await user.click(
      screen.getByRole("menuitem", { name: "Delete, with everything inside" }),
    );

    await waitFor(() =>
      expect(deletePageMapNode).toHaveBeenCalledTimes(2),
    );
    const order = (
      deletePageMapNode as ReturnType<typeof vi.fn>
    ).mock.calls.map((c: unknown[]) => c[1]);
    // The child has to go first: the daemon does not cascade, and a live box
    // whose parent is a tombstone never renders again.
    expect(order).toEqual(["n_leaf", "n_branch"]);
  });

  it("keeps double-click for drawing and hands panning to scroll", async () => {
    const { getPageMap } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(makeMap());
    renderCanvas();
    const flow = await screen.findByTestId("react-flow");

    expect(flow.getAttribute("data-selection-on-drag")).toBe("true");
    expect(flow.getAttribute("data-pan-on-scroll")).toBe("true");
    // Otherwise the canvas zooms out from under the box being drawn.
    expect(flow.getAttribute("data-zoom-on-double-click")).toBe("false");
  });


  it("grows a child where the connector was let go on empty canvas", async () => {
    const { getPageMap, getPage, updatePage, createPageMapNode } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(nestedMap());
    (getPage as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      content: "# Page One\n\nBody.",
    });
    (updatePage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (createPageMapNode as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const { user } = renderCanvas();
    await screen.findByTestId("react-flow");

    await user.click(screen.getByLabelText("connectend empty n_branch"));
    const field = await screen.findByRole("textbox", { name: "Section name" });
    await user.type(field, "Offshoot{Enter}");

    // The box hangs off the one the drag started from, not off the selection
    // and not off the page root.
    await waitFor(() =>
      expect(createPageMapNode).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ parent_id: "n_branch", label: "Offshoot" }),
      ),
    );
  });

  it("does nothing when the connector is dropped onto another box", async () => {
    const { getPageMap } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(nestedMap());
    const { user } = renderCanvas();
    await screen.findByTestId("react-flow");

    // Re-parenting by drag is deliberately not a thing yet, so a landed
    // connection must not quietly draw a box on top of the target either.
    await user.click(screen.getByLabelText("connectend onto box n_branch"));
    expect(screen.queryByRole("textbox", { name: "Section name" })).toBeNull();
  });

  it("nudges the selected box with the arrow keys", async () => {
    const { getPageMap } = await tauri();
    (getPageMap as ReturnType<typeof vi.fn>).mockResolvedValue(nestedMap());
    const { user } = renderCanvas();
    await screen.findByTestId("react-flow");

    await user.click(screen.getByLabelText("select n_leaf"));
    const before = Number(
      screen
        .getByTestId("react-flow")
        .querySelector('[data-node-id="n_leaf"]')
        ?.getAttribute("data-x"),
    );

    // Nudging with a menu open has to close it: it is anchored to a box that
    // is about to move out from under it.
    await user.click(screen.getByLabelText("contextmenu n_leaf"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("region", { name: /Canvas for/ }), {
      key: "ArrowRight",
    });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    await waitFor(() => {
      const after = Number(
        screen
          .getByTestId("react-flow")
          .querySelector('[data-node-id="n_leaf"]')
          ?.getAttribute("data-x"),
      );
      expect(after).toBe(before + 8);
    });
  });
});

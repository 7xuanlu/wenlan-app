// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SourcesView, { spineVisual, spineCaption } from "../SourcesView";
import {
  listRegisteredSources,
  openFile,
  readSourceDir,
  removeSource,
  listIndexedFiles,
  type RegisteredSource,
  type IndexedFileInfo,
} from "../../../lib/tauri";

vi.mock("../../../lib/tauri", () => ({
  listRegisteredSources: vi.fn(),
  syncRegisteredSource: vi.fn(),
  openFile: vi.fn(),
  readSourceDir: vi.fn(),
  addSource: vi.fn(),
  removeSource: vi.fn(),
  listIndexedFiles: vi.fn(),
}));

/** Minimal IndexedFileInfo for a given source id + absolute file path. */
function indexed(sourceId: string, absPath: string): IndexedFileInfo {
  return {
    source: "directory",
    source_id: `${sourceId}::${absPath}`,
    title: absPath.split("/").pop() ?? absPath,
    chunk_count: 1,
    last_modified: 1,
  };
}

const SOURCES: RegisteredSource[] = [
  { id: "a", source_type: "directory", path: "/Users/me/notes", status: "Active", last_sync: null, file_count: 3, memory_count: 12 },
  { id: "b", source_type: "obsidian", path: "/Users/me/vault", status: "Active", last_sync: null, file_count: 9, memory_count: 210 },
];

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SourcesView onManageSources={() => {}} />
    </QueryClientProvider>,
  );
}

describe("SourcesView", () => {
  beforeEach(() => {
    vi.clearAllMocks(); // isolate call history — openFile is asserted not-called
    vi.mocked(listRegisteredSources).mockResolvedValue(SOURCES);
    // Path-aware: the vault root has a `research/` subfolder; drilling into it
    // yields a distinct listing (no duplicate "research" to confuse queries).
    vi.mocked(readSourceDir).mockImplementation(async (p) =>
      String(p).endsWith("/research")
        ? [{ name: "paper.md", isDirectory: false }]
        : [
            { name: "cover.png", isDirectory: false },
            { name: "research", isDirectory: true },
            { name: "index.md", isDirectory: false },
          ],
    );
    vi.mocked(openFile).mockResolvedValue(undefined);
    // Default: the vault's supported files are all indexed, so nothing is
    // flagged in the existing tests.
    vi.mocked(listIndexedFiles).mockResolvedValue([
      indexed("b", "/Users/me/vault/index.md"),
      indexed("b", "/Users/me/vault/research/paper.md"),
    ]);
  });

  it("defaults to the source with the most memories and lists its folder, folders first", async () => {
    renderView();

    // Both sources appear on the shelf.
    expect(await screen.findByText("notes")).toBeInTheDocument();
    // vault has more memories, so it is selected: its path is read.
    expect(vi.mocked(readSourceDir)).toHaveBeenCalledWith("/Users/me/vault");

    // Entries render; the directory sorts ahead of the files.
    const research = await screen.findByText("research");
    const index = screen.getByText("index.md");
    expect(research.compareDocumentPosition(index) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("drills into a subfolder and reads the joined path", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(await screen.findByText("research"));

    expect(vi.mocked(readSourceDir)).toHaveBeenCalledWith("/Users/me/vault/research");
    // Breadcrumb now shows the subfolder segment.
    expect(await screen.findByRole("button", { name: "research" })).toBeInTheDocument();
  });

  it("opens a file on double-click via openFile", async () => {
    const user = userEvent.setup();
    renderView();

    await user.dblClick(await screen.findByText("index.md"));
    expect(vi.mocked(openFile)).toHaveBeenCalledWith("/Users/me/vault/index.md");
  });

  it("single-clicking a file selects it without opening", async () => {
    const user = userEvent.setup();
    renderView();

    const index = await screen.findByText("index.md");
    await user.click(index);
    expect(vi.mocked(openFile)).not.toHaveBeenCalled();
    expect(index.closest("button")).toHaveAttribute("data-selected", "true");
  });

  it("switching sources on the shelf reads the other source's path", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(await screen.findByText("notes"));
    expect(vi.mocked(readSourceDir)).toHaveBeenCalledWith("/Users/me/notes");
  });

  it("shows the empty-shelf state when there are no sources", async () => {
    vi.mocked(listRegisteredSources).mockResolvedValue([]);
    renderView();

    expect(await screen.findByText("Nothing on the shelf yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add your first source/i })).toBeInTheDocument();
  });

  it("marks supported extensions distinctly from unsupported ones", async () => {
    renderView();

    // .md is ingest-eligible; the extension tag renders. .png is not supported.
    const index = await screen.findByText("index.md");
    const row = index.closest("button")!;
    expect(within(row).getByText("md")).toBeInTheDocument();
  });

  it("Remove calls DELETE after confirm", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(removeSource).mockResolvedValue(undefined);
    vi.mocked(listRegisteredSources).mockResolvedValue([
      { id: "directory-books", source_type: "directory", path: "/x/Books", status: "Active", last_sync: 1, file_count: 1, memory_count: 5 },
    ]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeSource).toHaveBeenCalledWith("directory-books"));
  });
});

describe("un-indexed files", () => {
  it("flags a supported file the daemon has not indexed and counts it in the header", async () => {
    vi.mocked(listRegisteredSources).mockResolvedValue([
      { id: "directory-books", source_type: "directory", path: "/x/Books", status: "Active", last_sync: 1, file_count: 2, memory_count: 2 },
    ]);
    vi.mocked(readSourceDir).mockResolvedValue([
      { name: "readable.pdf", isDirectory: false },
      { name: "scanned.pdf", isDirectory: false },
    ]);
    // Only the readable PDF made it into the index; the scanned one was dropped.
    vi.mocked(listIndexedFiles).mockResolvedValue([
      indexed("directory-books", "/x/Books/readable.pdf"),
    ]);
    renderView();

    // The indexed file is not flagged.
    const readableRow = (await screen.findByText("readable.pdf")).closest("button")!;
    expect(within(readableRow).queryByText(/not indexed/i)).toBeNull();

    // The un-indexed file is flagged in its own row.
    const scannedRow = (await screen.findByText("scanned.pdf")).closest("button")!;
    expect(within(scannedRow).getByText(/not indexed/i)).toBeInTheDocument();

    // The header surfaces the discrepancy count.
    expect(await screen.findByText(/1 not indexed/i)).toBeInTheDocument();
  });

  it("flags nothing while the indexed-file list is still loading", async () => {
    vi.mocked(listRegisteredSources).mockResolvedValue([
      { id: "directory-books", source_type: "directory", path: "/x/Books", status: "Active", last_sync: 1, file_count: 1, memory_count: 1 },
    ]);
    vi.mocked(readSourceDir).mockResolvedValue([{ name: "a.pdf", isDirectory: false }]);
    // Never resolves — mimics the fetch still in flight.
    vi.mocked(listIndexedFiles).mockReturnValue(new Promise(() => {}));
    renderView();

    await screen.findByText("a.pdf");
    expect(screen.queryByText(/not indexed/i)).toBeNull();
  });
});

describe("folder file count", () => {
  it("shows the on-disk file count, not the daemon's stale file_count", async () => {
    // Daemon claims 2 files; the folder actually holds 3 on disk. The header
    // must reflect what's really there, not the daemon's miscount.
    vi.mocked(listRegisteredSources).mockResolvedValue([
      { id: "directory-books", source_type: "directory", path: "/x/Books", status: "Active", last_sync: 1, file_count: 2, memory_count: 2 },
    ]);
    vi.mocked(readSourceDir).mockResolvedValue([
      { name: "a.pdf", isDirectory: false },
      { name: "b.pdf", isDirectory: false },
      { name: "c.pdf", isDirectory: false },
    ]);
    renderView();

    expect(await screen.findByText(/3 files/i)).toBeInTheDocument();
    expect(screen.queryByText(/2 files/i)).toBeNull();
  });

  it("counts only files, not subfolders", async () => {
    vi.mocked(listRegisteredSources).mockResolvedValue([
      { id: "directory-books", source_type: "directory", path: "/x/Books", status: "Active", last_sync: 1, file_count: 9, memory_count: 2 },
    ]);
    vi.mocked(readSourceDir).mockResolvedValue([
      { name: "sub", isDirectory: true },
      { name: "a.pdf", isDirectory: false },
    ]);
    renderView();

    expect(await screen.findByText(/1 file/i)).toBeInTheDocument();
  });
});

describe("sync affordance by source type", () => {
  it("directory sources show auto-synced state, no manual Sync button", async () => {
    vi.mocked(listRegisteredSources).mockResolvedValue([
      { id: "directory-books", source_type: "directory", path: "/x/Books", status: "Active", last_sync: 1_700_000_000, file_count: 3, memory_count: 42 },
    ]);
    vi.mocked(readSourceDir).mockResolvedValue([]);
    renderView();

    expect(await screen.findByText(/Auto-synced/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync" })).toBeNull();
    expect(screen.getByText("Syncs in the background, even when Wenlan is closed.")).toBeInTheDocument();
  });

  it("obsidian sources keep the manual Sync button", async () => {
    vi.mocked(listRegisteredSources).mockResolvedValue([
      { id: "obsidian-vault", source_type: "obsidian", path: "/x/Vault", status: "Active", last_sync: null, file_count: 3, memory_count: 0 },
    ]);
    vi.mocked(readSourceDir).mockResolvedValue([]);
    renderView();

    expect(await screen.findByRole("button", { name: "Sync" })).toBeInTheDocument();
  });
});

const base = {
  id: "s",
  source_type: "directory" as const,
  path: "/x/Books",
  status: "Active" as const,
  file_count: 0,
};

describe("spineVisual", () => {
  it("ghost before any memories arrive", () => {
    expect(spineVisual({ ...base, last_sync: null, memory_count: 0 }, undefined)).toBe("ghost");
  });
  it("indexing while last_sync is null and memories exist", () => {
    expect(spineVisual({ ...base, last_sync: null, memory_count: 4 }, undefined)).toBe("indexing");
  });
  it("indexing while the count is still climbing between polls", () => {
    expect(spineVisual({ ...base, last_sync: 100, memory_count: 20 }, 12)).toBe("indexing");
  });
  it("settled once synced and the count is stable", () => {
    expect(spineVisual({ ...base, last_sync: 100, memory_count: 20 }, 20)).toBe("settled");
  });
});

describe("spineCaption", () => {
  it("says Indexing while settling", () => {
    expect(spineCaption({ ...base, last_sync: null, memory_count: 0 })).toBe("Indexing…");
  });
  it("shows notes when settled", () => {
    expect(spineCaption({ ...base, last_sync: 100, memory_count: 142 })).toBe("142 notes");
  });
  it("appends skipped count", () => {
    expect(spineCaption({ ...base, last_sync: 100, memory_count: 142, last_sync_errors: 2 })).toBe("142 notes, 2 skipped");
  });
});

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

/** From the Sources root, click the folder row for `name` to drill into it. */
async function openFolder(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole("button", { name: new RegExp(`^${name}`) }));
}

describe("SourcesView root", () => {
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
    vi.mocked(listIndexedFiles).mockResolvedValue([
      indexed("b", "/Users/me/vault/index.md"),
      indexed("b", "/Users/me/vault/research/paper.md"),
    ]);
  });

  it("opens on the root tree, listing each source as a folder without auto-drilling", async () => {
    renderView();

    // Both sources appear as folder rows at the root.
    expect(await screen.findByRole("button", { name: /^notes/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^vault/ })).toBeInTheDocument();
    // The root does not read into any source until one is opened.
    expect(vi.mocked(readSourceDir)).not.toHaveBeenCalledWith("/Users/me/vault");
    expect(vi.mocked(readSourceDir)).not.toHaveBeenCalledWith("/Users/me/notes");
  });

  it("drills into a source from the root and lists its folder, folders first", async () => {
    const user = userEvent.setup();
    renderView();

    await openFolder(user, "vault");
    expect(vi.mocked(readSourceDir)).toHaveBeenCalledWith("/Users/me/vault");

    const research = await screen.findByText("research");
    const index = screen.getByText("index.md");
    expect(research.compareDocumentPosition(index) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("returns to the root via the Sources breadcrumb", async () => {
    const user = userEvent.setup();
    renderView();

    await openFolder(user, "vault");
    await screen.findByText("index.md"); // inside the source now

    await user.click(await screen.findByRole("button", { name: "Sources" }));

    // Back at the root: both source folder rows are shown again.
    expect(await screen.findByRole("button", { name: /^notes/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^vault/ })).toBeInTheDocument();
  });

  it("drills into a subfolder and reads the joined path", async () => {
    const user = userEvent.setup();
    renderView();

    await openFolder(user, "vault");
    await user.click(await screen.findByText("research"));

    expect(vi.mocked(readSourceDir)).toHaveBeenCalledWith("/Users/me/vault/research");
    expect(await screen.findByRole("button", { name: "research" })).toBeInTheDocument();
  });

  it("opens a file on double-click via openFile", async () => {
    const user = userEvent.setup();
    renderView();

    await openFolder(user, "vault");
    await user.dblClick(await screen.findByText("index.md"));
    expect(vi.mocked(openFile)).toHaveBeenCalledWith("/Users/me/vault/index.md");
  });

  it("single-clicking a file selects it without opening", async () => {
    const user = userEvent.setup();
    renderView();

    await openFolder(user, "vault");
    const index = await screen.findByText("index.md");
    await user.click(index);
    expect(vi.mocked(openFile)).not.toHaveBeenCalled();
    expect(index.closest("button")).toHaveAttribute("data-selected", "true");
  });

  it("shows the empty-shelf state when there are no sources", async () => {
    vi.mocked(listRegisteredSources).mockResolvedValue([]);
    renderView();

    expect(await screen.findByText("Nothing on the shelf yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add your first source/i })).toBeInTheDocument();
  });

  it("marks supported extensions distinctly from unsupported ones", async () => {
    const user = userEvent.setup();
    renderView();

    await openFolder(user, "vault");
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
    const user = userEvent.setup();
    renderView();

    await openFolder(user, "Books");
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeSource).toHaveBeenCalledWith("directory-books"));
  });
});

describe("managed uploads at the root", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(openFile).mockResolvedValue(undefined);
    // A folder source plus the app-managed uploads dir. The managed dir holds
    // two directly-uploaded loose files.
    vi.mocked(listRegisteredSources).mockResolvedValue([
      { id: "directory-books", source_type: "directory", path: "/x/Books", status: "Active", last_sync: 1, file_count: 3, memory_count: 9 },
      { id: "directory-managed", source_type: "directory", path: "/home/u/.wenlan/sources", status: "Active", last_sync: 1, file_count: 2, memory_count: 2 },
    ]);
    vi.mocked(readSourceDir).mockImplementation(async (p) =>
      String(p).endsWith("/.wenlan/sources")
        ? [
            { name: "report.pdf", isDirectory: false },
            { name: "notes.md", isDirectory: false },
          ]
        : [{ name: "chapter1.md", isDirectory: false }],
    );
    vi.mocked(listIndexedFiles).mockResolvedValue([]);
  });

  it("shows folder sources and loose uploaded files as peers, not a 'sources' folder", async () => {
    renderView();

    // The folder source and both loose uploads share the one root list.
    expect(await screen.findByRole("button", { name: /^Books/ })).toBeInTheDocument();
    expect(await screen.findByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();

    // The managed dir itself is never rendered as a folder named "sources".
    expect(screen.queryByRole("button", { name: /^sources/ })).toBeNull();
  });

  it("opens a loose uploaded file on double-click with its managed path", async () => {
    const user = userEvent.setup();
    renderView();

    await user.dblClick(await screen.findByText("report.pdf"));
    expect(vi.mocked(openFile)).toHaveBeenCalledWith("/home/u/.wenlan/sources/report.pdf");
  });

  it("single-clicking a loose file selects it without opening", async () => {
    const user = userEvent.setup();
    renderView();

    const report = await screen.findByText("report.pdf");
    await user.click(report);
    expect(vi.mocked(openFile)).not.toHaveBeenCalled();
    expect(report.closest("button")).toHaveAttribute("data-selected", "true");
  });
});

describe("indexing files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(openFile).mockResolvedValue(undefined);
  });

  it("marks a supported file the daemon hasn't indexed yet as Indexing and counts it in the header", async () => {
    vi.mocked(listRegisteredSources).mockResolvedValue([
      { id: "directory-books", source_type: "directory", path: "/x/Books", status: "Active", last_sync: 1, file_count: 2, memory_count: 2 },
    ]);
    vi.mocked(readSourceDir).mockResolvedValue([
      { name: "readable.pdf", isDirectory: false },
      { name: "scanned.pdf", isDirectory: false },
    ]);
    // Only the readable PDF is in the index so far; the other is still pending.
    vi.mocked(listIndexedFiles).mockResolvedValue([
      indexed("directory-books", "/x/Books/readable.pdf"),
    ]);
    const user = userEvent.setup();
    renderView();
    await openFolder(user, "Books");

    // The indexed file carries no badge.
    const readableRow = (await screen.findByText("readable.pdf")).closest("button")!;
    expect(within(readableRow).queryByText(/indexing/i)).toBeNull();

    // The not-yet-indexed file reads as in-progress, not as an error.
    const scannedRow = (await screen.findByText("scanned.pdf")).closest("button")!;
    expect(within(scannedRow).getByText(/indexing/i)).toBeInTheDocument();

    // The header surfaces the in-progress count with the same calm wording.
    expect(await screen.findByText(/1 indexing/i)).toBeInTheDocument();
    // The old alarming wording is gone.
    expect(screen.queryByText(/not indexed/i)).toBeNull();
  });

  it("marks nothing while the indexed-file list is still loading", async () => {
    vi.mocked(listRegisteredSources).mockResolvedValue([
      { id: "directory-books", source_type: "directory", path: "/x/Books", status: "Active", last_sync: 1, file_count: 1, memory_count: 1 },
    ]);
    vi.mocked(readSourceDir).mockResolvedValue([{ name: "a.pdf", isDirectory: false }]);
    // Never resolves — mimics the fetch still in flight.
    vi.mocked(listIndexedFiles).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderView();
    await openFolder(user, "Books");

    const row = (await screen.findByText("a.pdf")).closest("button")!;
    expect(within(row).queryByText(/indexing/i)).toBeNull();
  });
});

describe("folder file count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listIndexedFiles).mockResolvedValue([]);
  });

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
    const user = userEvent.setup();
    renderView();
    await openFolder(user, "Books");

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
    const user = userEvent.setup();
    renderView();
    await openFolder(user, "Books");

    expect(await screen.findByText(/1 file/i)).toBeInTheDocument();
  });
});

describe("sync affordance by source type", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listIndexedFiles).mockResolvedValue([]);
    vi.mocked(readSourceDir).mockResolvedValue([]);
  });

  it("directory sources show auto-synced state, no manual Sync button", async () => {
    vi.mocked(listRegisteredSources).mockResolvedValue([
      { id: "directory-books", source_type: "directory", path: "/x/Books", status: "Active", last_sync: 1_700_000_000, file_count: 3, memory_count: 42 },
    ]);
    const user = userEvent.setup();
    renderView();
    await openFolder(user, "Books");

    expect(await screen.findByText(/Auto-synced/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync" })).toBeNull();
    expect(screen.getByText("Syncs in the background, even when Wenlan is closed.")).toBeInTheDocument();
  });

  it("obsidian sources keep the manual Sync button", async () => {
    vi.mocked(listRegisteredSources).mockResolvedValue([
      { id: "obsidian-vault", source_type: "obsidian", path: "/x/Vault", status: "Active", last_sync: null, file_count: 3, memory_count: 0 },
    ]);
    const user = userEvent.setup();
    renderView();
    await openFolder(user, "Vault");

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

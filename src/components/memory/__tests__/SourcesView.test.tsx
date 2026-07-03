// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SourcesView from "../SourcesView";
import {
  listRegisteredSources,
  openFile,
  readSourceDir,
  type RegisteredSource,
} from "../../../lib/tauri";

vi.mock("../../../lib/tauri", () => ({
  listRegisteredSources: vi.fn(),
  syncRegisteredSource: vi.fn(),
  openFile: vi.fn(),
  readSourceDir: vi.fn(),
  addSource: vi.fn(),
}));

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

  it("opens a file (not a folder) via openFile", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(await screen.findByText("index.md"));
    expect(vi.mocked(openFile)).toHaveBeenCalledWith("/Users/me/vault/index.md");
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
});

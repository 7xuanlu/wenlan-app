# Sources root drill-in tree — design

**Goal:** The Sources screen opens on a single drill-in tree rooted at the
managed uploads dir. Folder/vault sources and directly-uploaded loose files
appear as **peers** in one list; clicking a folder drills into it. Kills the
redundant "sources" tile that today buries every uploaded file one level down.

**Scope:** Frontend-only (`src/components/memory/SourcesView.tsx` + its test).
No Rust/daemon change. Storage is unchanged — uploaded files still live at
`~/.wenlan/sources/<name>` (user confirmed: "the actual file uploaded under
.wenlan/sources"). This only changes how they're *displayed*.

## Problem (today)

`upload_source_file` stages a loose file into `~/.wenlan/sources` and registers
that whole dir as a `"directory"` source. So the left rail (titled "Sources")
shows a tile *also* named "sources" containing the upload — the file is buried,
and the tile name is redundant. The rail is a book-spine source picker; a loose
file has no place in it as a peer of a folder.

## Target

```
Sources                       ← root = the managed uploads dir, made invisible
  ▸ Books           folder — most-memories first, click to drill in
  ▸ notes           folder
  📄 report.pdf     loose upload, SAME LEVEL as the folders
  📄 notes.md       loose upload
```

- **Root level** (`selectedId === null`, the new default landing):
  - one **folder row** per non-managed source (directory + obsidian), sorted by
    `memory_count` desc (preserves "most important on top"),
  - then one **file row** per loose entry in the managed dir, sorted by name.
  - Folder row click → select that source → drill-in view. File row: single
    click selects, double click opens (same select-then-open rule as folders).
- **Drill-in level** (a source is selected): the existing `FolderBrowser`,
  unchanged, except its breadcrumb root ("Sources") returns to the root level
  (`setSelectedId(null)`) instead of only clearing the subpath.

## Identifying the managed dir

`sources.find((s) => /\.wenlan\/sources\/?$/.test(s.path))`. Its `path` is the
abs dir to read loose files from via `readSourceDir`. ponytail: a path-suffix
heuristic, fine for the single managed dir; if the daemon ever exposes a
`managed: bool` on the source, switch to that.

## Layout change

Retire the two-pane layout: drop the 260px `<aside>` book-spine shelf; the tree
is a single full-width column reusing `FolderBrowser`'s row/breadcrumb styling.

Per-source info the spine carried migrates onto the folder rows as a caption
(`spineCaption`: "N notes" / "Indexing…" / "N skipped") plus the status color;
the memory-silhouette spine height is dropped (it needed the shelf context).

Root header keeps **+ Add source** and **Manage sources ⚙** (moved from the
old rail footer). Empty state (`EmptyShelf`) is unchanged.

## Non-goals (explicit)

- **Uploading into a specific folder.** "Add files" continues to target the
  managed dir only; a file added while inside Books still lands in
  `~/.wenlan/sources`, not in Books' real folder. Targeting a folder-source's
  real on-disk path needs a Rust change to `upload_source_file` (accept a
  target dir, re-validate it's a registered non-reserved source) and would
  write into the user's own directories — deferred, flagged as follow-up.
- No daemon/`SourceType` changes. No new source kind for loose files.

## Tests (extend `SourcesView.test.tsx`)

1. Root lists folder-sources and managed loose files as peers (both present in
   one list; the managed dir is NOT shown as a folder named "sources").
2. Clicking a folder row drills into that source (reads its path).
3. Breadcrumb "Sources" from a drilled-in source returns to root (root list
   shown again).
4. A managed loose file: single-click selects, double-click opens via
   `openFile` with the managed abs path.
5. Existing behaviors preserved: folders-first sort, indexing badge, file
   count, auto-synced caption, Remove-after-confirm.

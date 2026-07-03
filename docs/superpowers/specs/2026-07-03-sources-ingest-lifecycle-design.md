# Sources ingest lifecycle — daemon-native (design)

Date: 2026-07-03
Status: design, awaiting review
Scope: `wenlan-app` frontend + `app/src` Rust glue only. No backend (`7xuanlu/wenlan`) changes.

## Problem

The Sources tab lets a user register folders, but the lifecycle around them is
thin: single loose files can't be added, there is no ingest feedback, removal
punts to Settings, and the "Sync" button errors on directory sources. The
original plan assumed the **app** had to own file ingestion (extract text,
POST to the daemon, run an in-process watcher) and therefore needed an
app-managed storage location.

That assumption is **wrong**, and validating it inverted the design.

## Key finding — the daemon already owns file ingestion

Verified against the backend repo (`7xuanlu/wenlan`, HEAD `e6787221`) and the
running daemon:

- **Daemon-side folder + multi-format document ingest landed in v0.10.0**
  (`#320`, commit `4cdc4561`) — the version the app already pins.
  - `POST /api/sources {source_type:"directory", path}` registers a directory
    **or a single file** (`sources/source_routes.rs:96-110`).
  - The daemon walks the path, diffs by mtime/hash, extracts text from
    `.md/.txt/.pdf` — **server-side PDF extraction** via `pdf_extract`
    (`sources/directory.rs:399`) — and ingests derived chunks.
  - An always-on **30s scheduler** re-syncs every Directory source
    (`scheduler.rs:25`), so files dropped into a registered dir are picked up
    within ~30s with no explicit call.
- **CLI parity, app-free**: `wenlan sources add <path>` does the same over HTTP
  (`wenlan-cli/.../commands/ingest.rs`). This is the answer to "what if the
  user never installs the app" — the daemon + CLI fully cover local
  directory/file indexing without the desktop app.
- **The daemon does not store raw blobs** — it indexes files in place and
  persists only extracted text + the page projection + `(path, mtime, hash)`
  sync-state. There is no need for an app-managed blob store.

### Version drift (the only reason it looks broken today)

The **running** daemon is **0.9.5** — *before* v0.10.0 — so it registers
Directory sources but never indexes them (proof: the live `directory-books`
source is inert, `file_count: 0`, `last_sync: null`). The app's current
in-process file watcher (`app/src/indexer.rs`) exists as a **bridge** for
pre-v0.10.0 daemons. On a daemon ≥ v0.10.0 it is redundant.

Latest daemon is v0.11.0. Updating the live daemon from 0.9.5 → ≥ v0.10.0 is a
**user action** (never restart/kill the daemon on `:7878` from here). Until
then, files stage correctly but do not index.

## Design

The daemon is the single source of truth for sources. The app is a thin client
that **registers** sources with the daemon and **displays** daemon-reported
state. No app-side extraction, no app-side blob store, no parallel watcher for
new sources.

### 1. Add source — two entry points, one mechanism

Both routes end at `POST /api/sources` (the app already has this via
`api.rs` `add_source` / `AddSourceRequest`); the change is to stop diverting
directory sources to the local watcher (`add_directory_source` in `search.rs`)
and send them to the daemon like Obsidian sources already are.

- **Folder** — native directory picker → register the folder **in place**
  (e.g. `~/Documents/Books`). Not copied; it is already the user's folder.
- **Single file ("upload")** — native file picker (`{directory:false}`,
  filter `pdf/md/txt`) → **copy** the file into the stable managed dir
  (below) → ensure that dir is a registered Directory source. The 30s
  auto-sync ingests it.

### 2. Stable managed path for loose uploads

Aligned under the daemon's knowledge home, `~/.wenlan`, next to `pages/`:

```
~/.wenlan/
├── pages/                 daemon page projection (existing)
├── sources/               NEW — stable home for uploaded loose files
│   ├── .gitignore         contains "*"  → keeps binary PDFs out of git history
│   ├── 西藏生死书.pdf
│   └── paper.pdf
└── db → ~/Library/Application Support/wenlan/memorydb
```

- The app resolves the path as `home_dir()/.wenlan/sources`, mirroring the
  daemon's own `~/.wenlan` resolution (`dirs::home_dir()`).
  `ponytail:` hardcoded to `~/.wenlan`; the daemon's knowledge home can in
  principle be customized (`knowledge_path`) and is **not** exposed via any
  API today — if that becomes configurable, resolve it from the daemon then.
- `~/.wenlan/sources/` is registered **once** as a Directory source
  (id `directory-<slug>`); subsequent uploads just copy a file in.
- A self-contained `~/.wenlan/sources/.gitignore` (`*`) prevents the daemon's
  git repo from tracking uploaded blobs — no edit to the daemon's root
  `.gitignore`.

### 3. Ingest feedback (aggregate, not per-file)

Poll while a source is settling and show real numbers:

- Per source: `file_count` + `memory_count` from `GET /api/sources`.
- Global: `files_indexed` / `files_total` from `GET /api/status`.
- State: show "Indexing…" until counts stop changing; surface
  `last_sync_errors` / `last_sync_error_detail` (already on the source object)
  as a quiet "N skipped/failed" so silent skips (e.g. an image-only PDF, or a
  file over the daemon's size cap) are visible.

No per-file progress bar. Refetch faster (e.g. every ~3s) while a source
reports as syncing, back to the existing slow interval when idle.

### 4. Remove source (CRUD)

Inline "Remove source" in the FolderBrowser header → `DELETE /api/sources/{id}`
(the app already exposes `remove_source`). Confirm before removing. Stops the
tab from punting to Settings for the basic operation.

### 5. Sync button fix

The app's `sync_registered_source` (`search.rs`) hard-errors for Directory
sources (`"Only Obsidian sources support manual sync…"`). A daemon ≥ v0.10.0
does support Directory sync, and directory sources auto-sync every 30s anyway.
Fix: for directory sources, drop the manual "Sync" button and show the
auto-synced state instead; keep "Sync" for Obsidian.

### 6. Retire the app's in-process watcher (for new sources)

New directory/file sources go to the daemon, not `add_directory_source` +
`create_file_watcher`. The watcher stays only as a legacy bridge for
pre-v0.10.0 daemons; document that it is redundant on ≥ v0.10.0 and can be
removed once the minimum supported daemon is v0.10.0. `ponytail:` do not rip it
out in this slice — leave it for existing app-registered directory sources
until the daemon floor is raised.

## Data flow

```
Folder    ─ picker ─────────────► POST /api/sources {directory, <folder>}  (in place)
Loose file ─ picker ─ copy ─► ~/.wenlan/sources/ ─► (dir registered once) ─► daemon
                                                                              │
                                       daemon: walk → mtime/hash diff → PDF/text extract
                                              → ingest chunks → 30s auto-sync
                                                                              │
UI ◄── poll GET /api/sources (file_count, memory_count, last_sync_errors) ───┘
   ◄── poll GET /api/status  (files_indexed, files_total)
Remove ─────────────────────► DELETE /api/sources/{id}
```

## Constraints & caveats

- **Requires daemon ≥ v0.10.0.** On the live 0.9.5, uploads stage into
  `~/.wenlan/sources/` but do not index until the daemon is updated (user
  action; do not touch `:7878`).
- The daemon extracts `.md/.txt/.pdf` only — no docx/rtf/OCR server-side.
  The upload picker filter must match (`pdf/md/txt`).
- No blob copy for whole folders — only loose single-file uploads are copied.
- Writing into `~/.wenlan/sources/` places app-managed files inside the
  daemon's git home; the self-gitignore keeps history clean, but this is a
  deliberate boundary crossing chosen for `.wenlan` alignment per user
  preference.

## Out of scope (deferred)

- Per-file "index this / skip" choice (needs a daemon-side skip list).
- Per-file progress rows (queued→indexing→indexed→error); the daemon reports
  aggregate counts, not per-file events.
- Per-file removal / re-index from the browser.
- Removing the in-process watcher entirely (blocked on raising the daemon floor).
- Exposing the daemon's knowledge home via an API (would remove the hardcoded
  `~/.wenlan`).

## Testing

- Frontend (Vitest): upload picker registers a source via the daemon client
  (mocked); remove calls `DELETE /api/sources/{id}`; feedback renders
  `file_count`/`memory_count`/error counts from mocked `/api/sources` +
  `/api/status`; directory sources show no manual Sync button, Obsidian do.
- Rust (`cargo test`): the upload command copies into `~/.wenlan/sources/`,
  ensures the `.gitignore`, and registers the dir once (idempotent on repeat).
- Revert the 3 dev-only TEMP preview edits (`SourcesView.tsx`, `Main.tsx`,
  `UpdaterDialog.tsx`) before the implementation PR.

## Open items for review

1. Managed dir name: `~/.wenlan/sources/` vs `uploads/` vs `library/`.
2. Whether to keep the app watcher at all, or gate the whole feature on
   daemon ≥ v0.10.0 and remove it now.

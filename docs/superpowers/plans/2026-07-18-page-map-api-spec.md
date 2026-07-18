# Page Map — daemon API & data-model spec (v1)

**Status:** draft for review, 2026-07-18. Resolves the 22 Codex gap-review
items from `2026-07-18-page-map-mind-map.md` (the plan; direction, tooling,
and mockup all approved there) into buildable decisions, grounded in a
conventions recon of the daemon repo (`7xuanlu/wenlan`, file:line anchors
below are into that repo). Implementation target: `crates/wenlan-server`
(+ DTOs in `crates/wenlan-types`), migration 73.

**Grounding invariant, restated:** every map node points at a real object.
The daemon rejects refless creation; the map stores *presentation* (layout,
labels, curation state), never a second copy of knowledge.

## Data model (migration 73)

Three tables. Hierarchy is a `parent_id` spine on nodes (the flextree input);
the edges table holds only cross-links and suggested links — tree edges are
derived, not stored, so they can never dangle or contradict the spine.

```sql
-- if version < 73, appended in run_migrations() (db.rs:2728ff), then
-- PRAGMA user_version = 73. All idempotent per house style.
CREATE TABLE IF NOT EXISTS page_maps (
  page_id     TEXT PRIMARY KEY REFERENCES pages(id),
  revision    INTEGER NOT NULL DEFAULT 0,   -- monotonic, bumps on EVERY write
  map_schema  INTEGER NOT NULL DEFAULT 1,   -- payload shape version (see Compat)
  viewport    TEXT,                         -- JSON {x,y,zoom}
  generated_at TEXT,                        -- last improve-pass completion
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS page_map_nodes (
  id          TEXT PRIMARY KEY,             -- uuid v4: occurrence identity
  page_id     TEXT NOT NULL REFERENCES page_maps(page_id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES page_map_nodes(id),  -- NULL only for the root
  rank        REAL NOT NULL DEFAULT 0,      -- sibling order
  ref_kind    TEXT NOT NULL CHECK (ref_kind IN ('memory','entity','page','section')),
  ref_id      TEXT NOT NULL,                -- section: 'page_<id>#<heading-slug>'
  label       TEXT,                         -- map-local override; NULL = render from ref
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('suggested','active','dismissed')),
  pinned      INTEGER NOT NULL DEFAULT 0,   -- user touched; AI never rewrites
  placed      INTEGER NOT NULL DEFAULT 0,   -- user positioned; auto-layout skips
  collapsed   INTEGER NOT NULL DEFAULT 0,
  x REAL, y REAL, width REAL, height REAL,  -- last layout, px
  fingerprint TEXT NOT NULL,                -- see Identity below
  provenance  TEXT,                         -- JSON, suggested nodes only
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pmn_fp ON page_map_nodes(page_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_pmn_page ON page_map_nodes(page_id, status);

CREATE TABLE IF NOT EXISTS page_map_edges (
  id         TEXT PRIMARY KEY,
  page_id    TEXT NOT NULL REFERENCES page_maps(page_id) ON DELETE CASCADE,
  from_node  TEXT NOT NULL REFERENCES page_map_nodes(id) ON DELETE CASCADE,
  to_node    TEXT NOT NULL REFERENCES page_map_nodes(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'link' CHECK (kind IN ('link','suggested')),
  label      TEXT,
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('suggested','active','dismissed')),
  provenance TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  CHECK (from_node <> to_node),
  UNIQUE (page_id, from_node, to_node, kind)
);
```

Conventions matched: TEXT uuid PKs, TEXT timestamps (the `pages` family
convention — db.rs:5775-5792), `CREATE TABLE IF NOT EXISTS`, status-column
tombstones like `refinement_queue` (db.rs:2932-2941), no new tombstone table.

### Identity & tombstones (Codex #5)

- **Node id** is the *occurrence*: the same memory can appear under two
  parents as two nodes.
- **`fingerprint`** = `"{ref_kind}:{ref_id}@{parent_ref}"` where
  `parent_ref` is the parent's own `ref_kind:ref_id` (root: `"~"`). The
  unique index makes it the dedup AND tombstone key in one: an improve pass
  proposing something previously dismissed hits the same fingerprint row
  (status `dismissed`) and is skipped — a fresh uuid cannot bypass a
  tombstone. Duplicate leaves under *different* parents get different
  fingerprints and are allowed (plan's duplicate-leaf convention).
- Dismissal is `status='dismissed'` on the existing row (retained, hidden by
  default) — the daemon's status-as-tombstone idiom
  (`resolve_refinement_if_open`, db.rs:21576-21592).

### State machine (Codex #4)

`status` is the lifecycle; `pinned` is orthogonal curation; ref health is
computed, never stored:

```
suggested --accept--> active --dismiss/delete--> dismissed (tombstone)
suggested --dismiss-> dismissed (tombstone)
```

- Any user mutation on a node (accept, label edit, move with placement,
  re-rank, re-parent) sets `pinned=1`. The improve pass never modifies a row
  with `pinned=1` and never inserts a fingerprint that exists in any status.
- **`ref_state` is derived at read time** (`live` | `dangling`) by joining
  `ref_id` against its table. Deleted/merged backing objects render ghosted
  with client-side relink/remove actions (Codex #14); nothing cascades from
  content tables into the map in v1.

### Content ownership (Codex #3)

`label` is a **map-local display override**; `NULL` means "render from the
backing object" (live title/excerpt resolved at read time). The map API can
never edit a memory, entity, or page — editing knowledge happens where
knowledge lives. This is the whole grounding invariant at the storage layer.

## API surface

New `page_map_routes.rs` at the server crate root, routes registered inside
`build_router` (router.rs:14-502), handlers `handle_<verb>_<noun>`, DTOs in
`wenlan-types` (`requests.rs`/`responses.rs`). REST-ish paths under the page,
matching `/api/pages/{id}/sources|revisions` (router.rs:219-248):

| Route | Purpose |
|---|---|
| `GET /api/pages/{id}/map` | full map; `?include=dismissed` for audit |
| `PUT /api/pages/{id}/map/layout` | positions/sizes/collapsed + viewport |
| `POST /api/pages/{id}/map/nodes` | create node — `ref` REQUIRED |
| `PATCH /api/pages/{id}/map/nodes/{node_id}` | label / pinned / status / rank / parent |
| `DELETE /api/pages/{id}/map/nodes/{node_id}` | tombstones the node |
| `POST /api/pages/{id}/map/edges` | user cross-link |
| `PATCH /api/pages/{id}/map/edges/{edge_id}` | accept/dismiss/relabel |
| `DELETE /api/pages/{id}/map/edges/{edge_id}` | tombstones the edge |
| `POST /api/pages/{id}/map/improve` | on-demand AI pass, synchronous |
| `DELETE /api/pages/{id}/map` | full reset (STATED: clears tombstones too) |

Deliberate deviation, carried over from the council: accept/dismiss fold
into PATCH `status` instead of the daemon's verb-suffix routes
(`/accept|/dismiss`, router.rs:115-122, 259-266). Rationale: the existing
pair is already inconsistent (`dismiss` vs `reject`), and every extra route
is version-skew surface in a repo with no handshake.

### Concurrency (Codex #2)

- `page_maps.revision` bumps on **every** successful write. Every mutation
  request carries `base_revision`; mismatch → **409** (`ServerError::
  Conflict`), body the standard `{"error": ...}` (error.rs:51-91). Client
  recovers by refetching (GET returns current revision) and reapplying.
- Every mutation response returns `{ revision, node|edge }` (the new
  revision plus the touched row) so the client can chain edits without a
  round-trip.
- Layout writes are client-coalesced (drag-end debounce), still conditional.
  On 409 the client refetches and reapplies its drag positions — positions
  merge trivially because the dragged nodes' new x/y are the user's intent.
- Client op ids / idempotency keys: **deferred** — conditional writes make
  replays visible as 409s; revisit only if real duplicate-write bugs appear.

### Improve pass (Codex #8, #21)

- **On-demand**: `POST .../map/improve` runs synchronously and returns
  `{ revision, suggested_nodes, suggested_edges, skipped_tombstoned }`
  inline — the `/api/steep` precedent (routes.rs:670-721). No job ids; the
  daemon has no observable-job infrastructure and this spec does not invent
  one.
- **Proactive**: new `Phase::PageMaps` in the trigger-phase matrix
  (wenlan-core refinery/mod.rs:376-414), riding the existing `Idle` trigger.
  Skips pages whose `last_modified <= generated_at`. Logged via
  `log_agent_activity` like every other phase.
- **Race rule**: the pass is insert-only (suggestions) and never touches
  `pinned` rows or existing fingerprints — so "curated wins" holds by
  construction, no locking needed. Inserts still go through the revision
  bump.
- **Scheduling caps**: one page per pass iteration, most-recently-modified
  first; per-pass budget of 5 pages; nothing runs when the auto-suggest
  config flag is off.

### Auto-suggest preference (Codex #16)

`Config.page_map_auto_suggest: bool`, default `true`
(wenlan-core config.rs:34-89), persisted in `config.json`, exposed through
the existing `GET/PUT /api/config` partial-merge contract
(config_routes.rs:39-100) — a new field on `ConfigResponse` /
`UpdateConfigRequest`, NOT a new table or endpoint. Gates only
`Phase::PageMaps`; the improve endpoint stays available. Scope is global in
v1 (per-space/page scoping deferred until asked for).

### Ref types (Codex #11)

`ref_kind IN ('memory','entity','page','section')`.

- Claims ARE memories in this daemon (no claims table; recon §6), so claim
  nodes are `memory` refs.
- `section` refs anchor into the page's own content:
  `ref_id = "page_<id>#<heading-slug>"`, resolved against the compiled
  markdown at read time; a vanished heading → `dangling` like any ref.
- Citation `[n]` badges are **not** node refs: they render from the backing
  memory/page's existing evidence (`page_evidence`, db.rs:6584-6592,
  resolved by citations.rs). A first-class `evidence` ref kind is deferred —
  `page_evidence` has no single-column PK to reference today.

### Whole-map lifecycle (Codex #10)

- `GET` on a page with no map row → `200` with
  `{ revision: 0, nodes: [], edges: [] }` — never 404, never auto-creates.
- First write (user node or improve pass) creates the `page_maps` row and
  the root node (`ref_kind='page'`, ref = the page, `parent_id NULL`) in the
  same transaction.
- `revision 0` = uninitialized; `revision > 0` with only a root = user
  emptied it; dismissed-everything is visible via `?include=dismissed`.
- `DELETE .../map` is the reset escape hatch and clears tombstones — reset
  means "start clean", documented as such.

### Graph invariants (Codex #12)

Enforced in the transaction, violations → 422 (`ValidationError`):
exactly one root (`parent_id NULL`, `ref_kind='page'`); the root cannot be
deleted, dismissed, or re-parented; `parent_id` must resolve within the same
map and not create a cycle (walk-to-root check — maps are small);
edges: same-map endpoints, no self-loops (CHECK), no duplicates (UNIQUE).
Cross-link edges MAY form cycles — they are links, not hierarchy.

### Atomicity & undo (Codex #7)

Every mutation is one SQLite transaction (row + revision bump together).
The loose-text on-ramp is two client-side calls: capture-pipeline memory
creation first, then `create` with the new ref; if the second fails the
orphan is an ordinary visible memory subject to normal curation — accepted,
per the plan's on-ramp decision, not a distributed transaction. Undo/redo is
app-side state history over the CRUD ops; the daemon guarantees atomic
single operations only. (Codex #18's undo-failure UX lands with the UI.)

### Errors (Codex #17)

Standard `ServerError` mapping, no new envelope: 400 refless/malformed
create (`BadRequest`), 404 unknown page/node/edge (`NotFound`), 409 revision
conflict (`Conflict`), 422 invariant violations (`ValidationError`), 500
internal. The app distinguishes by status code; a machine-readable `code`
field is deferred until a case appears that status + context can't express.

### Compatibility & migration (Codex #1, #6)

- All DTOs in `wenlan-types`, additive-only evolution, serde default
  unknown-field tolerance (no `deny_unknown_fields` — recon §7).
- `map_schema` (in every GET response) versions the payload shape. The app
  renders maps with `map_schema <= supported`; a higher value → read-only
  banner, no writes. This is the per-feature stand-in for the repo-wide
  handshake that doesn't exist; it degrades instead of corrupting.
- Absent endpoints (older daemon) → 404/405 → the Map tab shows its
  "daemon too old" empty state. No global handshake invented here.
- Storage migration is inline migration 73 per house style; SQLite file
  backup-before-migrate and downgrade policy follow whatever the daemon
  does globally today (nothing map-specific — one feature does not get its
  own backup regime).

## Deliberately out of v1 (each with its trigger to revisit)

- **Space-level maps** (Codex #9): every route is page-keyed. Reserve
  `/api/spaces/{name}/map`; needs the bulk-relations endpoint the KG branch
  also wants. Trigger: cross-page mode gets scheduled.
- **Client op ids** (#2): trigger — observed duplicate-write bug.
- **`evidence` ref kind** (#11): trigger — `page_evidence` gains a PK.
- **Per-scope auto-suggest** (#16): trigger — a user asks.
- **Job-id/progress API for improve** (#8): trigger — the pass outgrows
  synchronous (>~2s p95 on real pages).
- **Machine-readable error codes** (#17): trigger — a UX flow needs to
  distinguish two 422s.

Frontend-side items (#18 UX matrix, #19 a11y, #20 scale budgets, #22 i18n
beyond strings) are Map-tab work and land with the UI phase, not here.

## Implementation & test plan (daemon repo)

1. Migration 73 + `db.rs` accessors (`get_page_map`, `upsert_layout`,
   `create/patch/delete node|edge`, `reset_map`) — unit tests against an
   in-memory DB: fingerprint dedup, tombstone re-proposal skip, revision
   bump on every write, root invariants, cycle rejection.
2. `page_map_routes.rs` + DTOs in `wenlan-types` — handler tests: 400/404/
   409/422 paths, base_revision round-trip, `?include=dismissed`.
3. `Phase::PageMaps` + improve pass (insert-only, pinned-row and
   fingerprint guards, budget caps) — test: pass over a fixture page
   proposes, dismissal tombstones, second pass proposes nothing.
4. Config field + `/api/config` merge test.
5. App bridge (this repo, after daemon lands): `src/lib/tauri.ts` wrappers +
   `app/src/api.rs` passthroughs, mirroring `getPageSources`.

Gates per phase: `cargo test`, `cargo fmt --check`, `cargo clippy -D
warnings` (daemon repo); the app bridge rides the normal app gates.

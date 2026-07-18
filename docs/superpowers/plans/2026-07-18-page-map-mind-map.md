# Page Map (mind map) — carve-out for its own session

**Status:** not started — deliberately excluded from the KG redesign branch
(PR #90). This file is the hand-off so a future session starts with the full
picture instead of re-deriving it.

**Design source of truth:** "Knowledge Atlas — design mockups" artifact,
screen 03 ("Page Map — AI drafts, you curate"). Screens 01 (Atlas) and
02 (Focus) shipped on `worktree-kg-foundation`.

## What screen 03 specifies

A **Map tab on every wiki page** (Read | Map | Sources), rendering the page as
a spatial outline the AI drafts and the user curates:

- Center node = the page ("Wenlan Architecture · 12 sources · updated 3d
  ago"), first-ring nodes = its sections/claims, leaves = supporting items
  with citation counts (`[n]` badges open the source).
- **A view, not a copy** — every node points at a real claim, citation,
  entity, memory, or page. No free-floating text. This is the grounding
  NotebookLM has and editable canvas tools (Xmind, Whimsical, Miro) don't.
- **Per-node ghost suggestions** — "✦ suggested · from 3 memories" nodes and
  "✦ suggested link" edges render ghosted with per-node ✓ Accept / ✕ Dismiss.
  Surveyed products only review whole maps; per-node review is Wenlan's
  review-queue DNA on a canvas.
- **Your edits are pinned** — once touched, a node is curated; AI never
  rewrites an accepted node, it only proposes new ones.
- **"✦ Improve map"** runs an on-demand AI pass (toolbar button, next to
  "Suggestions (2)" and a "Scope: this page ▾" selector).
- **Cross-page maps** reuse the same canvas at space level — hubs are pages,
  connectors are shared entities and wikilinks.
- Toolbar: Outline toggle, zoom − 100% +, suggestion count, scope selector.

## Direction fork to settle FIRST (user raised 2026-07-18)

Lucian's mental model is **an Obsidian-Canvas-style editable canvas**: the
user can create boxes, edit them, and arrange freely. The artifact's design
is **AI-drafts-then-curate**: nodes are grounded views of existing objects;
the user accepts/dismisses/pins but doesn't author free content on the map.

These pull the data model in different directions:

| | AI-drafts-curate (artifact) | Freeform canvas (Obsidian-like) |
|---|---|---|
| Node identity | pointer to claim/entity/memory/page | user-authored box (text), optionally linked |
| Persistence | map layout + accept/pin state | full node/edge/position/content documents |
| AI role | drafts + suggests, never edits pinned | assistant on top of user content |
| Grounding invariant | every node resolves to a source | broken unless enforced separately |

A hybrid is plausible (user-created nodes allowed but must link to an object,
keeping "a view, not a copy" true). Decide before any daemon work — the API
shapes below change with the answer.

## What exists today (verified on this branch, 2026-07-18)

- `getPageLinks(pageId)` — `src/lib/tauri.ts:1133`; `listOrphanLinks` at
  `:1137`. Wikilink graph data per page exists.
- Entity graph + relations (Atlas/Focus) — shipped; one renderer (sigma) for
  whole-graph, SVG for ego view.
- Accept/dismiss APIs exist **only for entity suggestions/revisions** — they
  do not cover map nodes.
- The daemon (`7xuanlu/wenlan` repo) has **no** APIs for: map persistence
  (layout, pin state), per-node suggestions, accept/dismiss of map nodes, or
  an improve-map pass. All four are prerequisites; all are daemon-repo work.

## Suggested daemon API sketch (adjust after the fork is settled)

- `get_page_map(page_id) -> { nodes, edges, layout, updated_at }` — nodes
  carry `{ id, kind: claim|entity|memory|page|section, ref_id, pinned,
  suggested, provenance }`.
- `put_page_map_layout(page_id, positions)` — user drag persistence.
- `accept_map_node(page_id, node_id)` / `dismiss_map_node(page_id, node_id)`.
- `improve_page_map(page_id, scope)` — enqueue the AI pass; suggestions land
  as `suggested: true` nodes on the next `get_page_map`.
- Freeform fork adds: `create_map_node(page_id, { content, link? })`,
  `update_map_node`, `delete_map_node` — and a decision on where free content
  lives (map doc vs a new claim).

## Frontend notes for the future session

- Renderer choice: the map is a *canvas* (boxes + orthogonal-ish edges), not
  a force graph — sigma is the wrong tool; plain absolutely-positioned
  DOM/SVG (like FocusGraph's approach) with drag handles is likely enough.
  Obsidian Canvas is DOM boxes; follow that grain.
- Reuse the artifact's visual tokens: ghost styling for suggestions
  (`--mem-indigo-bg` + dashed border), `✦` marker, per-node Accept/Dismiss
  chips, `[n]` citation badges.
- The Read | Map | Sources tab row already has a home in the page header
  (screen 03 shows it in place); check `PageDetail`'s current tab structure.
- i18n: all new copy in all three locales (`src/i18n/resources.ts`), and the
  hardcoded-copy guard will catch strays.

## Related decisions already made on the KG branch

- Timestamps: daemon delivers Unix **seconds** app-wide.
- Entity palette: validated 5-slot (`slotForEntityType`,
  `src/lib/graph/palette.ts`) — do not extend to 7 slots without re-running
  the dataviz validator.
- Top-20 detail-fetch cap in Atlas: daemon has no bulk-relations API — a
  bulk endpoint would also serve the map's cross-page mode.

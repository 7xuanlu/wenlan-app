# Page Map (mind map) — carve-out for its own session

**Status:** not started — deliberately excluded from the KG redesign branch
(PR #90). This file is the hand-off so a future session starts with the full
picture instead of re-deriving it. Tooling settled 2026-07-18 (see "Tooling
decision" below); direction fork settled 2026-07-18: **hybrid**. Next step
is the daemon API work in `7xuanlu/wenlan`.

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

## Direction fork — SETTLED 2026-07-18: hybrid

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

**Settled 2026-07-18 (Lucian, via session 57b66472): Hybrid.** User-created
nodes are allowed but must link to an existing object
(claim/entity/memory/page), keeping "a view, not a copy" true. AI drafting +
per-node accept/dismiss/pin stays as the artifact specifies, and AI never
rewrites a curated node. The daemon API therefore includes the
create/update/delete surface from day one, with `ref` required on create.

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
- Hybrid (settled): `create_map_node(page_id, { content, ref })` — `ref`
  REQUIRED (claim/entity/memory/page id); `update_map_node`,
  `delete_map_node`. Refless free content is rejected at the API boundary —
  that is where the grounding invariant is enforced.

## Tooling decision (2026-07-18) — two-agent survey, verified against npm/GitHub/docs

**Renderer: `@xyflow/react` (React Flow) 12.x.** MIT (clean with our
AGPL-3.0-only app), fully controlled nodes/edges — the arrays ARE app state,
so "every node is a pointer to a real object" holds by construction —
first-class custom React nodes (citation badges, Accept/Dismiss chips, ghost
styling), built-in drag/zoom/pan/minimap, largest community in the field
(37.7k★, daily commits). Known nit: transitive `zustand ^4` peer-dep warning
under React 19 (xyflow #5229/#4893) — cosmetic, pnpm override if noisy.

**Auto-layout: `d3-flextree`.** Purpose-built for variable-height boxes
(per-node `nodeSize` accessor), synchronous O(n) — fine at page-map scale.
WTFPL, stale since ~2018: pin it, treat as vendored. Radial arrangement is
the standard d3 x/y→angle/radius transform (documented for d3-hierarchy;
same node shape, [unverified] for flextree specifically). Fallback if maps
outgrow it: `elkjs` (active, native `mrtree`/`radial`, variable sizes; costs
~8 MB unpacked, an EPL-2.0 license election, and worker execution).

**Persistence: first-party JSON schema; skip JSON Canvas.** The v1.0 spec is
effectively closed (`text|file|link|group` nodes only, no extension
mechanism) — no room for provenance, accept/pin state, or the ghost flag.
Borrow its conventions (per-node `x/y/width/height`, edges as
`fromNode/toNode/label`) without claiming compliance.

**Fork-agnostic:** React Flow is a common base for Obsidian-Canvas-style
freeform editors AND fits the curate-only model — the renderer choice does
not constrain the direction fork either way.

Rejected:

- tldraw — proprietary license (verified against LICENSE.md); production use
  requires a paid or discretionary watermarked grant. Disqualified for an
  AGPL app.
- GoJS — commercial per-developer license. Disqualified.
- Excalidraw — MIT, but no interactive React content inside canvas elements
  (open FR excalidraw#8424); can't do badge/chip nodes.
- `@antv/g6` 5.1.1 (already in devDeps) — core active, but
  `g6-extension-react` breaks at runtime under React 19 (stale
  react-reconciler / @antv/react-g peers); imperative model besides.
- cytoscape 3.34 (already in devDeps) — canvas-rendered; HTML nodes only via
  single-maintainer plugins; imperative model.
- JointJS (`@joint/core` + `@joint/react` 4.3, MPL-2.0) — the runner-up:
  explicitly built for rich interactive HTML nodes and actively shipping,
  but the React wrapper is brand-new, state lives in its `dia.Graph` (sync
  adapter needed), and auto-layout is fully bring-your-own.
- reaflow — right shape (controlled, React nodes, elk-based layout) but no
  commits since 2025-04; adoption risk. (Not archived — a search claim of
  Jan-2026 archival was checked and is false.)
- Dedicated mind-map libs (mind-elixir, jsMind, markmap, simple-mind-map) —
  all topic-string renderers with fixed decoration schemas; none render
  arbitrary React per node. mind-elixir is healthiest but its React wrapper
  is near-dead; simple-mind-map's maintainer has moved to closed-source.

Housekeeping when the map ships: `@antv/g6` and `cytoscape` devDeps are
experiment leftovers — remove if still unused.

## Frontend notes for the future session

- Renderer choice: settled — see "Tooling decision" above. sigma remains
  wrong for this; the earlier "plain absolutely-positioned DOM/SVG is likely
  enough" note is superseded (drag/zoom/pan/minimap are exactly the wheel
  React Flow already ships). Obsidian Canvas is DOM boxes; same grain.
- Reuse the artifact's visual tokens: ghost styling for suggestions
  (`--mem-indigo-bg` + dashed border), `✦` marker, per-node Accept/Dismiss
  chips, `[n]` citation badges.
- The Read | Map | Sources tab row is **net-new UI** — checked 2026-07-18:
  `src/components/memory/PageDetail.tsx` (652 lines) has zero tab structure
  today (single Read view). Page sources data is already fetched there via
  `getPageSources`, so the Sources tab has its data wired.
- i18n: all new copy in all three locales (`src/i18n/resources.ts`), and the
  hardcoded-copy guard will catch strays.

## Related decisions already made on the KG branch

- Timestamps: daemon delivers Unix **seconds** app-wide.
- Entity palette: validated 5-slot (`slotForEntityType`,
  `src/lib/graph/palette.ts`) — do not extend to 7 slots without re-running
  the dataviz validator.
- Top-20 detail-fetch cap in Atlas: daemon has no bulk-relations API — a
  bulk endpoint would also serve the map's cross-page mode.

# Wenlan unified knowledge model — spec draft v2

**Status:** discussion draft (2026-07-18, v2). v1 (commit 4c0ea07) went through an
adversarial cross-model review — Codex gpt-5.6-sol at effort xhigh, 44 findings,
verdict *needs-more-info*. v2 folds every finding that survived triage; the
verbatim report and the per-finding disposition table live in
`2026-07-18-kg-spec-codex-review.md`. As before, this spec supersedes the
*framing* of `2026-07-18-kg-distill-council-verdict.md` — the council's
invariants and gate items survive as consequences of a smaller model.

**Goal:** one cohesive, simple model that captures every intended behavior, by
**refactoring the existing daemon** (migration-based, wire-compatible), not a
rewrite. Streamlined page creation and maintenance is the product outcome.

**Why refactor:** the code walk found the same job done by parallel mechanisms:
3 grouping systems (throwaway embedding clusters, unused label-prop
communities, the app's map heuristic), 2 scope columns (`space` overloaded
with page categories, `workspace` bolted on), 5 link stores (`relations`,
`page_sources`, `page_evidence`, `citations` JSON, `page_links`), 2 page-write
paths (the manual-edit route skips history and guards), and 3 trust fields
(`user_edited`, `creation_kind`-as-trust, `review_status`). Each collapses
into one primitive below.

**The headline change from v1:** v1's "one lineage rule" labeled edges by
their *immediate producer* (assertion/evidence/synthesis). The review showed
that label is launderable three ways — a human typo-fix promotes machine
prose, accepting a revision card promotes machine claims, an agent
re-capturing its own page output regains voting eligibility. v2 replaces it
with the **grounding rule**: eligibility is decided by *derivation ancestry*,
computed at write time and immutable — never by who touched the data last.

---

## 1. Objects — two node types, one sub-page unit, two scopes

### Memory (the evidence atom) — now with a provenance root
A captured note or a document chunk. Append-mostly. Carries: content,
embedding, `space`, `memory_type`, provenance (`author`, `origin`), and an
immutable **root** — the bottom of its derivation chain:
`document_ingest(source)` | `human_capture(event)` |
`human_edit_delta(page, edit)` | `generated(producer)`.

Roots are assigned at write time and never change. Duplicate imports,
mirrors, quoted excerpts, and re-captures of the same content resolve to the
**same canonical root** (content identity + source identity) — capturing one
thing three times is one origin, not three. The precise equivalence matrix is
Q6, needed before M2.

### Page (the readable unit) — one table, several kinds
`kind: entity | concept | source | overview | authored` (extensible).
The separate `entities` table dissolves into pages of `kind=entity`:

- **entity** — keeps entity's special behavior as columns/edges on a page
  (`entity_type`, aliases, confidence, extraction pipeline target). May be a
  **stub** (structured fields, no prose) until evidence accumulates.
- **concept** — a distilled topic page (today's `creation_kind=distilled`).
- **source** — exactly one page per ingested file, citing its own chunks
  (which are memories rooted in that file's `document_ingest`).
- **overview** — a community or space summary (absorbs SummaryRollup). An
  overview **subscribes** to its durable community id; a split/merge proposal
  carries the overview reassignment with it (Q7 has the exact rules).
- **authored** — human-created from scratch.

Page identity is durable: `id` never changes because a grouping changed.

**Claims are addressable.** The honest node count is two node types plus one
sub-page unit: a **claim** — a stable-ID'd span of a page. Claim IDs survive
regeneration (anchored during merge, §4). `supports` edges anchor claim IDs,
never raw text offsets. External resources cited by pages are URI attributes
on `cites` edges, not a third node type.

### Space (the hard fence)
Every memory and page lives in exactly one space (missing → `unfiled`).
`space` means scope and nothing else: page-category values squatting in
`pages.space` move into `kind`; `workspace` folds back into `space` and is
dropped. Nothing crosses a space fence — and the fence is enforced in the
edge schema (§2), not by query convention.

### Community (the routing unit — NOT a scope)
A persisted grouping within a space, computed over the graph (§3). Rows:
durable `community_id`, space, display name, timestamps. Assignment is
governed by the routing model in §3 (thresholds, triggers, fallback) — not
"allowed and expected" hand-waving.

---

## 2. Edges — one typed store, one grounding rule

One table replaces the **five** legacy stores (`relations`, `page_sources`,
`page_evidence`, the `citations` JSON blob, `page_links`):

```
edges(src_id, src_kind, dst_id, dst_kind, edge_type,
      lineage, grounded, root_id, space,
      weight, provenance, created_at, superseded_by, valid_until)
```

`edge_type`: `mentions` (memory→entity page), `relates` (entity↔entity),
`cites` (page→memory / page→external URI), `links` (page→page wikilink),
`supports` (claim→memory span; claim id + span locator in the edge payload).

`lineage` (`assertion` | `evidence` | `synthesis`) records the *immediate
author* — kept for display and audit. **`grounded` is the load-bearing bit**,
computed at write time from the derivation chain and then immutable:

> **The grounding rule: only edges whose derivation bottoms out in captured
> external reality vote** — in community detection, seed floors, co-citation,
> relation-confidence, and synthesis-support statistics. External means a
> document ingest or a human statement about the world. Generated output
> never becomes external, no matter how many hands it passes through.

What this closes that v1's immediate-author rule leaked (review findings 1–4):

- **Transitivity** — eligibility follows the root, not the latest writer.
- **Typo-fix laundering** — a human edit grounds only the delta the human
  typed (§5.1); untouched machine prose keeps its `generated` root.
- **Acceptance ≠ attestation** — accepting a revision card records editorial
  approval (`accepted_by_human`); claim roots stay `generated` until the
  human explicitly attests a claim (§5.2).
- **Self-recapture** — an agent capturing its own page output produces
  memories rooted in `generated(agent)`; mentions extracted from them are
  ungrounded, however ordinary the capture path looked.

Rules of the store:

- **Immutability**: `lineage`, `grounded`, `root_id` never mutate. Attestation
  adds new edges; it never rewrites old ones. The full assignment matrix
  (writer × origin × operation → lineage/root) is a required M2 artifact.
- **The fence is a constraint**: every edge carries `space`; a trigger
  enforces both endpoints in that space (sole exception: `cites` with an
  external URI target, which has no space). A pre-migration audit reports
  any legacy cross-space links.
- **Enumerated consumers**: the grounding rule governs *every*
  structure-forming statistic — community detection, seed floors,
  co-citation, relation-confidence, synthesis-support. A new
  lineage-sensitive aggregation must add itself to this list or it doesn't
  ship.
- **Legacy honesty**: edges backfilled from the five old stores whose
  provenance can't be confidently classified get `lineage=legacy`,
  `grounded=false` — non-voting until a validation pass promotes them, with
  a report of classifiable vs unknown counts.
- **Retraction exists**: `superseded_by` / `valid_until` give edges
  tombstone and supersession semantics. A retracted source's edges stop
  voting and trigger downstream invalidation (§4 staleness).

---

## 3. Grouping — where Leiden sits

**One algorithm, one persisted result, three consumers** (page routing, map
regions, overview rollups). Replaces all three of today's grouping systems.

- Runs **per space** over the grounded subgraph, with an explicit two-phase
  model (review finding 5): **a node participates in partitioning iff it has
  ≥1 grounded incident edge**. Nodes with grounded degree 0 — distilled
  pages with only synthesis edges, empty stubs — are **assigned after**
  partitioning, to the community of their strongest attachment, and cannot
  perturb the objective. Entity pages naturally participate (mention edges
  are grounded); a purely-generated page rides along, provably.
- **The projection is part of the spec, not an implementation detail.**
  Before any benchmark or library choice, the following must be written
  down: direction folding, per-edge-type weight scaling, parallel-edge
  aggregation, high-degree source-page normalization (a book's hub edges
  must not dominate), isolated-node handling, and how max-overlap rebinding
  is computed over weighted multi-membership. The benchmark runs on this
  exact projection, not an abstract graph.
- **Routing model** (replaces v1's "multi-membership is allowed and
  expected"): page↔community assignment has explicit thresholds with
  hysteresis (assign above T_hi, drop below T_lo), defined update triggers
  (new grounded edge, community rebinding, page refresh), and a
  **page-embedding fallback for entity-poor pages** (a restored council
  requirement v1 silently dropped). Assignments invalidate on rebinding.
- **Leiden** is the intended algorithm, behind the same contract as v1:
  durable community ids, old→new max-overlap rebinding, splits/merges as
  review proposals, label-propagation fallback under the same contract.
- **Gates, now executable**: the leiden-rs spike and the on-device benchmark
  get written acceptance criteria — representative graph sizes, hardware
  class, latency/memory budgets, seeding-stability requirement, pass/fail
  thresholds. "Separate dials" (invariant 12) gets two measurable metrics —
  community churn rate and correction latency — tested independently.
- The app's degree peak-climbing heuristic stays as the client-side fallback
  until the daemon ships `community_id` on the graph API, then retires.

---

## 4. Distill revamped — genesis from four signals, maintenance by routing

### Genesis: four signals, one floor

**Every signal counts independent grounded roots** (§1) — never page rows,
never memory rows. A document is one root regardless of chunk count;
generated material is zero.

1. **Evidence cluster** (community-scoped): enough un-covered grounded
   evidence inside a community → create a `concept` page.
   Floor: **≥3 independent grounded roots** (strict "captures only" variant
   remains Q2). Embedding similarity demotes to a tie-breaker within a
   community.
2. **Page-graph signal**: an orphan wikilink target referenced from ≥N pages
   **via grounded edges, from pages that themselves have grounded support**,
   with the same root-counting floor underneath → propose a page. (v1 let
   raw page counts mint pages — Sybilable by copies of one source.)
3. **Community signal**: a community above size X — size measured over
   **grounded nodes only**, overview pages and their links excluded from
   every genesis metric — with no `overview` page → create one.
4. **Space signal**: same rule at space scope.

**Genesis is transactional and idempotent**: a durable candidate table with
deterministic fingerprints (normalized orphan target; community id + scope
for overviews; root-set hash for clusters); a signal atomically claims its
evidence; partial-unique constraints prevent two signals minting competing
hubs for one scope. Every page records its genesis (signal + nodes) as
provenance.

### Maintenance: route, attach, refresh

- New memory → community assignment (§3 routing) → candidate pages ranked by
  **one relevance function**: co-citation, direct link, common-neighbor,
  kind-affinity. The co-citation term must specify its estimator (smoothed
  NPMI), a minimum-support floor, and temporal decay before any weight
  tuning — raw co-citation counts are unsafe at personal-corpus size (Q5).
- **Refresh respects the write path** (resolves v1's §4/§5 contradiction):
  refresh of a machine-owned page = LLM merge lands directly, with history;
  refresh touching a human-owned page = the merged result is **staged as a
  revision card**, never applied. Every refresh carries a **version
  precondition** — a concurrent human edit wins and the refresh re-queues.
  Claim IDs survive regeneration by anchoring during the merge.
- **Staleness is dependency-driven**: each page keeps a dependency index of
  its grounded inputs, and an invalidation matrix covers new evidence,
  source edit, source deletion, span/extraction correction, entity merge,
  edge retraction, and support-score change — any of these marks the page
  stale with a reason. (v1 had exactly one trigger: new memory attached.)
- **Frontier** (the honest version): durable per-space state — evidence with
  no or weak community assignment — scanned with age-prioritized order, a
  cursor, and a per-cycle budget. **Surfacing guarantee**: evidence that
  cannot reach the floor does not silently rot; past an age threshold it
  surfaces to the human as an unformed-topic card (create / merge /
  dismiss). Cold start in a small space is surfaced, never parked
  (invariant 4 is reworded accordingly — "always auto-discovered" was
  unsatisfiable). The space fence stays hard by design; cross-space
  *suggestion* without auto-attachment is possible future work, not in
  scope.
- **Identity dedup is a separate module from grouping**: same-entity-
  different-name is an LLM-classified, user-confirmed merge flow — never
  conflated with community detection ("related" ≠ "same").

### Truthfulness (pre-publication)

- At synthesis/merge time, compute per-claim `supports` edges — claim →
  source span — scored by an **independent entailment pass** (not the
  synthesizing model grading itself), with a threshold; below it the claim
  is unsupported.
- **Two fields, not one status** (v1 wrongly collapsed them):
  `support_status` — machine-derived, recomputed: all claims supported vs
  unsupported claims exist ⇒ **provisional**; and `human_reviewed` —
  curation: a human looked. A human can accept a page that still contains
  unsupported claims, and both facts must survive independently. Agents see
  both on every read path; publication of a synthesis is atomic with its
  support computation.

---

## 5. One write path + the authority ladder

All page writes go through one gate; the writer is a typed field
(`human | agent | pipeline(stage)`).

**Three orthogonal axes** (v1 blurred them into one ladder):

- **Prose authority** — whose text wins the page: human > machine.
- **Claim type** — what kind of statement the human made (Q3 taxonomy).
- **Voting eligibility** — grounded ancestry (§2), independent of both.

Rules:

1. A human edit **applies instantly**; the **delta the human actually wrote**
   becomes an assertion capture rooted in `human_edit_delta` (external —
   grounded); untouched machine prose keeps its `generated` root. (v1
   promoted the whole edited page to assertion — the typo-fix laundering
   hole.)
2. A machine write to human-owned prose **stages a revision card** (today's
   mechanism, kept). **Accepting the card is editorial approval only** — it
   records `accepted_by_human` and applies the text; claim roots stay
   `generated`. A separate, explicit "verify this claim" action is what adds
   a human attestation edge.
3. When a synthesis contradicts an assertion, the assertion wins the
   **prose** and the contradiction surfaces as a review item — but the
   grounded evidence **keeps voting**; prose authority never suppresses
   structure. Interim conservative rule until Q3 resolves: only human
   statements *about the world* are grounded; human edits *of machine text*
   get prose authority without voting weight.
4. Assertion-backed claims display as "stated by you", never dressed as
   document-backed evidence.
5. **Every write leaves history** — snapshot + changelog on all paths. This
   ships in **M0, immediately**, because the manual-edit route's missing
   history and citation-wiping is a live correctness bug, not a future
   feature.

---

## 6. Migration ladder (reordered: write safety first, automation last)

v1 shipped genesis/refresh before the write/truth gate — backwards; it would
have created more machine pages through the unsafe path. Fixed.

| # | Rung | Size | Unlocks |
|---|---|---|---|
| M0 | **One write gate, now**: single canonical page-write transaction — typed writer, snapshot + changelog on every path, citation preservation, version precondition. Fixes the shipped manual-route bug immediately. | S | stops active provenance loss; every later rung assumes it |
| M1 | Honest columns: page `kind`; category values out of `space`; `workspace` folds into `space` — with a **mapping/collision audit** (real spaces vs category squatters) and API adapters | M | kills the scope overload |
| M2 | Unified `edges`, staged: (a) schema expand + the lineage/root assignment matrix, (b) dual-write + parity verification, (c) reader cutover, (d) soak/reconciliation, (e) retire old stores. Backfills **all five** legacy stores; unclassifiable provenance → `legacy`/non-voting | M–L | one link truth |
| M3 | Entities → entity pages, **id-mapped**: a kept mapping table (`entity_id → page_id`) rewrites edge endpoints inside one expand-contract program; adapters translate old wire ids indefinitely. Gated on: full caller inventory (every entity SQL pattern — upserts, RETURNING, joins, pagination), one canonical entity-upsert service, a resumable migration state machine, an endpoint-by-endpoint **wire-contract freeze** (Q1 stub visibility decided here), and index acceptance criteria benchmarked on real data | L | two node types for real |
| M4 | Persisted communities under the §3 contract — gated on the written **projection spec**, the **routing spec**, and the two executable gates. App consumes `community_id`; heuristic retires | M | one grouping |
| M5 | **Claim identity + truth gate**: stable claim IDs, entailment-scored `supports`, `support_status`/`human_reviewed` split, provisional enforcement on every agent read path | M | machine writes become trustworthy |
| M6 | Distill rewired: four genesis signals + candidate table, frontier with surfacing, relevance function, LLM-merge refresh — all on top of M0's gate and M5's truth gate | L | streamlined creation |

M0 ships now. M1/M2 are safe next. M3 waits until M2 proves the edge store.
M4 waits on its gates. M5 precedes M6 — automation lands last.

---

## 7. Invariants — the behaviors this model must keep (checklist)

1. A book never mints pages from its own chapters *(root counting)*
2. ≥3 independent grounded roots before a new concept page *(floor, §4)*
3. Human prose is never silently overwritten *(ladder rule 2)*
4. **New-topic evidence is never lost and always surfaces** — auto-genesis
   when the floor is met, human surfacing when it can't be *(frontier, §4;
   reworded from v1's unsatisfiable "always discovered")*
5. Page identity durable; regroupings propose, never rename *(§1, §3)*
6. Every claim traceable; unsupported ⇒ machine-readably provisional; human
   review and machine support are **separate recorded facts** *(§4)*
7. Spaces are hard fences — **enforced in the edge schema** *(§2)*
8. One memory may support several pages *(edges are many-to-many)*
9. An edit's knowledge travels — as the human's delta *(ladder rule 1)*
10. Every write leaves history *(ladder rule 5 — ships in M0)*
11. The system never believes its own output *(the grounding rule, §2)*
12. Stability and truthfulness get separate, **measured** dials *(§3 gates)*
13. **Grounding is ancestry-decided and immutable** — no sequence of edits,
    acceptances, or re-captures promotes generated material into voting
    evidence *(§2)*

## 8. Open questions

- **Q1 — entity-page stubs on the wire:** graph-only vs listed. Now an M3
  gate item — must be decided before the wire-contract freeze.
- **Q2 — floor strictness:** ≥3 independent grounded roots with documents
  counting as one, vs captures-only. Recommend the relaxed version;
  identical machinery, one constant.
- **Q3 — human assertion taxonomy** (correction / speculation / preference /
  observation) and per-type propagation. Unresolved; §5.3 carries the
  interim conservative rule until it lands. Needed before M5 finishes.
- **Q4 — snapshot storage:** page-history table vs file snapshots.
  Recommend table.
- **Q5 — relevance-function weights:** llm_wiki ships co-citation 4.0 >
  direct link 3.0 > common-neighbor 1.5 > type-affinity 1.0; ours need
  tuning against wrong-attachment rates, and the co-citation term must fix
  estimator (smoothed NPMI), minimum support, and decay first.
- **Q6 — origin-identity matrix** *(new)*: the equivalence rules for
  canonical roots — duplicate imports, mirrors, quoted excerpts, several
  captures of one agent response. Needed before M2's assignment matrix.
- **Q7 — overview lifecycle** *(new)*: exact subscription-transfer rules for
  overviews across community splits/merges (who keeps it, when a second is
  proposed, duplicate suppression).

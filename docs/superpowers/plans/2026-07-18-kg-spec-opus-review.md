# KG unified-model spec v2 — Opus review (future-proof lens)

**Reviewer:** Claude Opus (investigator lane, effort xhigh), repo-grounded —
daemon source at `/Users/lucian/Repos/wenlan` read directly; every
load-bearing claim carries file:line evidence.
**Input:** spec v2 (commit 06bba56) + round-1 disposition table.
**Angle:** ground-truth verification of the spec's baseline claims + long-horizon
future-proofing (model swaps, scale, portability, product durability).
**Output:** 18 findings — 5 ground-truth (GT), 4 longevity (L), 6 evolution (E),
3 product (P). GT2 and GT3 overturn v2 baseline facts; both were independently
re-verified against source by the orchestrator before folding.
**Disposition:** all 18 folded into spec v3 (same date). Table below; verbatim
report follows.

| # | Severity | Disposition | Where in v3 |
|---|---|---|---|
| GT1 | baseline | accepted | "Why refactor" corrected: two trust fields, `creation_kind` is routing metadata; §4 truthfulness |
| GT2 | baseline (load-bearing) | accepted, verified against `memory_routes.rs:3405`, `db.rs:25002` | M0 rationale rewritten — foundational, not emergency; citations-reset kept as invariant |
| GT3 | baseline (load-bearing) | accepted, verified against migration 63 (`db.rs:6665`) | M1 direction reversed: scope migrates FROM `workspace` INTO `space`; residue classified |
| GT4 | baseline | accepted | "Why refactor": floor already single-sourced (`has_capture_seed_floor`) |
| GT5 | baseline | accepted | "Why refactor": staging pool is a live query with narrow seed predicate |
| L1 | high | accepted | §6.5 retention/compaction defaults (edges, history, vectors) |
| L2 | high | accepted | §6.5 history retention — delta-compressed, capped incl. protected class |
| L3 | high | accepted | §3 incrementality required; §4 entailment cache; §6.5 budgets |
| L4 | medium | accepted | §6.5 claim-ID retirement + candidate TTL |
| E1 | critical | accepted | §6.6 `embedding_model_version` everywhere; similarity state recomputable-never-durable; expand-contract for dim change |
| E2 | low | accepted | §1 `modality` attribute (default `text`) |
| E3 | medium | accepted | §6.7 single-writer declared; content-addressed roots/claim IDs as CRDT seam |
| E4 | high | accepted | §6.8 export/import round-trip; invariant #14 |
| E5 | high | accepted | §6.6 `(model_id, model_version, prompt_version)` on every stored score |
| E6 | medium | accepted | §1/§3 community identity = member-set overlap; partitioner swap = rebinding |
| P1 | high | accepted | §4 anchoring failure contract; invariant #15 |
| P2 | medium | accepted | §3 labels change only by proposal; invariant #16 |
| P3 | medium | accepted | §4 card coalescing, per-cycle cap, batched review |

---

# Future-proof review — Wenlan unified knowledge model spec v2

Reviewer: Opus, read-only, lens = FUTURE-PROOF. Ground truth = the daemon at
`/Users/lucian/Repos/wenlan` (HEAD `88fc7df1`). Every daemon claim below cites a
line I read this session. Dedup: the prior Codex review had **no repository
access** (its own closing list is "with direct repository access I would inspect
next…", review §253-266), so Section 1 is entirely new territory — Codex never
verified a single fact against source. Sections 2-4 are flagged where they sit
adjacent to a Codex finding and how they differ.

Verdict first: the model is sound and the v2 folds are real improvements, but
**three of the seven baseline facts the spec builds on are wrong or half-true in
ways that mis-order the migration** (GT1, GT2, GT3), and the model has **four
un-addressed one-way doors** that are cheap to keep open now and expensive later
(embedding-model version, LLM-score drift, multi-writer, retention). The single
most important correction: **M0's "live correctness bug / active provenance
loss" urgency is not supported by the code** — the source-citation loss is
already fixed and the citation-map reset is an intentional invariant (GT2).

---

## Section 1 — GROUND TRUTH (7 asserted facts, verified against source)

### Summary table

| # | Spec's asserted fact | Verdict | Where |
|---|---|---|---|
| 1 | Five link stores: relations, page_sources, page_evidence, citations JSON, page_links | **CONFIRMED** | db.rs:2224 / 5815 / 6584 / 6011 / 6923 |
| 2 | Manual write path skips history and wipes citations (live bug) | **HALF-TRUE → GT2** | memory_routes.rs:3405-3417; db.rs:25020, 25122-25146 |
| 3 | Three trust fields incl. `creation_kind`-as-trust | **WRONG on creation_kind → GT1** | db.rs:6608, 6633 |
| 4 | Three grouping systems (throwaway clusters, label-prop communities read only by flag-gated SummaryRollup, app heuristic) | **CONFIRMED** | db.rs:1775, 17175-17294, 12806; summary.rs:2; mod.rs:899 |
| 5 | Staging pool = live SQL view (memories with no page_evidence row) | **CONFIRMED (it is a SELECT, not a VIEW) → GT5** | db.rs:21683-21703 |
| 6 | ≥3 seed floor enforced in three places | **WRONG — one place → GT4** | db.rs:1775-1786, 1810 |
| 7 | pages.space overloaded + workspace bolted on | **CONFIRMED but migration direction is backwards → GT3** | db.rs:6665-6672, 45542 |

### GT1 — `creation_kind` is documented in source as "NOT a trust signal" (major)

The spec (intro line 21, and the §5 three-axes premise) counts three trust
fields — `user_edited`, `creation_kind`-as-trust, `review_status` — that
collapse into one authority ladder. Two of the three check out: `user_edited`
(pages CREATE, db.rs:5791) and `review_status` (migration 62, "trust boundary",
db.rs:6637-6662, CHECK IN ('unconfirmed','confirmed')). But `creation_kind` is
explicitly the opposite of a trust field in its own migration:

- db.rs:6608 — `// Migration 61: pages.creation_kind routing metadata (NOT a trust signal).`
- db.rs:6633 — log line `"Migration 61 applied: pages.creation_kind routing metadata"`.

The actual trust derivation runs the other way: `review_status` is *seeded from*
`creation_kind` at creation (`distilled→confirmed, authored/research→unconfirmed`,
db.rs:6637-6638), so `creation_kind` is an *input to* the one real trust field,
not a parallel trust field itself.

- **Scenario / why it matters:** the spec's headline is "collapse the parallel
  mechanisms." If it declares three trust fields and one of them is source-labeled
  as routing metadata, the collapse is one-third built on a mis-read. Worse, a
  reader implementing the "authority ladder" may fold `creation_kind` into
  voting/trust logic and re-introduce the exact confusion migration 61 took care
  to avoid.
- **Minimal spec change:** in intro and §5, describe two trust fields
  (`user_edited`, `review_status`), and name `creation_kind` as *routing
  metadata that seeds the initial `review_status`* — not a third trust axis.

### GT2 — M0's "citation-wiping / active provenance loss" bug is already fixed; the reset that remains is an intentional invariant (major — mis-orders the ladder)

This is the load-bearing correction. The spec makes M0 "ship now, immediately"
on the grounds that "the manual-edit route's missing history and citation-wiping
is a live correctness bug, not a future feature" (§5.5, lines 294-297; intro
line 20; M0 row "stops active provenance loss"). Against source:

1. **Sources are preserved, not wiped.** `handle_update_page` (the manual POST
   route) explicitly reads the existing sources and passes them through, with a
   comment naming the exact bug the spec claims is still live:
   memory_routes.rs:3405-3414 — *"Passing &[] here would wipe the page's source
   list, causing silent data loss"* — then calls
   `update_page_content(&id, &req.content, &existing_refs, "manual_edit")`
   (line 3415). The join table `page_sources` is reconciled, not dropped, for a
   non-empty list (db.rs:25199-25207). **So the real provenance (source_memory_ids
   + page_sources) survives a manual edit.** The data-loss bug is fixed.
2. **The `citations` reset is deliberate, not a defect.** The manual path passes
   `citations_json=None`; `try_update_page_content` binds `citations = '[]'`
   (db.rs:25020, and the UPDATE at 25132/25145). Its own contract comment
   (db.rs:25002-25005) says None *"always resets citations to '[]' on a content
   change (never leaves a stale marker-to-source map pointing at prose that no
   longer carries those markers)"* — a global correctness **invariant**, because
   the per-claim citation map is keyed to text offsets that the edit just
   invalidated. Calling this a "bug to fix in M0" inverts it; you must reset it.
3. **History:** genuinely absent on the manual path — `changelog` is only written
   by the changelog-aware variant, "called exclusively by post_write::update_page"
   (db.rs:24914-24917); the manual branch (25122-25147) never touches `changelog`.
   But `version = version + 1` and `last_modified` *are* updated on every manual
   edit (25127-25129). So "no history" means "no changelog entry," not "no
   versioning."

- **Scenario:** the reordering rationale — "M0 first because provenance is
  actively being lost" — is false. Nothing is lost today. If the team treats M0
  as an emergency it will rush a rung whose real content is narrower and
  non-urgent: add a changelog entry + a version precondition to the manual path
  (both legitimately missing — the manual path passes `expected_version=None`,
  db.rs: no CAS branch taken). That is worth doing, but it is not stopping a
  live bug.
- **Minimal spec change:** rewrite M0's justification to "the manual path lacks
  changelog history and an optimistic-version precondition" and **drop the
  "citation-wiping / active provenance loss" claim**. Note explicitly that the
  `citations='[]'` reset on content change is an invariant M0 must preserve, and
  that source links are already retained.
- **Dedup note:** Codex #17/#18 *accepted* the spec's premise (they had no
  repo) and urged shipping the fix sooner. This finding refutes the premise both
  the spec and Codex share; it is not a re-report of #18.

### GT3 — the spec's "workspace folds into space" is backwards; `space` is the polluted column, `workspace` is the authoritative page-scope (major)

Confirmed that two scope-ish columns exist and `space` is overloaded — but the
spec designates the wrong survivor. Migration 63's comment is decisive
(db.rs:6665-6672):

> `pages.workspace` — scope axis, DISTINCT from the overloaded category `space`
> column (which holds page_type recap/decision/people AND, inconsistently, the
> X-Origin-Space value). Enforced only by the scoped-recall page gate in
> `search_memory_cross_rerank_cued` … workspace = the most common non-NULL
> `space` among the page's source memories.

Two more facts: `pages.space` is itself a **rename of the old `domain` column**
(migration 50, referenced db.rs:45542) — i.e., it was never a scope column to
begin with; and `workspace` is the column the recall gate actually filters on.
So for **pages**, the trustworthy scope lives in `workspace`; `pages.space` is a
domain-rename holding page-type categories plus only an inconsistent origin
value. (On **memories**, `space` *is* the real scope — which is why workspace was
backfilled from it.)

The spec §1 (lines 72-77) says "`workspace` folds back into `space` and is
dropped" and "page-category values squatting in `pages.space` move into `kind`."
That folds the *clean* page-scope column into the *dirty* one and keeps the dirty
one as the scope of record.

- **Scenario:** M1 runs a one-way data migration in the wrong direction: it
  clears categories out of `pages.space`, treats the residue as scope, and drops
  the `workspace` column that actually carried reliable page scope. Pages whose
  `space` held only a category (no origin value) and whose scope lived solely in
  `workspace` lose their scope on the fold — a silent mis-scoping that a hard
  space fence (§2) then enforces as a wall.
- **Minimal spec change:** M1 should state that **page scope is migrated FROM
  `workspace` (authoritative) INTO the unified `space`**, that memories'
  existing `space` is the scope source of truth, and that `pages.space` values
  are *classified* (category → `kind`, origin-value → reconcile against
  `workspace`) rather than assumed to be scope. Keep the "mapping/collision
  audit" but fix its direction.
- **Dedup note:** Codex #23 flagged workspace↔space as unsafe and not size-S
  generically; this adds the specific source fact that determines which column
  survives — a different, load-bearing correction, not a repeat.

### GT4 — the ≥3 seed floor is enforced in ONE place, not three (minor)

The spec text itself is fine — §4 is titled "four signals, **one floor**" and
invariant 2 says one floor. The "three places" is a baseline-code-walk belief
(carried into this review's brief). Against source, the ≥3 capture floor lives in
exactly one function: `has_capture_seed_floor` (`const MIN_CAPTURE_SEED_MEMBERS:
usize = 3`, db.rs:1775-1786), called once, at db.rs:1810 in
`cluster_distillation_rows`. A whole-crate hunt found no second enforcement (the
other `>= minimum` sites are the *T18 bucket* floor `min_bucket_members()`,
derived_artifact_state.rs:8/28 — a different threshold for SummaryRollup, not the
capture seed floor).

- **Scenario:** if the team plans M6 around "de-duplicate the triplicated floor,"
  it will hunt for two enforcement sites that don't exist and may mistake the
  T18 bucket floor for a fourth copy.
- **Minimal spec change:** none to the spec body; correct the baseline note —
  the floor is already single-sourced at `has_capture_seed_floor`. The *new*
  work in §4 is applying one floor to **four genesis signals** (three of which
  don't exist yet), which is genuinely additive.

### GT5 — the staging pool is a live SELECT, not a `CREATE VIEW` (minor)

Semantically the spec is right — the pool is computed live from memories that
have no `page_evidence` row: `query_distillation_staging_pool` filters
`NOT EXISTS (SELECT 1 FROM page_evidence pe WHERE pe.locator = m.source_id)`
(db.rs:21700-21703), and it is not materialized. But it is an ad-hoc query, not
a SQL `VIEW` object (the only nearby `CREATE VIEW` is `memory_enrichment_summary`,
db.rs:5541, unrelated). The pool is also narrower than "memories with no
page_evidence row": it is chunk-0, `source='memory'`, non-recap, non-superseded,
non-pinned, embedded captures, and only rows with no folder content-hash and
non-folder/reconcile agent can *seed* (`can_seed_page`, db.rs:21745-21750).

- **Minimal spec change:** call it a "live query," not a "view," and note the
  seed-eligibility predicate (documents are recruited as evidence but never
  seed) — otherwise the M6 rewrite may model the pool as "all unlinked
  memories" and let documents seed pages, breaking invariant 1.

---

## Section 2 — LONGEVITY (3-year, 100k+ memories, 5k+ pages)

### L1 — nothing is bounded by default; retention/compaction language is absent (major)

Eviction is ship-dark: `eviction_enabled()` reads `WENLAN_ENABLE_EVICTION`,
default OFF (db.rs:873-874; refinery/mod.rs:1049 "Default OFF = no phase").
Memories are append-mostly via `supersede_mode` (`hide/archive/evicted`,
db.rs:2162) — superseded rows are hidden, not deleted. The spec then *adds*
edge tombstones (`superseded_by`, `valid_until`, §2) — tombstones instead of
deletion. Over three years every correction, re-extraction, and retracted source
leaves a permanent row in `memories` and `edges`, and every re-embed leaves the
vector index carrying dead vectors. The spec has **no retention, compaction, or
GC paragraph anywhere.**

- **Scenario:** a user who imports and re-imports document sets, corrects
  extractions, and lets years pass accumulates an `edges` table and vector index
  dominated by tombstoned/superseded rows. Leiden (per §3) runs over the grounded
  subgraph each cycle; even filtered, the scan cost and index size grow
  monotonically. On-device (the whole point of Wenlan) this is where it hurts.
- **Minimal spec change:** add a "Retention & compaction" subsection: define
  when tombstoned edges and archived memories are hard-deleted (e.g., after N
  supersessions or T days past `valid_until`), and require the vector index to
  be vacuumed of dead vectors on the same schedule. State that append-mostly is
  bounded by a background compaction, not unbounded.
- **Dedup note:** Codex #44 asked for tombstone *semantics to exist*; they now
  do in v2. This is the orthogonal concern #44 did not raise: that tombstones
  without a deletion horizon grow without bound.

### L2 — Q4's recommended page-history table removes the one history bound that exists today (major)

Today's history is the `changelog` column, and it is **bounded**:
`append_changelog_entry(existing, entry, cap)` FIFO-trims to `cap`
(db.rs:29737-29770; tests exercise caps of 5/10/100). The spec's Q4 recommends
"page-history table vs file snapshots — Recommend table." A snapshot-per-write
table with no stated retention is unbounded: 5k pages × years of refreshes and
edits = one row per write forever.

- **Scenario:** M0 ships "snapshot + changelog on all paths" (§5.5) onto a
  page-history table (Q4). Automated refresh (M6) then writes a snapshot on every
  staleness-driven regeneration. A single hot page (an evergreen overview) that
  refreshes on many memory arrivals accretes thousands of snapshots.
- **Minimal spec change:** if Q4 chooses the table, specify a retention policy in
  the same breath (keep last N + all human-edit snapshots, matching today's
  `edited_by` protection at db.rs:29754-29760). Note the caveat that even the
  current changelog is unbounded in *protected* (manual_edit/fs_edit) entries —
  carry that protection forward but cap it too.

### L3 — the model has no incremental-computation language; several core recomputations are whole-corpus per cycle (major)

Three costs scale badly and the spec describes each as a full recompute:

- **Leiden per space per cycle** (§3, §4 routing update triggers) — re-partition
  on new grounded edge / rebinding / refresh. At 5k pages the projection
  (direction folding, per-edge-type weights, hub normalization — all §3 to-be-
  specified) is rebuilt each time.
- **Entailment per claim per refresh** (§4 truthfulness) — an "independent
  entailment pass" per claim on every synthesis/merge. A refresh re-scores every
  claim on the page; the staleness matrix (below) multiplies refresh frequency.
- **Canonical-root identity per capture** (§1, Q6) — "content identity + source
  identity" resolution on every write to detect duplicate imports/mirrors/
  re-captures. At 100k memories this is a similarity/hash lookup on the hot path.

The spec says *what* to compute but never says *incrementally*. The daemon's own
grouping today is already incremental-ish (label-prop updates `community_id` in a
batch transaction, db.rs:17286-17294; reembed is batched, reembed.rs:11).

- **Scenario:** at year three, one new memory triggers routing → community
  rebinding candidate → Leiden re-run → N page refreshes → N×claims entailment
  passes. The per-capture latency the user feels grows with corpus size.
- **Minimal spec change:** add an "Incrementality" line to §3 and §4: Leiden must
  support warm-start/local re-optimization around the changed subgraph (not full
  re-partition); entailment scores are cached per (claim-hash, source-span-hash,
  model-version) and only recomputed on change; canonical-root resolution uses a
  content-hash index (the daemon already stores `content_hash`, db.rs:21690,
  and `entity_minhash_bands` exists) rather than a scan.

### L4 — claim IDs surviving regeneration and the genesis candidate ledger are unbounded identity stores (minor)

§1/§4 give claims stable IDs that "survive regeneration (anchored during merge)"
and §4 adds a durable genesis-candidate table with fingerprints. Both are
identity ledgers that only grow: a claim that is regenerated, dropped, and
re-formed across refreshes keeps minting/retaining IDs; dismissed genesis
candidates persist as fingerprints to suppress re-proposal. Neither has a
lifecycle.

- **Minimal spec change:** state a claim-ID GC rule (an ID retires when no
  `supports` edge references it after M consecutive regenerations) and a
  candidate-table TTL for dismissed/expired fingerprints.

---

## Section 3 — EVOLVABILITY (the one-way doors)

### E1 — (door a) embedding-model swap: stored vectors carry no model/version tag; the dimension is hardcoded (critical for a 3-year horizon)

Confirmed from source: `EMBEDDING_DIM = 768` is a hardcoded constant tied to a
named model — db.rs:527-528 *"must match the model (GTE-Base-EN-v1.5-Q = 768)"* —
and every vector column is `F32_BLOB(768)` (memories db.rs:2172, entities 2209,
pages 5785). Re-embedding is driven by a **boolean flag**, not a version compare:
`get_reembed_candidates` selects `WHERE needs_reembed = 1` (db.rs:8038-8050);
there is **no column recording which model produced a given embedding**
(reembed.rs:2-3 aspirationally says "stale model/version" but the schema has no
such field).

Consequences the spec ignores while treating embeddings as swappable:
- You cannot tell an old-model vector from a new-model one, so during any
  migration window similarity silently mixes model generations — corrupting
  co-citation, the §4 relevance function, staging clusters, and any
  embedding-fallback routing (§3).
- A model with a different dimension forces a schema migration of every
  `F32_BLOB(768)` column plus a full vector-index rebuild — a hard one-way door.
- The spec's §3 already recomputes communities each cycle (good — communities are
  *not* treated as durable), but it does treat page/entity/memory embeddings and
  the similarity-derived relevance weights as durable stored state.

- **Minimal spec change (one paragraph):** add an `embedding_model_version`
  column to every table holding a vector; make all similarity-derived state
  (co-citation cache, relevance weights, staging clusters, community input)
  keyed by that version and **defined as recomputable, never durable**; and state
  that a dimension change is an expand-contract vector migration, not an
  in-place ALTER. This keeps the door open at near-zero cost now.
- **Dedup note:** Codex never touched embeddings (no repo access); not in the 44.

### E2 — (door b) new modalities: the memory atom and root taxonomy are text-shaped (major)

The memory atom is content + a 768-dim *text* embedding + `chunk_index`
(db.rs:21693 filters `chunk_index = 0` for captures; the chunker is prose-
oriented). The §1 root taxonomy (`document_ingest | human_capture |
human_edit_delta | generated`) and page `kind`s (entity/concept/source/overview/
authored) have no slot for a non-text modality. An image/audio memory has no
text to embed, no chunk-0 semantics, and a source page "citing its own chunks"
assumes text chunks.

- **Scenario:** adding image memories later requires a modality axis threaded
  through the pool query, the seed floor (is an image a "capture"?), the
  embedding space (cross-modal vs separate index), and `page_evidence.source_kind`
  (which today is `memory/external_url/external_file/authored`, db.rs:6586).
  Retrofitting a modality column across all of that is the expensive version.
- **Minimal spec change:** add a `modality` attribute to the memory atom and to
  `page_evidence.source_kind` now (default `text`), and state that embeddings are
  per-modality (a modality may have its own index/dimension — ties to E1's
  version tag). One column, reserved.

### E3 — (door c) multi-device / CRDT: write-time immutable grounding, canonical-root dedup, and version preconditions all assume a single writer and single clock (major)

The spec's core safety mechanisms are single-writer constructs:
- **Write-time immutable roots** (§1, §2): "assigned at write time and never
  change," grounding "computed at write time." Two devices capturing the same
  content offline each compute a root against their local view; on merge there is
  no rule for reconciling two write-time root assignments.
- **Canonical-root dedup** (§1, Q6): "same canonical root (content identity +
  source identity)" — a dedup decision that needs a global view. Offline, each
  replica independently mints a root for the same import; the merge must dedup
  post-hoc, which the write-time-immutable rule forbids.
- **Version preconditions** (§4, §5): "a concurrent human edit wins and the
  refresh re-queues" is optimistic CAS against a single monotonic
  `version` integer (today's manual path already lacks even this, GT2). A
  single integer is not a mergeable clock; two offline edits both pass their
  local precondition and one is lost.

The daemon is single-SQLite-file today, so none of this bites yet — but the spec
is "the foundation of the whole product," and multi-device is the most likely
future.

- **Minimal spec change (one paragraph):** state the single-writer assumption
  explicitly as a scoped decision, and reserve the seam: roots and claim IDs are
  content-addressed (hash-derived, so two replicas mint the *same* ID for the
  same content — making dedup a merge-time set union, not a conflict); replace
  the scalar `version` with a per-writer version vector or an explicit
  "last-writer-wins on prose, union on edges" merge rule. Deciding this now costs
  a paragraph; retrofitting content-addressed IDs after IDs are load-bearing is a
  data migration of every edge.

### E4 — (door d) export/import round-trip is undefined; roots/claims/attestations may not survive (major)

The spec adds three things that are *derived at write time and immutable* —
roots, grounded bits, claim IDs — plus human attestation edges. An export/import
(backup restore, device move, the existing `crates/wenlan-core/src/export/`
provenance path referenced at db.rs:25027) must round-trip all of them or the
grounding rule silently degrades: a re-imported corpus whose roots were not
preserved gets fresh `document_ingest` roots (fine) but any `human_edit_delta`
and attestation grounding is lost, and generated material re-imported without its
`generated` root could be mis-grounded on the way back in.

- **Scenario:** user backs up, restores on a new machine; every human attestation
  ("I verified this claim," §5.2) is gone because the exporter didn't carry
  attestation edges, and pages silently drop from "stated by you" to unverified.
- **Minimal spec change:** add an invariant — "a corpus round-trips through
  export/import preserving roots, grounded bits, claim IDs, and attestation
  edges; import never re-derives grounding." Make it a testable invariant
  (export→import→diff must be identity on those fields).

### E5 — (door g) LLM-quality drift: extraction, entity-dedup, entailment, and support scores produced by different model versions over years are silently mixed (major)

The spec produces several *stored scores/decisions* from an LLM and treats them
as comparable across time: entailment `support_status` (§4), entity-dedup merges
(§4 "LLM-classified"), relation confidence (§2 consumer), extraction. Over three
years these come from different model versions with different calibration. The
daemon already stores `confidence REAL` on entities/relations (db.rs:2205, and
relations) and `eval_signals`/`eval_judgments` tables exist — but nothing tags a
score with the model that produced it. Two `support_status=provisional` verdicts
from a 2026 model and a 2029 model are not the same evidence, yet the §4
recompute ("machine-derived, recomputed") will compare and threshold them
identically.

- **Scenario:** a threshold tuned against model-A entailment scores silently
  mis-classifies model-B scores after a model upgrade; pages flip
  provisional↔supported en masse on the upgrade, which is exactly the "jumpy"
  behavior the product goal forbids (see P-section).
- **Minimal spec change:** tag every stored machine score with the
  `model_version` (and prompt/version) that produced it; require thresholds to be
  defined per model-version or scores to be re-derived on model change before
  comparison; never mix versions under one threshold. Pairs with E1's version
  column.

### E6 — (door f) Leiden replaceability: the community contract is *mostly* algorithm-agnostic, with one leak (minor)

Assessment: the §3 contract (durable community ids, old→new max-overlap
rebinding, splits/merges as proposals, label-prop fallback "under the same
contract") is genuinely algorithm-agnostic for the *outputs*. The leak is that
"max-overlap rebinding over weighted multi-membership" and the projection are
defined as part of the contract (§3) — but **stable community identity across a
partitioner swap** is not: Leiden and label-prop can produce different community
granularity, so a swap can silently re-shard identity even though the rebinding
math is specified. The spec treats `community_id` as durable (§1 "durable
community_id") while the thing that assigns it is swappable.

- **Minimal spec change:** state that community identity is defined by
  member-set overlap (content), not by the algorithm's internal label, and that
  a partitioner swap runs the same old→new max-overlap rebinding as a normal
  cycle — so a swap is a rebinding event, not an identity reset. One sentence
  closes it.

---

## Section 4 — PRODUCT-SHAPE RISK (stable, non-jumpy page evolution)

The owner's goal: correct new pages, sensible updates, nothing jumpy. Three
model mechanics structurally threaten it.

### P1 — claim re-anchoring is fragile because content change *unconditionally* resets the citation map (major)

Grounded fact: any content change resets `citations` to `'[]'` unless the writer
supplies a fresh map (`citations_json=None ⇒ '[]'`, db.rs:25002-25005, 25020).
The spec's LLM-merge refresh (§4) regenerates page prose, so **every automated
refresh destroys the per-claim citation map and must rebuild it by re-anchoring
claim IDs to the new prose** (§4 "claim IDs survive regeneration by anchoring
during the merge"). If the anchor step mis-locates or drops a claim — the normal
failure mode of fuzzy-matching regenerated text — that claim's `supports` edges
and "stated by you"/document-backed display silently vanish or reattach to the
wrong span. The user sees a page that was cited-through last version and
un-cited (or mis-cited) this version, with no error.

- **Scenario:** an overview refreshes; the merge rephrases a sentence; the
  claim-anchor can't match it; the claim loses its entailment score and drops to
  provisional; the citation superscript disappears. Between two versions the same
  fact goes from "backed" to "unsupported" purely from a rephrase. Maximally
  jumpy.
- **Minimal spec change:** §4 must specify the anchoring *failure* contract, not
  just "anchor during merge": if a claim cannot be re-anchored above a match
  threshold, the merge is **rejected/re-queued** (page stays on the prior
  version) rather than landing a page with silently-dropped citations. Make
  "no claim loses its supports on refresh" a testable invariant.
- **Dedup note:** Codex #34/#43 asked for claim IDs + merge rules to *exist*;
  this is the specific product-visible failure mode of the anchoring step and the
  fix is a failure contract, which the 44 did not specify.

### P2 — community rebinding renames/reshuffles the map the user looks at (major)

Overviews "subscribe" to a durable `community_id` (§1), and communities rebind on
new grounded edges (§3). Because an overview's title/content is a *summary of its
community's members*, when membership shifts the overview's meaning shifts even
though its `community_id` is "durable." The map regions (a §3 consumer) re-draw
on rebinding. So a single capture can, via rebinding, rename a map region and
change what an overview page is "about" between sessions — the durable ID hides a
non-durable meaning.

- **Scenario:** user opens the map daily; a week of captures gradually shifts a
  community's centroid; the overview auto-refreshes to a different topic framing
  and the map region relabels. Nothing was deleted, but the user's mental map
  moved under them.
- **Minimal spec change:** the §3 "community churn rate" metric (already
  required) must gate *user-visible* relabeling: an overview title / map-region
  label changes only through the same review-proposal path as splits/merges, not
  silently on rebinding. Separate "membership rebinding" (silent, structural)
  from "identity/label change" (proposed, visible).
- **Dedup note:** Codex #30/#37 covered overview subscription lifecycle and
  churn *metrics*; this is the specific UX rule (label changes are proposals) the
  metrics should enforce.

### P3 — the staleness matrix can stage many revision cards from one memory → pileup on human-owned pages (major)

§4 makes staleness dependency-driven: a page keeps a dependency index of its
grounded inputs, and edge retraction / entity merge / support-score change / etc.
mark dependents stale. One event (an entity merge, a retracted source) can
invalidate many pages at once. For machine-owned pages the refresh lands
directly; but for **human-owned pages every refresh stages a revision card**
(§5.2; already built — `page_is_human_owned` → `stage_page_revision_card`,
memory_routes.rs:3469-3478). So one entity merge can stage dozens of revision
cards the human must individually accept/reject. The spec has no batching or
rate limit on card generation.

- **Scenario:** user merges two entities (a routine dedup, §4). Fifty pages
  depend on those entities. Fifty revision cards appear in the review queue at
  once. The user, facing a wall of cards, stops reviewing — human-owned pages
  either freeze (cards never accepted) or get rubber-stamped (defeating the
  protection). Either way the product feels like it "jumped."
- **Minimal spec change:** §4 must bound card generation: coalesce revision cards
  per human-owned page (one pending card that re-merges on new triggers, not one
  per trigger — the daemon already has a single pending-card slot per page to
  build on), and add a per-cycle cap on how many pages a single structural event
  may stage cards for, with the remainder surfaced as a batch "N pages affected
  by this merge — review together" action rather than N separate cards.
- **Dedup note:** Codex #35 required the dependency index/invalidation matrix to
  *exist*; this is the downstream product consequence (card pileup on the
  human-owned path) and its fix (coalescing + cap), which #35 did not address.

---

## What remains uncertain (cheapest check to settle each)

- **GT2 severity:** I confirmed sources are preserved and citations-reset is
  intentional; I did **not** trace whether any *other* manual entry point (e.g.,
  a filesystem `fs_edit` via the page-watcher, scheduler.rs:263) also skips the
  changelog. Cheapest check: read `sources::page_watcher::sync_filesystem_edits`
  and confirm it routes through `post_write::update_page` (changelog-aware) or
  the bare `update_page_content` (not). If the fs path also skips changelog, GT2's
  "history" half is broader than the manual HTTP route.
- **GT4 "three places":** I searched the daemon crate only. If the intended
  "three" spans repos (daemon `has_capture_seed_floor` + the plugin `/distill`
  skill + the app), the count could be defensible. Cheapest check: grep the
  wenlan-app repo and the plugin skill dir for a hardcoded seed floor of 3.
- **E-series (doors):** these are design-forward; each is CONFIRMED as *absent
  from the spec* and the enabling/blocking facts are CONFIRMED from source
  (E1 hardcoded 768 + no version column; E3 scalar version). The judgment that
  each door is worth a paragraph now is mine, not a fact — the owner decides
  which futures are in scope.
- **P1 anchoring:** I confirmed the citations-reset invariant; I did not read a
  claim-anchoring implementation because none exists yet (M5/M6 future). The
  failure mode is inferred from the reset invariant + "anchor during merge"
  language — PLAUSIBLE, not observed. Cheapest check: settle it in the spec by
  writing the anchoring failure contract (P1's fix), since there's no code to
  read.

Confidence: Section 1 is CONFIRMED against source line-by-line. Sections 2-4 mix
CONFIRMED enabling facts (cited) with forward inferences (labeled PLAUSIBLE where
the code doesn't exist yet).

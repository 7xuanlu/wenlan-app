# Wenlan unified knowledge model — spec draft v3

**Status:** discussion draft (2026-07-18, v3). Review history:

- **v1** (4c0ea07) → Codex gpt-5.6-sol design review, 44 findings, *needs-more-info*.
  All folded in v2 (`2026-07-18-kg-spec-codex-review.md`).
- **v2** (06bba56) → two independent second-round reviews, different angles:
  - **Opus (repo-grounded, future-proof lens)** — 18 findings, three of which
    overturn baseline facts the spec was built on (GT1–GT3, verified against
    source by the orchestrator as well). `2026-07-18-kg-spec-opus-review.md`.
  - **Codex gpt-5.6-sol (repo-grounded, runtime lens)** — 26 findings
    (13 critical), verdict **reject for implementation in its current form**:
    the model was sound but the spec lacked the commit/lease/retry/rollback
    protocols to keep its invariants true under real interleavings and
    crashes. `2026-07-18-kg-spec-codex-runtime-review.md`.
- **v3 (this document)** folds all 44 second-round findings. The design is
  unchanged; what v3 adds is (a) three baseline corrections, and (b) the
  **runtime contract** (§6) that makes every invariant hold under concurrency,
  crash, retry, adversarial input, and rollback — the difference between a
  model that is right and a system that stays right.

**Goal:** one cohesive, simple model that captures every intended behavior, by
**refactoring the existing daemon** (migration-based, wire-compatible), not a
rewrite. Streamlined page creation and maintenance is the product outcome.

**Why refactor (baseline, corrected in v3 against source):** the code walk
found the same job done by parallel mechanisms — 3 grouping systems
(throwaway embedding clusters, unused label-prop communities, the app's map
heuristic), 5 link stores (`relations`, `page_sources`, `page_evidence`,
`citations` JSON, `page_links`), and an overloaded scope story (`pages.space`
is a renamed `domain` column holding page-type categories; `pages.workspace`,
added by migration 63, is the *authoritative* page-scope axis). Corrections
from the Opus review, now the operative baseline:

- **Trust fields: two, not three.** `user_edited` and `review_status` are real
  trust fields; `creation_kind` is source-documented as *"routing metadata
  (NOT a trust signal)"* (migration 61) that merely seeds the initial
  `review_status`. The collapse target is two fields → two recorded facts (§4).
- **The manual write path's defect is narrower than v2 claimed.** Sources are
  preserved on manual edit (the wipe bug is fixed, `memory_routes.rs:3405`),
  and the citations reset on content change is an **intentional invariant**
  (stale marker→source maps must not outlive their prose, `db.rs:25002`).
  What the manual path genuinely lacks: a changelog entry and a version
  precondition. M0 fixes those — it is foundational, not an emergency.
- **The ≥3 seed floor is already single-sourced** (`has_capture_seed_floor`,
  one call site), and the staging pool is a live query with a narrow seed
  predicate (chunk-0, non-recap, non-superseded, embedded captures; documents
  are recruited as evidence but can never seed).

**The headline change from v2:** v2 specified *what* is true (the grounding
rule, one edge store, one write gate). v3 specifies *how it stays true*:
canonical roots become unique rows acquired by atomic upsert, every mutation
carries retry identity, refinery phases take durable leases, refresh publishes
through one CAS-guarded transaction, migration rungs get rollback contracts,
and the API boundary can no longer be talked into minting human roots.

---

## 1. Objects — two node types, one sub-page unit, two scopes

### Memory (the evidence atom) — with a provenance root
A captured note or a document chunk. Append-mostly. Carries: content,
embedding, `space`, `memory_type`, `modality` (default `text` — reserved now
so image/audio memories are a value, not a schema migration), provenance
(`author`, `origin`), and an immutable **root** — the bottom of its
derivation chain: `document_ingest(source)` | `human_capture(event)` |
`human_edit_delta(page, edit)` | `generated(producer)`.

**Roots are rows, not labels.** A `provenance_roots` table with
`UNIQUE(identity_version, identity_digest)`; the digest is a **versioned,
content-addressed canonical identity** (content identity + source identity —
the equivalence matrix is Q6). Root acquisition is
`INSERT … ON CONFLICT … RETURNING root_id` in the same transaction that
attaches the memory — never check-then-insert (two concurrent imports of one
file must converge on one root at the database, not in application code).
Content-addressing also means two future replicas mint the *same* root for
the same content — dedup as set union, not conflict (§6.7).

Roots carry a lifecycle for large ingests: `ingesting | active | failed`.
Only `active` roots vote; a partially ingested document never counts (§6.4).

**Independence is a separate fact from identity.** Whitespace-tweaked mirrors
and batch-generated archives defeat exact-identity dedup. Each root also
records an `independence_group_id` derived from enforceable signals (import
container/batch, source identity, agent turn/session, near-duplicate
clustering). Genesis floors count **independence groups, not root IDs** (§4).

### Page (the readable unit) — one table, several kinds
`kind: entity | concept | source | overview | authored` (extensible).
The separate `entities` table dissolves into pages of `kind=entity`:

- **entity** — keeps entity's special behavior as columns/edges on a page
  (`entity_type`, aliases, confidence, extraction pipeline target). May be a
  **stub** (structured fields, no prose) until evidence accumulates.
- **concept** — a distilled topic page (today's `creation_kind=distilled`).
- **source** — exactly one page per ingested file. Its provenance is stored as
  **compressed chunk ranges against the document root**, not one citation edge
  per chunk (a 10k-chunk book must not mint 10k edges, §6.4).
- **overview** — a community or space summary (absorbs SummaryRollup).
  Subscribes to its durable community id; split/merge proposals carry the
  overview reassignment (Q7).
- **authored** — human-created from scratch.

Page identity is durable: `id` never changes because a grouping changed.

**Claims are addressable — and versioned.** A **claim** is a stable-ID'd span
of a page. The logical `claim_id` survives regeneration; each regeneration
that changes a claim's text mints an immutable **claim revision** row
(`claim_id`, `claim_revision`, text digest, page version). `supports` and
attestation edges target **revisions**, never bare claim IDs — so an
attestation can never silently attach to text the human didn't see (§5.2),
and old supports can never back a changed statement. External resources cited
by pages are URI attributes on `cites` edges, not a third node type.

### Space (the hard fence)
Every memory and page lives in exactly one space. **No NULL scopes**: M1
normalizes every missing scope to a real `unfiled` space id and rebuilds the
columns `NOT NULL` (a nullable fence column makes `!=` triggers silently pass
NULL rows). `space` means scope and nothing else; the migration *direction* is
corrected in v3 — see M1. Nothing crosses a space fence — enforced in the
edge schema (§2) with NULL-safe (`IS NOT`) comparisons.

### Community (the routing unit — NOT a scope)
A persisted grouping within a space, computed over the graph (§3). Rows:
durable `community_id`, space, display name, timestamps. **Community identity
is defined by member-set overlap, not by the partitioner's internal labels**
— swapping Leiden for another algorithm is a rebinding event under the same
old→new max-overlap rule, never an identity reset.

---

## 2. Edges — one typed store, one grounding rule

One table replaces the **five** legacy stores (`relations`, `page_sources`,
`page_evidence`, the `citations` JSON blob, `page_links`):

```
edges(edge_id,                       -- immutable identity (content-addressed or ULID)
      src_id, src_kind, dst_id, dst_kind, edge_type,
      lineage, grounded, root_id, space,   -- space NOT NULL (external-URI cites exempt)
      weight, payload,                     -- payload: claim revision + span locator, etc.
      provenance, operation_id,            -- retry identity (§6.1)
      created_at, superseded_by, valid_until)
```

`edge_type`: `mentions` (memory→entity page), `relates` (entity↔entity),
`cites` (page→memory / page→external URI), `supports` (claim-revision→memory
span), `links` (page→page wikilink).

`lineage` (`assertion` | `evidence` | `synthesis`) records the *immediate
author* — kept for display and audit. **`grounded` is the load-bearing bit**,
computed at write time from the derivation chain and then immutable:

> **The grounding rule: only edges whose derivation bottoms out in captured
> external reality vote** — in community detection, seed floors, co-citation,
> relation-confidence, and synthesis-support statistics. External means a
> document ingest or a human statement about the world. Generated output
> never becomes external, no matter how many hands it passes through.

What this closes (v1 → v2, unchanged): transitivity laundering, typo-fix
promotion (only the human's delta is grounded, §5.1), acceptance ≠
attestation (§5.2), agent self-recapture (generated roots stay ungrounded).

**What v3 adds — ancestry is necessary but not sufficient (runtime findings
22–23):**

- **Extraction proposes; validation grounds.** An LLM extractor reading a
  document can be prompt-injected into asserting structure the document never
  states. A grounded extracted edge (`mentions`, `relates`) must therefore
  carry an **exact source span** and pass deterministic span validation (or
  an independent entailment check) before `grounded=true` is written.
  Extraction calls are schema-constrained, tool-free, with delimited
  untrusted input; a model may never supply a root, space, ID, or grounded
  value of its own.
- **Clients never choose roots.** See §5.6 — the MCP/agent boundary defaults
  unconditionally to `generated(agent)`.

Rules of the store:

- **Immutability**: `lineage`, `grounded`, `root_id` never mutate. Attestation
  and retraction are new edges / idempotent transitions, never rewrites. The
  full assignment matrix (writer × origin × operation → lineage/root) is a
  required M2 artifact.
- **Identity & retry**: `edge_id` is immutable; every write carries
  `operation_id` (§6.1); per-edge-type natural uniqueness (or a unique
  producer-operation key) makes a retried write converge on the same edge
  instead of minting a duplicate voter. `superseded_by` is a checked
  reference to a real `edge_id`.
- **The fence is a constraint**: every edge carries `space` (`NOT NULL`);
  a trigger with **NULL-safe comparisons** enforces both endpoints in that
  space (sole exception: `cites` to an external URI, which has no space).
  A pre-migration audit reports legacy cross-space links.
- **Deletion cascades; moves are transactional.** Deleting a memory/page/claim
  retracts its incident active edges in the same transaction. Changing a
  node's space is either prohibited while active edges exist or atomically
  retracts and recreates the affected edges. A periodic integrity sweep hunts
  dangling active endpoints.
- **Enumerated consumers**: the grounding rule governs *every*
  structure-forming statistic — community detection, seed floors,
  co-citation, relation-confidence, synthesis-support. A new
  lineage-sensitive aggregation must add itself to this list or it doesn't
  ship.
- **Legacy honesty**: edges backfilled from the five old stores whose
  provenance can't be confidently classified get `lineage=legacy`,
  `grounded=false` — non-voting until a validation pass promotes them, with
  a report of classifiable vs unknown counts.
- **Indexes are part of the schema** (not an optimization afterthought): the
  M2 index contract covers active-grounded scans by space/type, both endpoint
  directions, `root_id`, claim-revision supports, supersession chains,
  operation IDs, and reverse dependency lookup — with `EXPLAIN QUERY PLAN`
  assertions and bulk-insert trigger benchmarks in the acceptance gate.

---

## 3. Grouping — where Leiden sits

**One algorithm, one persisted result, three consumers** (page routing, map
regions, overview rollups). Replaces all three of today's grouping systems.

- Runs **per space** over the grounded subgraph, two-phase: **a node
  participates in partitioning iff it has ≥1 grounded incident edge**; nodes
  with grounded degree 0 are assigned after partitioning to their strongest
  attachment and cannot perturb the objective.
- **The projection is part of the spec**: direction folding, per-edge-type
  weight scaling, parallel-edge aggregation, high-degree source-page
  normalization, isolated-node handling, and weighted-multi-membership
  rebinding must be written down before any benchmark. The benchmark runs on
  this exact projection.
- **Publication is generation-guarded (runtime finding 19).** Each space keeps
  a monotonic `graph_generation`, bumped by grounded-edge writes. A grouping
  job records its input generation, publishes a versioned assignment snapshot,
  and clears the space's dirty state only via
  `WHERE generation = input_generation` — a mid-run edge arrival leaves the
  space queued instead of silently losing the update. Concurrent jobs are
  excluded by the phase lease (§6.2). Old→new rebinding runs through an
  inverted node→community accumulator, not an all-pairs comparison.
- **Incrementality is required, not aspirational**: warm-start / local
  re-optimization around the changed subgraph, not a full re-partition per
  cycle (§6.5 has the cost model).
- **Routing model**: page↔community assignment has explicit thresholds with
  hysteresis (assign above T_hi, drop below T_lo), defined update triggers
  (new grounded edge, community rebinding, page refresh), and a
  page-embedding fallback for entity-poor pages. Assignments invalidate on
  rebinding.
- **User-visible names change only by proposal (product finding P2).**
  Membership rebinding is silent and structural; an overview title or map
  region label changes only through the same review-proposal path as
  splits/merges. The mental map never moves silently.
- **Leiden** is the intended algorithm behind the contract: durable community
  ids, old→new max-overlap rebinding, splits/merges as review proposals,
  label-propagation fallback under the same contract — and identity survives
  a partitioner swap (§1).
- **Gates, executable**: leiden-rs spike + on-device benchmark with written
  pass/fail criteria; community churn rate and correction latency measured
  independently. The app's degree heuristic stays as client fallback until
  `community_id` ships, then retires.

---

## 4. Distill revamped — genesis from four signals, maintenance by routing

### Genesis: four signals, one floor

**Every signal counts independence groups of active grounded roots** (§1) —
never page rows, never memory rows, never raw root IDs. A document is one
group regardless of chunk count; three mirrors of one file are one group;
generated material is zero.

1. **Evidence cluster** (community-scoped): enough un-covered grounded
   evidence inside a community → a `concept` page. Floor: **≥3 independence
   groups** (strict "captures only" variant remains Q2). Embedding similarity
   demotes to a tie-breaker.
2. **Page-graph signal**: an orphan wikilink target referenced from ≥N pages
   via grounded edges, from pages that themselves have grounded support, with
   the same group-counting floor underneath → propose a page.
3. **Community signal**: a community above size X — grounded nodes only,
   overviews excluded from every genesis metric — with no `overview` → create
   one.
4. **Space signal**: same rule at space scope.

**Genesis is transactional, idempotent, and mutually exclusive (runtime
finding 6):** a durable candidate table with deterministic fingerprints,
plus `genesis_candidate_roots(candidate_id, root_id, coverage_epoch)` giving
**exclusive claims on un-covered evidence within an epoch** — overlapping
candidates (roots {1,2,3} vs {2,3,4}) cannot both mint. Page IDs are
deterministic per genesis slot. The protocol is prepare-transaction → LLM
call *outside* any transaction → finalize-transaction that re-verifies lease,
root claims, input generation, and evidence liveness before creating the page
and completing the candidate atomically. Every page records its genesis
(signal + nodes) as provenance.

**Abuse bounds (runtime finding 25):** normalized wikilink label rules, a
hard links-per-page cap, per-root and per-space candidate quotas, per-cycle
processing budgets, and durable suppression of dismissed labels (a refresh
must not resurrect them). If all evidence for a candidate arrived through one
agent and independence cannot be established, the candidate routes to human
review instead of auto-genesis.

### Maintenance: route, attach, refresh

- New memory → community assignment (§3 routing) → candidate pages ranked by
  **one relevance function**: co-citation, direct link, common-neighbor,
  kind-affinity. Co-citation fixes its estimator (smoothed NPMI), a
  minimum-support floor, and temporal decay before weight tuning — and is
  **bounded around hubs**: incremental pair-count maintenance, a root-degree
  cap / hub down-weight, and bounded candidate retrieval; relevance never
  enumerates every page pair touching a 5k-page root.
- **Refresh is one guarded publication (runtime findings 8–9, product
  finding P1).** Before inference, capture
  `(page_version, dependency_generation, active_root_set_digest)`. The LLM
  merge and entailment run outside any transaction; their output is an
  invisible job artifact. Finalization CASes all three captured values and
  atomically writes: page snapshot, prose, claim revisions, supports,
  `support_status`, dependency index, history, and stale state. Any CAS miss
  (concurrent human edit, retracted source, new dependency) discards nothing
  visible — the page stays on its prior version and the refresh re-queues.
  **Anchoring has a failure contract**: a claim that cannot be re-anchored
  above the match threshold rejects the whole merge (re-queued for
  regeneration) rather than landing a page with silently dropped citations.
  *No claim loses its supports on refresh* is a testable invariant (#15).
- **Refresh respects the write path**: machine-owned page → direct write
  (with history); human-owned page → the merged result is **staged as a
  revision card**, never applied. Cards are **idempotent and coalesced
  (runtime finding 7, product finding P3)**: an active card is keyed by
  `proposal_key = hash(page_id, base_version, operation_id, content_digest)`
  with a partial-unique constraint (retry returns the existing card); any
  page write atomically obsoletes pending cards based on older versions; one
  pending card per page re-merges on new triggers instead of stacking; and a
  single structural event (entity merge, source retraction) may stage cards
  for at most K pages per cycle, the remainder surfacing as one batched
  "N pages affected — review together" action.
- **Staleness is dependency-driven**: each page keeps a dependency index of
  its grounded inputs; the invalidation matrix covers new evidence, source
  edit, source deletion, span/extraction correction, entity merge, edge
  retraction, and support-score change — each marks the page stale with a
  reason.
- **Frontier** (the honest version): durable per-space state — evidence with
  no or weak community assignment — scanned age-prioritized with a cursor and
  a per-cycle budget. **Surfacing guarantee**: evidence that cannot reach the
  floor surfaces past an age threshold as an unformed-topic card (create /
  merge / dismiss). Cold start in a small space is surfaced, never parked.
  The space fence stays hard by design; cross-space *suggestion* without
  auto-attachment is possible future work, not in scope.
- **Identity dedup is a separate module from grouping**: same-entity-
  different-name is an LLM-classified, user-confirmed merge flow — never
  conflated with community detection ("related" ≠ "same").

### Truthfulness (pre-publication)

- At synthesis/merge time, compute per-claim `supports` edges — claim
  revision → source span — scored by an **independent entailment pass** (not
  the synthesizing model grading itself), with a threshold; below it the
  claim is unsupported.
- **Entailment is incremental by contract (runtime finding 18):** score only
  changed claim revisions and changed support candidates; cache by
  `(claim_text_digest, source_span_digest, model_id, model_version,
  prompt_version)`; batch calls; cap claims and candidates per page under a
  daemon-wide inference budget. Deferred work leaves the page honestly
  stale/provisional — partial results are never published.
- **Two fields, not one status**: `support_status` — machine-derived,
  recomputed: all claims supported vs unsupported claims exist ⇒
  **provisional**; and `human_reviewed` — curation: a human looked. Both
  survive independently; agents see both on every read path; publication of a
  synthesis is atomic with its support computation.

---

## 5. One write path + the authority ladder

All page writes go through one gate; the writer is a typed field
(`human | agent | pipeline(stage)`).

**Three orthogonal axes**: prose authority (whose text wins: human >
machine), claim type (Q3 taxonomy), voting eligibility (grounded ancestry,
§2) — independent of each other.

Rules:

1. A human edit **applies instantly**; the **delta the human actually wrote**
   becomes an assertion capture rooted in `human_edit_delta` (grounded);
   untouched machine prose keeps its `generated` root. **The delta is
   computable only against a bound base (runtime finding 5):** the edit
   request carries `base_version` + `base_content_digest`; the server diffs
   against that exact stored snapshot. A stale base returns conflict for an
   explicit UI rebase — otherwise a full-page save from an old view would
   classify reverted machine prose as human-authored grounded assertion.
   Clients that omit the base may still edit, but cannot mint grounded
   deltas.
2. A machine write to human-owned prose **stages a revision card** (today's
   mechanism, kept). **Accepting the card is editorial approval only** —
   `accepted_by_human`, text applied; claim roots stay `generated`. A
   separate explicit "verify this claim" action adds the human attestation
   edge — and it targets the **claim revision the human was looking at**
   (viewed revision + digest + operation id), so attestation can never bind
   to text that shifted underneath the click (§1, runtime finding 9).
3. When a synthesis contradicts an assertion, the assertion wins the
   **prose** and the contradiction surfaces as a review item — but the
   grounded evidence **keeps voting**; prose authority never suppresses
   structure. Interim conservative rule until Q3: only human statements
   *about the world* are grounded; human edits *of machine text* get prose
   authority without voting weight.
4. Assertion-backed claims display as "stated by you", never dressed as
   document-backed evidence.
5. **Every write leaves history** — snapshot + changelog on all paths (ships
   in M0). **Ownership is decided inside the guarded write (runtime finding
   4):** every page mutation carries `expected_version`, and the
   direct-write-vs-revision-card decision happens inside the version-guarded
   finalize — a page that became human-owned mid-flight fails the CAS and
   re-queues; there is no unconditional-update fallback anywhere.
6. **Root honesty is enforced at the boundary, not requested (runtime
   finding 23).** Agent/MCP captures are **unconditionally**
   `generated(agent)`; no wire request may select a root kind, lineage, or
   grounded value. `human_capture`, `human_edit_delta`, and attestation
   require a UI-authorized user-presence capability that MCP clients do not
   possess. A human statement relayed through an agent stays `generated`
   until the human explicitly attests it.

---

## 6. Runtime & operations contract (new in v3)

The protocols that keep §§1–5 true on a real machine. Everything here is
normative.

### 6.1 Retry identity (idempotency)
Every mutating wire call and every internal job step carries
`(caller_id, operation_id)` (deterministic for scheduler/LLM jobs). A durable
receipt table — `UNIQUE(caller_id, operation_id)`, request digest, serialized
response — commits **with** the mutation. Same id + same digest replays the
stored response; same id + different digest is a conflict. This is what makes
"the response was lost, the client retried" a no-op instead of a duplicate
capture, card, edge, or history row.

### 6.2 Durable phase leases
Refinery phases, manual `/api/steep`, and detached sweeps coordinate through
durable leases keyed by `(phase, space, input_generation)` — token, expiry,
attempt count, compare-token finalization. Manual triggers join, decline, or
supersede; expired leases recover at startup; a process-local mutex is not a
lease. All side effects remain independently idempotent (6.1), so a lease
takeover never double-applies.

### 6.3 SQLite discipline
One short-transaction writer plus a bounded read pool; explicit
`busy_timeout`, WAL size/checkpoint policy, checkpoint-stall metrics, and
backpressure. Migration and edge batches are sized by a **measured
lock-duration budget**. **No SQLite transaction ever spans an embedding or
LLM call** — model work happens between the prepare and finalize
transactions (§4), never inside one.

### 6.4 Ingest limits (pathological documents)
Hard byte/chunk caps; streaming parse and hash; bounded embedding and write
batches; resumable chunk cursors; root lifecycle `ingesting → active |
failed` so partial batches never vote; source-page provenance as compressed
chunk ranges, not per-chunk edges. Oversized or repeatedly failing inputs
are quarantined and surfaced, never retried forever.

### 6.5 Storage & compute budgets, retention, compaction
Nothing is unbounded by default:

- **Edges**: superseded/tombstoned edges are compacted after a stated horizon
  (post-rollback-window, post-audit-export) — tombstones are a semantic, not
  a permanent tax. Compaction preserves auditability (compacted history is
  exported before deletion).
- **History**: page snapshots are delta-compressed with periodic fulls;
  retention = keep last N + all human-edit snapshots (carrying forward
  today's `edited_by` protection) — capped, including the protected class.
- **Claim IDs**: an id retires when no supports edge references it after M
  consecutive regenerations. **Genesis candidates**: dismissed/expired
  fingerprints carry a TTL (suppression outlives the row via the dismissed-
  label store, §4).
- **Vector index**: dead vectors are vacuumed on the same compaction
  schedule.
- Illustrative scale target for all budgets: 100k memories / 5k pages on a
  laptop; the M2 acceptance gate runs at this size.

### 6.6 Model & embedding versioning
Every stored vector carries `embedding_model_version`; every stored machine
score (entailment, extraction confidence, dedup verdicts) carries the
`(model_id, model_version, prompt_version)` that produced it. Thresholds are
defined per model version; scores from different versions are never compared
under one threshold — a model upgrade re-derives before it re-judges (no
mass provisional↔supported flips on upgrade day). All similarity-derived
state (co-citation caches, staging clusters, community input, relevance
weights) is **defined as recomputable, never durable**. A dimension change is
an expand-contract vector migration, not an in-place ALTER.

### 6.7 Single-writer scope, and the seams left open
This spec assumes **one writer, one clock, one SQLite file** — stated as a
scoped decision, not an accident. The seams reserved for a multi-device
future, chosen because they cost a paragraph now and a full data migration
later: roots and claim IDs are **content-addressed** (two replicas mint the
same id for the same content — merge becomes set union); the scalar page
`version` is encapsulated behind the write gate (swappable for a version
vector); edges are union-mergeable by construction (immutable, identified,
idempotent). No CRDT machinery ships now.

### 6.8 Export / import round-trip
A corpus round-trips through export/import **preserving roots, grounded
bits, claim revisions, attestation edges, and receipts — import never
re-derives grounding.** Testable as export→import→diff = identity on those
fields (invariant #14). Without this, a backup restore silently demotes
every "stated by you" to unverified.

### 6.9 Backup, downgrade, rollback
The daemon **refuses to open a database newer than its schema version** (today
it silently proceeds). Every rung ships with a pre-migration SQLite
**online-backup** (the backup API — WAL makes raw file copies unsound) plus
an integrity receipt and a restore drill. Per-rung rollback contracts live in
the M-table (§7).

---

## 7. Migration ladder (reordered: write safety first, automation last)

| # | Rung | Size | Rollback contract (§6.9) |
|---|---|---|---|
| M0 | **One write gate**: single canonical page-write transaction — typed writer, `expected_version` on every mutation, snapshot + changelog on every path (the manual route today lacks both — GT2), citation-map reset preserved as the invariant it is, ownership decided inside the CAS (§5.5). **Q4 is decided here, not later** (runtime finding 13): history is a SQLite `page_history` table written in the page transaction; Markdown files become a repairable projection (temp-file rename, startup reconcile); link edges commit with the page or via a transactional outbox. | S–M | Additive; recoverable while snapshots are in-DB. Old writers are fenced (they bypass the gate). |
| M1 | Honest columns, **direction corrected (GT3)**: page `kind` gets its own column; category values move out of `pages.space`; **page scope migrates FROM `workspace` (authoritative, migration 63) INTO the unified `space`**; `pages.space` residue is *classified* (category → `kind`, origin values reconciled against `workspace`), never assumed to be scope. NULL scopes normalized to a real `unfiled` id, columns rebuilt `NOT NULL` (§1). Mapping/collision audit first. | M | Keep `workspace` and the category→kind ledger through the rollback window (dual-write); dropping them makes the fold irreversible. |
| M2 | Unified `edges`, staged: (a) schema expand + assignment matrix + **index contract** (§2), (b) dual-write where **every mutation updates all live stores in one SQLite transaction** (or a transactional outbox committed with the authoritative write — never eventual), (c) reader cutover behind a durable dual-write **epoch + parity watermark** proving no unreconciled older operation, (d) soak/reconciliation, (e) retire old stores in a later all-or-nothing migration after the rollback window. **Migration state is a durable row** — stage, source cursor, batch checksum, epoch, completion marker; every batch commits with its cursor; DDL is replay-safe (today's migrations are not: multi-statement, no enclosing transaction). | L | Legacy stores are rollback shadows until the later retirement migration; after retirement, restore-from-backup only. |
| M3 | Entities → entity pages, **id-mapped**: kept mapping table (`entity_id → page_id`) rewrites edge endpoints inside one expand-contract program; adapters translate old wire ids indefinitely. Gated on: full caller inventory, one canonical entity-upsert service, resumable migration state machine, endpoint-by-endpoint wire-contract freeze (Q1 decided here), index acceptance on real data. | L | ID map alone is not a downgrade path once `entities` drops: keep a write-compatible legacy shadow through the window, or declare a hard downgrade barrier. |
| M4 | Persisted communities under the §3 contract — projection spec, routing spec, generation-guarded publication, and the two executable gates, all written before code. App consumes `community_id`; heuristic retires **after** the rollback window. | M | Derived data: disable and recompute. Preserve algorithm/projection versions. |
| M5 | **Claim identity + truth gate**: claim revisions (§1), entailment-scored supports with the §4 cache contract, `support_status`/`human_reviewed` split, provisional enforcement on every agent read path. | M | Tables are additive, but semantic downgrade is unsafe (old readers show unsupported synthesis ungated): bridge to legacy review_status or refuse old readers. |
| M6 | Distill rewired: four genesis signals + candidate ledger with exclusive root claims, independence groups, frontier with surfacing, bounded relevance function, LLM-merge refresh — all on M0's gate, M5's truth gate, and §6's leases/limits. | L | Generated pages are user-visible and not generally reversible: stop jobs, invalidate leases, archive genesis pages; selective snapshot restore only where no later human edit depends on it. |

M0 ships first — not because data is bleeding today (it isn't — GT2), but
because every later rung assumes the gate. M1/M2 next; M3 waits for M2's
soak; M4 waits on its gates; M5 precedes M6 — automation lands last.

---

## 8. Invariants — the behaviors this model must keep (checklist)

1. A book never mints pages from its own chapters *(root counting)*
2. **≥3 independence groups** before a new concept page *(floor, §4 — groups,
   not raw roots: mirrors and batch archives count once)*
3. Human prose is never silently overwritten *(§5.2, §5.5 — ownership decided
   inside the CAS)*
4. New-topic evidence is never lost and always surfaces *(frontier, §4)*
5. Page identity durable; regroupings propose, never rename *(§1, §3)*
6. Every claim traceable; unsupported ⇒ machine-readably provisional; human
   review and machine support are separate recorded facts *(§4)*
7. Spaces are hard fences — enforced in the edge schema, NULL-safe,
   delete/move-safe *(§2)*
8. One memory may support several pages *(edges are many-to-many)*
9. An edit's knowledge travels — as the human's delta, diffed against a bound
   base *(§5.1)*
10. Every write leaves history *(§5.5 — ships in M0)*
11. The system never believes its own output *(the grounding rule, §2)*
12. Stability and truthfulness get separate, measured dials *(§3 gates)*
13. Grounding is ancestry-decided and immutable — no sequence of edits,
    acceptances, or re-captures promotes generated material *(§2)*
14. **A corpus round-trips through export/import** — roots, grounded bits,
    claim revisions, attestations preserved; import never re-derives
    grounding *(§6.8)*
15. **No claim loses its supports on refresh** — anchoring failure rejects
    the merge; the page never silently sheds citations *(§4)*
16. **User-visible names change only by proposal** — rebinding is silent,
    relabeling never is *(§3)*
17. **No client chooses its root** — agent captures are `generated`
    unconditionally; human roots require UI-authorized presence *(§5.6)*
18. **Retries are no-ops** — every mutation has receipt-backed identity
    *(§6.1)*

## 9. Open questions

- **Q1 — entity-page stubs on the wire:** graph-only vs listed. An M3 gate
  item — decided before the wire-contract freeze.
- **Q2 — floor strictness:** ≥3 independence groups with documents counting
  as one, vs captures-only. Recommend the relaxed version; one constant.
- **Q3 — human assertion taxonomy** (correction / speculation / preference /
  observation) and per-type propagation. §5.3 carries the interim
  conservative rule. Needed before M5 finishes.
- ~~Q4 — snapshot storage~~ **Decided in v3** (runtime finding 13): SQLite
  `page_history` table, in-transaction, ships with M0; files are projections.
- **Q5 — relevance-function weights:** llm_wiki ships co-citation 4.0 >
  direct link 3.0 > common-neighbor 1.5 > type-affinity 1.0; ours need tuning
  against wrong-attachment rates, under §4's estimator/support/decay and hub
  bounds.
- **Q6 — origin identity & independence** *(expanded)*: the equivalence
  matrix for canonical-root digests (duplicate imports, mirrors, quoted
  excerpts, repeated captures of one agent response) **and** the enforceable
  signal set for `independence_group_id`. Needed before M2's assignment
  matrix.
- **Q7 — overview lifecycle:** subscription-transfer rules across community
  splits/merges (who keeps it, when a second is proposed, duplicate
  suppression).

# Wenlan unified knowledge model — spec draft v1

**Status:** discussion draft (2026-07-18). Supersedes the *framing* of
`2026-07-18-kg-distill-council-verdict.md` — the council's invariants and gate
items all survive, but as consequences of a smaller model instead of add-on
gates. Grounding: full source walk of the daemon (`~/Repos/wenlan`) and a
design study of `nashsu/llm_wiki` (the closest shipped competitor).

**Goal:** one cohesive, simple model that captures every intended behavior, by
**refactoring the existing daemon** (migration-based, wire-compatible), not a
rewrite. Streamlined page creation and maintenance is the product outcome.

**Why refactor:** the code walk found the same job done by parallel mechanisms:
3 grouping systems (throwaway embedding clusters, unused label-prop
communities, the app's map heuristic), 2 scope columns (`space` overloaded
with page categories, `workspace` bolted on), 4 link stores (`page_sources`,
`page_evidence`, `citations` JSON, `page_links`), 2 page-write paths (the
manual-edit route skips history and guards), and 3 trust fields
(`user_edited`, `creation_kind`-as-trust, `review_status`). Each pair/triple
collapses into one primitive below.

---

## 1. Objects — two node types, two scopes

### Memory (the evidence atom)
A captured note or a document chunk. Append-mostly. Carries: content,
embedding, `space`, `memory_type`, and **provenance** — `author`
(human | agent | pipeline) and `origin` (capture | document | page_edit |
revision_card). Nothing else changes from today's `memories` table.

### Page (the readable unit) — one table, several kinds
`kind: entity | concept | source | overview | authored` (extensible later).
This is the llm_wiki move, and the one deep cut in this spec: **the separate
`entities` table dissolves into pages of `kind=entity`.**

- **entity** — a person/project/tool. Keeps entity's special behavior as
  *columns/edges on a page*, not a separate object: `entity_type`, aliases,
  confidence, and the extraction pipeline targeting it. May exist as a
  **stub** (structured fields, no prose) until evidence accumulates —
  today's unconfirmed entities map to stubs.
- **concept** — a distilled topic page (today's `creation_kind=distilled`).
- **source** — exactly one page per ingested file (kept from today,
  `creation_kind=source`), citing its own chunks. Its chunks are memories
  with `origin=document`.
- **overview** — a community or space summary page (absorbs the flag-gated
  SummaryRollup feature; see §4 genesis signal 3/4).
- **authored** — human-created from scratch.

Page identity is durable: `id` never changes because a grouping changed.

### Space (the hard fence)
Every memory and page lives in exactly one space (missing → the `unfiled`
space). `space` means *scope and nothing else*: the page-category values
squatting in `pages.space` move into `kind`; `workspace` folds back into
`space` and is dropped. Nothing crosses a space fence: not cluster formation,
not attachment, not communities.

### Community (the routing unit — NOT a scope)
A persisted grouping *within* a space, computed over the graph (§3). Rows:
durable `community_id`, space, display name (keyed to the durable id),
timestamps. Every node gets community assignment(s); multi-membership with
weights is allowed and expected for pages.

---

## 2. Edges — one typed store, one lineage rule

One table replaces `relations`, `page_sources`, `page_evidence`, the
`citations` JSON blob, and `page_links`:

```
edges(src_id, src_kind, dst_id, dst_kind, edge_type, lineage, weight,
      provenance, created_at)
```

`edge_type`: `mentions` (memory→entity page), `relates` (entity↔entity),
`cites` (page→memory / page→external), `links` (page→page wikilink),
`supports` (page-claim→memory span; claim locator in the edge payload).

**`lineage` is the load-bearing column** — three values:

| lineage | meaning | example |
|---|---|---|
| `assertion` | a human said it | wikilink typed by hand; a human edit's claims |
| `evidence` | extracted from captured reality | entity mention found in an agent capture |
| `synthesis` | the system generated it | a distilled page's citation of its sources |

**The one rule (replaces three council gates):**

> **Only `assertion` and `evidence` edges feed structure formation** —
> community detection, seed floors, co-citation statistics. `synthesis`
> edges route and display but never vote.

This single sentence *is* "pages are non-voting members" (a distilled page's
edges are synthesis), *is* "edit-captures are lineage-gated" (an agent's
edit-capture produces synthesis edges), and *is* "a book must not mint pages
from its own chapters" (see the origin-counting floor in §4). Three special
cases about node types become one property of edges.

---

## 3. Grouping — where Leiden sits

**One algorithm, one persisted result, three consumers** (page routing, map
regions, overview rollups). Replaces all three of today's grouping systems.

- Runs **per space**, over the `assertion + evidence` sub-graph — memories
  and pages are both nodes; what votes is decided by edge lineage, not node
  type (§2). So entity pages vote (their mention edges are evidence), while
  distilled pages ride along without voting.
- **Leiden** is the intended algorithm, behind a contract the algorithm can't
  leak through: durable community ids, old→new **max-overlap rebinding** on
  every re-run, splits/merges surfaced as review proposals (never silent
  renames), and separate dials for churn-suppression vs truthful
  reassignment. If the `leiden-rs` spike fails, the fallback is today's
  label propagation upgraded to run over this same graph under the same
  contract — the contract, not the algorithm, is what the rest of the
  system depends on.
- The app's degree peak-climbing heuristic stays as the client-side fallback
  until the daemon ships `community_id` on the graph API, then retires.
- **Gates before building this** (unchanged from the council): the leiden-rs
  maturity/seeding spike and the on-device full-re-partition benchmark.

---

## 4. Distill revamped — genesis from four signals, maintenance by routing

### Genesis: a page is born from any of four graph signals — not only memory clusters

1. **Evidence cluster** (today's only path, now community-scoped): enough
   un-covered evidence inside a community → create a `concept` page.
   Embedding similarity demotes from *the* grouping mechanism to a
   tie-breaker/sub-splitter within a community.
   **Floor: ≥3 independent origins** — a whole document counts as ONE
   origin no matter how many chunks; synthesis counts as zero. (This
   slightly relaxes today's "captures only" rule: 2 captures + 1 book = 3
   origins would now qualify. Flagged as open question Q2 — the strict
   version is "≥3 capture origins", identical machinery either way.)
2. **Page-graph signal**: an orphan wikilink target referenced by ≥N pages
   (the daemon already mines these — `resolve_orphan_page_links`), or a
   dense page neighborhood with no hub → propose a page. This is "a new
   page born from other pages."
3. **Community signal**: a community above size X with no `overview` page →
   create one. Absorbs SummaryRollup.
4. **Space signal**: a space above size Y with no overview → create one.

Every page records its genesis (which signal, which nodes) as provenance.

### Maintenance: route, attach, merge

- New memory → community assignment → candidate pages ranked by **one
  relevance function** (llm_wiki's proven shape, tuned for us): co-citation
  (highest weight), direct link, common-neighbor, kind-affinity. Built once,
  consumed by attachment, the graph view's edge weights, and "related pages".
- Attach as evidence → page marked stale → **refresh = LLM merge**: show the
  model the current page (possibly human-edited) AND the new evidence, ask
  for one merged page — after snapshotting the current version to page
  history. No structural diff/patch machinery. This is also how human edits
  survive machine refreshes (llm_wiki's mechanism, kept alongside our
  stronger revision-card protection, §5).
- **New-topic discovery survives as a defined state, not a side-scan**: the
  *frontier* = evidence with no (or weak) community assignment. It
  accumulates per space and a bounded pass scans it each cycle against the
  §4.1 floor. Today's staging pool ("memories not yet cited by any page")
  becomes this precise graph query.
- **Identity dedup is a separate module from grouping** (llm_wiki lesson):
  same-entity-different-name (`vfa` vs `volatile-fatty-acids`) is an
  LLM-classified, user-confirmed merge flow — never conflated with
  community detection, which answers "related", not "same".

### Truthfulness (pre-publication, per council)

At synthesis/merge time, compute per-claim `supports` edges (claim →
source span). Claims without support ⇒ the page carries a machine-readable
**provisional** status that agents see on every read path. `review_status`
collapses to a *derived* value: `confirmed` = a human accepted it;
`provisional` = unsupported claims exist. The human review queue is
curation, not the truth gate.

---

## 5. One write path + the authority ladder

All page writes go through one gate. The writer is a **typed field** —
`human | agent | pipeline(stage)` — not a magic string convention.

**Authority ladder (explicit, the "human edit order" rule):**

> **assertion (human) > evidence (captured) > synthesis (derived)**

Concretely:

1. A human edit **applies instantly** (as today) and additionally records an
   assertion capture (`origin=page_edit`) so the knowledge travels — the
   generalization of the daemon's own revision-card grammar, run in the
   human→system direction.
2. A machine write to human-owned prose **never lands directly**: it stages a
   revision card for accept/dismiss (today's mechanism, kept verbatim).
3. When a synthesis contradicts an assertion, **the assertion wins the prose**
   and the contradiction surfaces as a review item — never a silent
   overwrite in either direction.
4. Assertion-backed claims display as "stated by you", never dressed as
   document-backed evidence (council's taxonomy point; the assertion-type
   refinement — correction vs speculation vs preference — remains a gate
   item, Q3).
5. **Every write leaves history** — snapshot + changelog on all paths. (Fixes
   the shipped gap: the manual-edit HTTP route currently writes no history
   and wipes the citation map; under this spec stale claims are *marked*
   stale, not destroyed.)

---

## 6. Migration ladder (each rung ships alone)

| # | Rung | Size | Unlocks |
|---|---|---|---|
| M1 | Honest columns: page `kind` column; category values out of `space`; `workspace` folds into `space` | S | kills the scope overload |
| M2 | Unified `edges` table: dual-write + backfill from the 4 link stores, flip readers, drop old | M | one link truth |
| M3 | Entities → entity pages (entities table becomes a compat view; HTTP/MCP shapes preserved by adapters) | L | two node types for real |
| M4 | Persisted communities under the §3 contract (post-spike/benchmark); app consumes `community_id`; heuristic retires | M | one grouping |
| M5 | Distill rewired: 4 genesis signals, frontier staging, one relevance function | L | streamlined creation |
| M6 | One write path: typed author, history-everywhere, LLM-merge refresh, per-claim supports + provisional status | M | authority ladder + truth gate |

M1/M2 are safe immediately. M3 is the deep cut — it waits until M2 proves the
edge store. M4 waits on the two council gates. M5/M6 land on top.

---

## 7. Invariants — the behaviors this model must keep (checklist)

1. A book never mints pages from its own chapters *(origin-counting floor)*
2. ≥3 independent origins before a new concept page *(floor, §4.1)*
3. Human prose is never silently overwritten *(ladder rule 2)*
4. New topics always get discovered *(frontier state, §4)*
5. Page identity durable; regroupings propose, never rename *(§1, §3)*
6. Every claim traceable; unsupported ⇒ machine-readably provisional *(§4)*
7. Spaces are hard fences *(§1)*
8. One memory may support several pages *(unchanged; edges are many-to-many)*
9. An edit's knowledge travels — no dead ends *(ladder rule 1)*
10. Every write leaves history *(ladder rule 5 — currently broken, fixed here)*
11. The system never believes its own output *(the lineage rule, §2)*
12. Stability and truthfulness get separate dials *(§3 contract)*

## 8. Open questions

- **Q1 — entity-page stubs on the wire:** do stub entity pages appear in page
  listings, or only in the graph until they earn prose? (Recommend: graph
  only; listings filter `stub`.)
- **Q2 — floor strictness:** "≥3 independent origins" (documents count as
  one) vs today's "≥3 capture origins" (documents count as zero). Recommend
  the relaxed version; identical machinery, one constant.
- **Q3 — human assertion taxonomy** (correction / speculation / preference /
  observation) and their distinct propagation rules — council gate item,
  unresolved, needed before M6 finishes.
- **Q4 — snapshot storage:** page-history table vs file snapshots
  (llm_wiki-style). Recommend table (we already have the DB; files add a
  second store).
- **Q5 — relevance-function weights:** llm_wiki ships co-citation 4.0 >
  direct link 3.0 > common-neighbor 1.5 > type-affinity 1.0; ours need
  tuning against wrong-attachment rates (council's smoothed-PPMI/NPMI note
  applies to the co-citation term).

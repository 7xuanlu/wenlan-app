# Codex adversarial review of the unified-model spec — verbatim + triage

**Provenance:** Codex `gpt-5.6-sol`, reasoning effort xhigh, read-only
`codex exec`, 2026-07-18. Reviewed document: spec draft **v1** at commit
4c0ea07. Prompted as a hostile independent reviewer with five named attack
surfaces: (a) lineage-rule leak paths, (b) entity-table dissolution risks,
(c) M1–M6 ordering flaws, (d) genesis-signal interaction bugs, (e) council
items silently dropped. A first dispatch died mid-run (host-session
compaction killed the subagent); this is the completed relaunch of the
identical prompt.

**Outcome:** 44 findings (25 critical, 19 major), overall verdict
**needs-more-info**. All 44 were folded into spec **v2** in some form; 5
were folded with a modification noted in the disposition table.

---

## Disposition table (triage by Claude, folded into spec v2)

| # | Sev | Disposition | Where in v2 |
|---|---|---|---|
| 1 | crit | folded — the headline concession | §2 grounding rule (ancestry, not immediate author) |
| 2 | crit | folded | §5.1 delta-only assertion capture |
| 3 | crit | folded | §5.2 acceptance ≠ attestation |
| 4 | crit | folded | §2 self-recapture closure via roots |
| 5 | crit | folded, shaped | §3 two-phase: participate iff grounded degree ≥1 (not blanket post-hoc assignment for all pages — entity pages must anchor the partition) |
| 6 | crit | folded | §4 one floor for all four genesis signals |
| 7 | maj | folded | §1 canonical roots + new Q6 |
| 8 | maj | folded | §2 immutability + M2 assignment-matrix artifact |
| 9 | crit | folded, partial | §5 three-axes split (display + contradiction surfacing already existed in v1; the axis separation is new) |
| 10 | crit | folded | §1 claims as stable-ID sub-page units; external cites as URI attrs |
| 11 | crit | folded | M3 caller inventory / material compat during transition |
| 12 | maj | folded as gate | M3 index acceptance criteria + benchmark, not a design change |
| 13 | crit | folded | M3 canonical entity-upsert service + resumable state machine |
| 14 | crit | folded, alternative | M3 id-mapping table rewrite inside one expand-contract program; global node registry rejected as higher-churn for the same guarantee |
| 15 | maj | folded | M3 wire-contract freeze; Q1 promoted to M3 gate |
| 16 | crit | folded | §2 + M2 now say five stores, consistently |
| 17 | crit | folded | new M0 (canonical write gate first) |
| 18 | crit | folded | M0 ships immediately — the live bug doesn't wait |
| 19 | crit | folded | §2 legacy/non-voting backfill state |
| 20 | maj | folded | M2 staged into expand/verify/cutover/soak/retire |
| 21 | crit | folded | ladder reorder: truth gate (M5) before distill (M6) |
| 22 | crit | folded | M4 gated on projection spec + routing spec |
| 23 | maj | folded, partial | M1 resized S→M with mapping/collision audit; noted that today's `workspace` usage is narrow (attach-gate COALESCE only), so the risk is mostly the category-squatter migration |
| 24 | maj | folded | old M6 split across M0 + M5 + M6 |
| 25 | crit | folded | §4 genesis candidate table + fingerprints + atomic claims |
| 26 | crit | folded | §4 signal 2 counts grounded roots, not page rows |
| 27 | maj | folded | §4 size over grounded nodes; overview artifacts excluded |
| 28 | crit | folded, partial | §4 frontier surfacing guarantee + invariant 4 reword; the hard space fence stays by design — cross-space suggestion noted as future work only |
| 29 | maj | folded | §4 durable frontier state, age-prioritized, budgeted |
| 30 | maj | folded | §1 overview subscription + new Q7 |
| 31 | maj | folded | §3 gates get written acceptance criteria |
| 32 | crit | folded | §3 routing model (thresholds, hysteresis, triggers) |
| 33 | crit | folded | §3 restores thresholded multi-membership + embedding fallback |
| 34 | maj | folded | §1 claim IDs + §4 merge anchoring |
| 35 | crit | folded | §4 dependency index + invalidation matrix |
| 36 | maj | folded | §4/Q5 smoothed NPMI + min support + decay required |
| 37 | maj | folded | §3 churn-rate + correction-latency metrics |
| 38 | maj | folded | §5.3 interim conservative rule until Q3 |
| 39 | crit | folded | §4 support_status / human_reviewed split + entailment scoring |
| 40 | maj | folded | §2 enumerated consumers incl. relation-confidence + synthesis-support |
| 41 | crit | folded | §2 space column + trigger, external-URI exception |
| 42 | crit | folded | §3 projection spec required before benchmark/library choice |
| 43 | crit | folded | §4 refresh-respects-write-path + version preconditions |
| 44 | maj | folded | §2 supersession/validity + §4 invalidation |

---

## Verbatim report

1. **Critical — Lineage is not transitive provenance.** `(a)`
   `assertion | evidence | synthesis` describes an edge’s immediate producer, not whether it ultimately descends from system-generated material. The safety property is path-dependent; a three-value edge label cannot express it.
   **Fix:** Preserve immutable derivation roots and make voting eligibility depend on independently grounded ancestry, not the latest writer.

2. **Critical — Human edits launder synthesis into assertion.** `(a)`
   §5.1 turns a human edit into an assertion capture without distinguishing new claims from retained or lightly reformatted machine prose. A typo fix to a generated page can therefore turn its claims into voting material.
   **Fix:** Attribute lineage at claim/diff level; unchanged machine-derived claims remain synthesis unless the user explicitly attests them.

3. **Critical — Revision-card acceptance is being confused with verification.** `(a)`
   Accepting proposed wording means “apply this edit,” not “I independently verified every claim.” Promoting accepted material to assertion destroys the distinction between editorial approval and epistemic attestation.
   **Fix:** Keep synthesis ancestry immutable and record `accepted_by_human` separately; require an explicit verification action to add an assertion attestation.

4. **Critical — “Agent capture” is an obvious self-citation tunnel.** `(a)`
   §2’s example says a mention extracted from an agent capture is `evidence`, while also claiming agent edit-captures become synthesis. An agent can quote, summarize, export, or recapture its own page through the ordinary capture path and regain voting eligibility.
   **Fix:** Classify by source ancestry—external observation/document versus generated output—not merely `author=agent` and `origin=capture`.

5. **Critical — Pages are not actually non-voting participants.** `(a, e)`
   Leiden optimizes over nodes incident to eligible edges. A distilled page receiving a human wikilink or an evidence-derived edge affects the objective even if its outgoing citations are synthesis. That is not the council’s “edge-bearing, non-voting page” model.
   **Fix:** Define an explicit graph projection in which page nodes are assigned after partitioning, or mathematically specify how their incident edges cannot influence the partition.

6. **Critical — The page-graph genesis signal explicitly bypasses “pages do not mint pages.”** `(a, d)`
   Signal 2 creates a page from references by other pages, with no stated lineage filter or independent-root floor. Signals 3 and 4 also create overviews from size counts without saying whether generated pages or synthesis-connected nodes contribute.
   **Fix:** Apply grounded-ancestry and diversity requirements to every genesis signal, not only evidence-cluster genesis.

7. **Major — “Independent origin” has no defensible identity model.** `(a, d)`
   The draft does not define whether imports of the same document, mirrors, page-edit captures, revision-card captures, or several agent captures derived from one response share an origin. Three recaptures can become “three origins.”
   **Fix:** Introduce canonical root-source IDs, content/source deduplication, and a precise origin-eligibility matrix.

8. **Major — Edge lineage assignment and mutation rules are absent.** `(a, c)`
   There is no matrix mapping writer, capture origin, extraction stage, edit operation, and revision acceptance to lineage. Nor does the spec say whether lineage is immutable, recomputed, or promotable.
   **Fix:** Specify a complete transition table and make derivation lineage immutable; new attestations should add edges rather than mutate old lineage.

9. **Critical — Editorial authority is conflated with truth.** `(a, other)`
   “Assertion wins the prose” is an ownership policy, not an epistemic rule. A human preference or mistaken speculation should not structurally outrank contradictory document evidence. Q3 admits this distinction is unresolved.
   **Fix:** Separate prose authority, epistemic support, claim type, and graph-voting eligibility into independent fields.

10. **Critical — The advertised two-node model already contains undeclared node types.** `(b, other)`
    `supports(page-claim → memory span)` requires a durable claim identity, while `page → external` requires an external-resource identity. Neither fits the shown schema, which also omits the promised claim-locator payload.
    **Fix:** Define claims and external resources explicitly, or make claim support an attributed edge anchored to stable claim IDs with a documented payload schema.

11. **Critical — A SQLite compatibility view is not a transparent entity table replacement.** `(b)`
    Read-only projections can work, and `INSTEAD OF` triggers can emulate some writes, but they do not transparently preserve `UPSERT`, `RETURNING`, `last_insert_rowid`, ORM schema inspection, foreign-key parent behavior, or every conflict rule.
    **Fix:** Inventory every entity read/write pattern and either retain a material compatibility table during transition or provide tested triggers/adapters for each supported operation.

12. **Major — Entity search performance is unproven and likely to regress without deliberate indexing.** `(b)`
    A narrow entity table probably supports name/type/confidence/confirmation queries differently from a polymorphic page table containing prose and several kinds. The spec names no partial, covering, alias, or FTS indexes.
    **Fix:** Specify and benchmark indexes such as entity-kind partial indexes, normalized alias lookup, scoped uniqueness, and stable pagination indexes using real data and `EXPLAIN QUERY PLAN`.

13. **Critical — The entity extractor cannot simply “target entity pages.”** `(b)`
    Existing extraction likely depends on entity-specific upserts, uniqueness, confirmation state, relation joins, and narrow-row assumptions. During migration it can race the backfill, create duplicate pages, or encounter partially populated stubs.
    **Fix:** Define one canonical entity-upsert service, a resumable migration state machine, uniqueness rules, and reconciliation before redirecting extraction writes.

14. **Critical — M2 creates an endpoint identity mess that M3 must rewrite.** `(b, c)`
    Before M3, edges need `dst_kind=entity`; after M3, an entity is supposedly `dst_kind=page` with `pages.kind=entity`. Keeping `dst_kind=entity` preserves a third node type; changing it requires rewriting all relevant edges.
    **Fix:** Introduce stable global node IDs/a node registry first, or combine the edge and entity cutovers into one expand-contract program.

15. **Major — Wire compatibility is asserted before its semantics are decided.** `(b)`
    Q1 leaves stub visibility unresolved, yet stub inclusion changes entity listings, page listings, totals, cursors, filters, and joins. HTTP/MCP adapters cannot preserve both old entity behavior and a new “graph-only stub” policy automatically.
    **Fix:** Freeze endpoint-by-endpoint compatibility contracts, including pagination order, filters, IDs, nullability, totals, and stub visibility.

16. **Critical — The migration does not even agree on how many legacy stores exist.** `(b, c)`
    §2 says `edges` replaces `relations` plus four page-link mechanisms—five sources. M2 says it backfills “the 4 link stores.” Either relations are silently omitted or M2’s scope is understated.
    **Fix:** Publish a source-to-edge migration matrix covering all five stores, field mappings, deduplication, ownership, and deletion semantics.

17. **Critical — The one-write-path work is ordered far too late.** `(c)`
    M2 requires reliable dual-writes, M3 redirects extractor writes, and M5 creates and refreshes pages, all while the known split write paths and citation-destruction bug remain. The infrastructure needed to make those migrations safe is postponed to M6.
    **Fix:** Add M0: canonical write transaction, typed writer/provenance, citation preservation, optimistic versioning, and history on every path.

18. **Critical — The shipped history/citation-loss bug should not wait for architectural completion.** `(c)`
    “Every write leaves history” is a current correctness defect, not an optional final capability. Waiting through M1–M5 knowingly permits continued irreversible provenance loss.
    **Fix:** Ship the manual-route history and citation-preservation fix immediately, independently of LLM merge and claim support.

19. **Critical — M2 cannot honestly backfill lineage from the legacy stores.** `(c)`
    Old JSON citations, page links, evidence links, and relations may not encode whether a human, extractor, agent, or synthesis step created them. Guessing converts unknown material into voting evidence.
    **Fix:** Add a conservative `legacy_unknown`/non-voting state, provenance reconstruction reports, and explicit promotion only after validation.

20. **Major — M2 improperly compresses expand, backfill, cutover, and destruction into one rung.** `(c)`
    “Dual-write + backfill + flip readers + drop old” has no parity window or rollback after the old stores are removed. It is not one safely shippable unit.
    **Fix:** Split it into schema expansion, dual-write verification, reader cutover, soak/reconciliation, and eventual retirement in separate releases.

21. **Critical — M5 cannot ship before M6 as described.** `(c)`
    M5’s maintenance design depends on LLM merge, history snapshots, human-prose protection, per-claim support, provisional status, and the unified write gate—all assigned to M6. Shipping M5 first creates more machine-written pages through the unsafe old path.
    **Fix:** Move the minimal write/truth gate ahead of automated genesis and refresh, then ship relevance/genesis afterward.

22. **Critical — M4 is blocked by more than the Leiden spike and benchmark.** `(c, e)`
    M4 follows M3, so entity pages can exist by then; it cannot correctly run before M3. More importantly, it still lacks the page↔community assignment/routing model needed to emit meaningful `community_id` data. This abandons the council’s “Leiden first with shipped rollback” sequencing without justification.
    **Fix:** Specify routing and graph projection first, then decide whether a smaller entity-only M4 can ship before the dissolution cut.

23. **Major — M1 is not “safe immediately” or size S.** `(c)`
    Folding `workspace` into `space` changes scope cardinality, uniqueness, API filtering, and possibly access boundaries. Moving category values out of `space` also requires distinguishing fake categories from legitimate spaces and resolving collisions.
    **Fix:** Treat scope normalization as a separately audited data migration with mapping tables, collision reports, adapters, and rollback.

24. **Major — M6 is several migrations disguised as one medium rung.** `(c)`
    Typed authorship, canonical writes, version history, full-page merge, stable claims, support spans, support verification, provisional reads, and authority conflict handling do not share one implementation or rollback boundary.
    **Fix:** Split M6 into write correctness, claim identity, merge/concurrency, support verification, and read-path enforcement.

25. **Critical — Genesis has no transactional idempotency model.** `(d)`
    Signal 1 and signal 2 can select overlapping evidence while signal 3/4 create competing hubs. No uniqueness key, candidate reservation, coverage claim, or transaction boundary prevents duplicate concept or overview pages.
    **Fix:** Add a durable genesis-candidate table, deterministic fingerprints, atomic evidence claims, and partial unique constraints for overview scope and normalized orphan targets.

26. **Critical — Page count is a Sybilable substitute for independent evidence.** `(d)`
    Signal 2’s “referenced by N pages” can be satisfied by pages copied from one source, agent-generated pages, or lightly human-edited synthesis. Even assertion-only filtering does not establish independence.
    **Fix:** Count independent grounded roots or independent explicit human attestations, not page rows.

27. **Major — Overview generation can recursively inflate its own triggers.** `(d)`
    The draft never defines community/space “size.” If overview pages, their links, or later human-approved versions count, generated summaries can enlarge communities, produce orphan targets, and trigger further overviews or concepts.
    **Fix:** Define size exclusively over eligible grounded nodes/edges and exclude generated overview artifacts from genesis metrics.

28. **Critical — The frontier does not make “new topics always get discovered” true.** `(d)`
    A small space with two genuine independent origins never reaches the floor. Hard per-space fencing prevents related evidence in other spaces from helping. A bounded scan merely revisits the same insufficient set; it does not solve cold start.
    **Fix:** Weaken the invariant to “retained and surfaced,” or add age-based human surfacing, explicit overrides, and privacy-preserving cross-space suggestions without automatic cross-fence attachment.

29. **Major — The bounded frontier scan can starve data indefinitely.** `(d)`
    There is no fairness order, aging policy, cursor, scan budget, weak-assignment threshold, or retry trigger. Strongly but wrongly assigned evidence may also never enter the frontier.
    **Fix:** Specify durable frontier state, age-prioritized scheduling, reassignment triggers, retry guarantees, and observability for oldest-unprocessed evidence.

30. **Major — Overview lifecycle under community splits and merges is missing.** `(d)`
    Durable community IDs and review proposals do not say which overview counts as satisfying “has overview” after split/merge, whether old overviews subscribe to several communities, or how duplicate proposals are suppressed.
    **Fix:** Give overviews explicit scope subscriptions and define split, merge, orphaning, and uniqueness behavior transactionally.

31. **Major — The Leiden spike and device benchmark survive only as names, not executable gates.** `(e)`
    §3 retains both blockers, but defines no graph sizes, hardware classes, latency/memory budgets, seed requirements, quality checks, or pass/fail criteria. They therefore remain exactly the prior `needs-more-info` blockers.
    **Fix:** Turn them into written experiments with representative datasets and quantitative acceptance thresholds.

32. **Critical — The concrete page↔community routing model is still absent.** `(e)`
    “Multi-membership with weights is allowed and expected” does not define weight calculation, thresholds, update triggers, coverage, invalidation, or how subscriptions react to rebinding. Q5 concerns page relevance, not community membership.
    **Fix:** Add a dedicated routing section with formulas, thresholds, event triggers, fallback behavior, and stale-assignment invalidation.

33. **Critical — Two settled page-assignment requirements are silently dropped.** `(e)`
    The council required thresholded multi-community assignment and a page-embedding fallback for entity-poor pages. The draft merely “allows” weighted membership and never mentions the embedding fallback.
    **Fix:** Restore both as explicit M4 acceptance criteria and define when each fallback activates.

34. **Major — Block/claim-level pinning is silently dropped.** `(e)`
    Revision cards and snapshots are not pinning. The full-page LLM merge actively makes claim-level preservation harder because ownership and support locators move with regenerated text.
    **Fix:** Add stable block/claim IDs, claim-level ownership/pins, and merge rules that preserve them.

35. **Critical — Dependency/staleness invalidation is silently dropped.** `(e)`
    “New memory attaches → page marked stale” handles one event only. Source edits, source deletion, span changes, extraction corrections, entity merges, edge retractions, and support-score changes have no invalidation path.
    **Fix:** Build a dependency index and event-driven invalidation matrix before automated refresh.

36. **Major — Co-citation requirements are watered down into “tune the weights.”** `(e)`
    Q5 mentions the prior note but specifies neither smoothed PPMI/NPMI, minimum support, temporal decay, nor a wrong-attachment validation protocol. Raw or vaguely weighted co-citation remains unsafe in a small corpus.
    **Fix:** Specify the estimator, smoothing, floor, decay, normalization, and offline evaluation dataset.

37. **Major — “Separate dials” for stability and truthfulness is only a slogan.** `(e)`
    §3 does not define the truth-change signal, hysteresis function, UI behavior, or how max-overlap rebinding avoids suppressing necessary reassignment. The prior tuning blocker remains unresolved.
    **Fix:** Define separate measurable objectives and thresholds, then test churn and correction latency independently.

38. **Major — The assertion taxonomy is explicitly unresolved but used as if solved.** `(e)`
    Q3 remains a gate, yet §5 already lets all human assertions win prose, travel as captures, and potentially vote. Correction, speculation, preference, and observation cannot safely share those rules.
    **Fix:** Resolve the taxonomy before assertion captures or their edges become voting-eligible.

39. **Critical — The truthfulness gate is materially weaker than the council required.** `(e)`
    “Compute supports edges” is not source-span entailment scoring. A model can attach an irrelevant span and pass. There is no verifier, score, threshold, claim segmentation, pre-publication transaction, or enforcement proof for every agent read path. `confirmed` and `provisional` are also not opposites: a human can accept a page that still contains unsupported claims.
    **Fix:** Add stable claims, exact spans, independent entailment scoring, thresholds, atomic publication checks, read-path tests, and separate `human_reviewed` from `support_status`.

40. **Major — Relation-confidence and synthesis-support lineage gates disappear.** `(e)`
    The council required derived/agent-edit material to be excluded from relation-confidence and synthesis-support statistics as well as seed floors and co-citation. §2’s “one rule” names community formation, seed floors, and co-citation but never defines those other consumers.
    **Fix:** Enumerate every statistic and consumer governed by voting eligibility; prohibit undocumented lineage-sensitive aggregations.

41. **Critical — The hard space fence is not enforceable with the shown edge schema.** `(other)`
    `edges` contains no `space_id`, and polymorphic endpoint columns provide no ordinary foreign-key guarantee that both endpoints occupy the same space. A query convention is not a hard fence, particularly if scope has security implications.
    **Fix:** Store and validate edge space explicitly with composite constraints/triggers, audit legacy cross-space edges, and define external-link exceptions.

42. **Critical — The Leiden input graph is unspecified.** `(other)`
    The source data are directed, typed, weighted, heterogeneous edges; Leiden needs a concrete weighted graph projection. Direction folding, edge-type scaling, parallel-edge aggregation, high-degree document normalization, isolated pages, negative/retracted edges, and overlap matching over weighted multi-membership are all missing.
    **Fix:** Specify the exact adjacency construction and rebinding algorithm before benchmarking or choosing a library.

43. **Critical — Full-page LLM merge contradicts the authority ladder and breaks concurrency.** `(other)`
    §4 says refresh produces one merged page; §5 says a machine write touching human prose never lands directly. The draft does not say whether the whole merge becomes a revision card, how concurrent edits are rebased, or how support locators survive regeneration. A snapshot enables recovery, not correctness.
    **Fix:** Use version preconditions, stable claim/block identities, three-way merge/rebase, and claim-level staged changes.

44. **Major — Retraction and lifecycle semantics are absent.** `(other)`
    Append-mostly memories and permanent eligible edges mean corrected extraction errors or withdrawn sources may continue voting forever. The edge schema lacks status, validity interval, supersession, deletion, or history semantics.
    **Fix:** Add tombstone/supersession and temporal validity rules, with downstream invalidation and community recomputation.

## Overall verdict

**Needs-more-info.**

The central claim—that one edge-lineage rule subsumes the council’s separate gates—is false. It mistakes immediate authorship for derivation ancestry, fails the human-edit and agent-recapture loops, and does not make pages non-voting. The migration ladder is also in the wrong dependency order: canonical writes and provenance must precede unified edges, while truth/merge protections must precede automated genesis.

With direct repository access, I would inspect next:

- The exact schemas, indexes, triggers, foreign keys, and migrations for `entities`, `pages`, `memories`, `relations`, and all four page-link stores.
- Every direct SQL caller of `entities`, especially `INSERT ... ON CONFLICT`, joins, pagination, and confidence/confirmation filters.
- HTTP/MCP entity and page response structs, cursor implementations, nullability, and ID assumptions.
- Both page-write paths, revision-card acceptance, citation rewriting, changelog/history transactions, and concurrency controls.
- All three current seed-floor implementations and how they define capture/document origin.
- `resolve_orphan_page_links`, SummaryRollup, frontier/staging queries, and whether generated pages participate.
- Graph API construction and the frontend peak-climbing fallback.
- Actual corpus cardinalities and `EXPLAIN QUERY PLAN` results for entity recall before and after a page-table prototype.
- Legacy provenance quality: how many edges can be classified confidently versus requiring `legacy_unknown`.
- Cross-space links already present in production data.
- A provenance-loop test corpus covering light edits, accepted revision cards, agent recapture, duplicate document imports, and copied page graphs.
- A device benchmark using the exact proposed graph projection—not an abstract Leiden benchmark.
